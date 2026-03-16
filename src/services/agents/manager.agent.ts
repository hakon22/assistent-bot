import { Container, Singleton } from 'typescript-ioc';
import { StateGraph, END } from '@langchain/langgraph';
import { Annotation } from '@langchain/langgraph';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

import { ModelService } from '@/services/model/model.service';
import { GeneralAgentService } from '@/services/agents/general.agent';
import { JobSearchAgentService } from '@/services/agents/job-search.agent';
import { ToursHotelsAgentService } from '@/services/agents/tours-hotels.agent';
import { AgentDelegationLogEntity } from '@/db/entities/agent-delegation-log.entity';
import { RequestService } from '@/services/request/request.service';
import { ConversationHistoryEntity } from '@/db/entities/conversation-history.entity';

type AgentName = 'job_search_agent' | 'tours_hotels_agent' | 'general_agent';

const AGENTS_REGISTRY: { name: AgentName; description: string; }[] = [
  {
    name: 'job_search_agent',
    description: 'Используй когда пользователь хочет найти работу, просмотреть вакансии, узнать об открытых позициях, отправить резюме, узнать зарплату по специальности. Ключевые слова: работа, вакансия, резюме, зарплата, трудоустройство, hh, хэдхантер, оффер, собеседование, устроиться.',
  },
  {
    name: 'tours_hotels_agent',
    description: 'Используй когда пользователь хочет найти конкретный товар или услугу в интернете: тур, отель (ostrovok.ru, 101hotel.ru), авиабилеты, купить что-то на конкретном сайте, узнать цену, найти самое дешёвое предложение. Ключевые слова: тур, отель, путешествие, отдых, купить, цена, товар, каталог, бронирование, найди на сайте.',
  },
  {
    name: 'general_agent',
    description: 'Используй для всех остальных запросов. Отвечает на общие вопросы, ведёт беседу, объясняет понятия, даёт советы. Используй как fallback по умолчанию.',
  },
];

const AgentStateAnnotation = Annotation.Root({
  telegramId: Annotation<string>(),
  userId: Annotation<number>(),
  requestId: Annotation<number>(),
  messageText: Annotation<string>(),
  fileText: Annotation<string | undefined>(),
  imageUrl: Annotation<string | undefined>(),
  mediaType: Annotation<string | undefined>(),
  resumeText: Annotation<string | undefined>(),
  modelId: Annotation<string | null | undefined>(),
  history: Annotation<{ role: string; content: string; }[]>(),
  selectedAgent: Annotation<AgentName | undefined>(),
  routingReason: Annotation<string | undefined>(),
  response: Annotation<string | undefined>(),
  inlineKeyboard: Annotation<string | null | undefined>(),
  onAgentSelected: Annotation<((agentName: string) => Promise<void>) | undefined>(),
});

type AgentState = typeof AgentStateAnnotation.State;

export interface ManagerInput {
  telegramId: string;
  userId: number;
  requestId: number;
  messageText: string;
  fileText?: string;
  imageUrl?: string;
  mediaType?: string;
  resumeText?: string;
  modelId?: string | null;
  onAgentSelected?: (agentName: string) => Promise<void>;
}

export interface ManagerResult {
  responseText: string;
  agentName: string;
  inlineKeyboard?: string | null;
}

@Singleton
export class ManagerAgentService {
  private readonly TAG = 'ManagerAgentService';

  private readonly modelService = Container.get(ModelService);

  private readonly generalAgentService = Container.get(GeneralAgentService);

  private readonly jobSearchAgentService = Container.get(JobSearchAgentService);

  private readonly toursHotelsAgentService = Container.get(ToursHotelsAgentService);

  private readonly requestService = Container.get(RequestService);

  // ──── Ноды графа определяются первыми, чтобы buildGraph мог их захватить ────

  private routerNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const model = this.modelService.getChatModel(0.1, state.modelId);

    const agentsList = AGENTS_REGISTRY.map((agent) => `- ${agent.name}: ${agent.description}`).join('\n');

    const historyText = state.history
      .slice(-6)
      .map((historyItem) => `${historyItem.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${historyItem.content}`)
      .join('\n');

    const systemPrompt = [
      'Ты — маршрутизатор запросов для мультиагентной системы.',
      `Текущая дата: ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
      'Проанализируй сообщение пользователя и выбери наиболее подходящего агента.',
      '',
      'Доступные агенты:',
      agentsList,
      '',
      'Ответь ТОЛЬКО валидным JSON:',
      '{"agent_name": "<имя агента>", "reason": "<краткое объяснение>", "user_acknowledgment": "<статус обработки>"}',
    ].join('\n');

    let userContent = state.messageText;
    if (state.fileText?.trim()) {
      userContent += `\n\n[Файл]: ${state.fileText.substring(0, 500)}`;
    }
    if (historyText) {
      userContent = `История:\n${historyText}\n\nТекущий запрос: ${userContent}`;
    }

    let selectedAgent: AgentName = 'general_agent';
    let routingReason = 'Fallback';
    let llmReasoning = '';

    try {
      const response = await model.invoke([new SystemMessage(systemPrompt), new HumanMessage(userContent)]);
      const content = typeof response.content === 'string' ? response.content.trim() : '';
      llmReasoning = content.substring(0, 2000);

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const agentNames = AGENTS_REGISTRY.map((agent) => agent.name);
        if (agentNames.includes(parsed.agent_name)) {
          selectedAgent = parsed.agent_name as AgentName;
          routingReason = parsed.reason ?? '';
        }
      }
    } catch (error) {
      console.error(`[${this.TAG}] Router LLM error:`, error);
    }

    await this.logDelegation(state.requestId, selectedAgent, routingReason, llmReasoning);
    await this.requestService.addStatus(state.requestId, 'delegated', selectedAgent, 'Delegated by manager LLM');

    if (state.onAgentSelected) {
      await state.onAgentSelected(selectedAgent).catch(() => undefined);
    }

    return { selectedAgent, routingReason };
  };

  private jobSearchNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    try {
      const result = await this.jobSearchAgentService.process({
        telegramId: state.telegramId,
        userId: state.userId,
        requestId: state.requestId,
        messageText: state.messageText,
        resumeText: state.resumeText,
        fileText: state.fileText,
        modelId: state.modelId,
      });
      return { response: result.responseText, inlineKeyboard: result.inlineKeyboard ?? null };
    } catch (error) {
      console.error(`[${this.TAG}] JobSearchAgent error:`, error);
      return { response: 'Произошла ошибка при поиске вакансий. Попробуйте позже.' };
    }
  };

  private toursHotelsNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    try {
      const response = await this.toursHotelsAgentService.process({
        telegramId: state.telegramId,
        userId: state.userId,
        requestId: state.requestId,
        messageText: state.messageText,
        modelId: state.modelId,
      });
      return { response };
    } catch (error) {
      console.error(`[${this.TAG}] ToursHotelsAgent error:`, error);
      return { response: 'Произошла ошибка при поиске. Попробуйте позже.' };
    }
  };

  private generalNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    try {
      const response = await this.generalAgentService.process({
        telegramId: state.telegramId,
        userId: state.userId,
        requestId: state.requestId,
        messageText: state.messageText,
        fileText: state.fileText,
        imageUrl: state.imageUrl,
        mediaType: state.mediaType,
        modelId: state.modelId,
      });
      return { response };
    } catch (error) {
      console.error(`[${this.TAG}] GeneralAgent error:`, error);
      throw error;
    }
  };

  private readonly graph = this.buildGraph();

  public process = async (input: ManagerInput): Promise<ManagerResult> => {
    const history = await this.loadHistory(input.userId);

    await this.requestService.markProcessing(input.requestId);

    const result = await this.graph.invoke({
      telegramId: input.telegramId,
      userId: input.userId,
      requestId: input.requestId,
      messageText: input.messageText,
      fileText: input.fileText,
      imageUrl: input.imageUrl,
      mediaType: input.mediaType,
      resumeText: input.resumeText,
      modelId: input.modelId,
      history,
      selectedAgent: undefined,
      routingReason: undefined,
      response: undefined,
      inlineKeyboard: undefined,
      onAgentSelected: input.onAgentSelected,
    });

    const responseText = result.response ?? 'Извините, не удалось обработать ваш запрос.';
    const agentName = result.selectedAgent ?? 'general_agent';

    await this.requestService.markCompleted(input.requestId, agentName, responseText);

    return { responseText, agentName, inlineKeyboard: result.inlineKeyboard ?? null };
  };

  private buildGraph() {
    const graph = new StateGraph(AgentStateAnnotation)
      .addNode('router', this.routerNode)
      .addNode('job_search_agent', this.jobSearchNode)
      .addNode('tours_hotels_agent', this.toursHotelsNode)
      .addNode('general_agent', this.generalNode)
      .addEdge('__start__', 'router')
      .addConditionalEdges(
        'router',
        (state: AgentState) => state.selectedAgent ?? 'general_agent',
        {
          job_search_agent: 'job_search_agent',
          tours_hotels_agent: 'tours_hotels_agent',
          general_agent: 'general_agent',
        },
      )
      .addEdge('job_search_agent', END)
      .addEdge('tours_hotels_agent', END)
      .addEdge('general_agent', END);

    return graph.compile();
  }

  private logDelegation = async (requestId: number, toAgent: string, reason: string, llmReasoning: string): Promise<void> => {
    try {
      const delegationLog = new AgentDelegationLogEntity();
      delegationLog.requestId = requestId;
      delegationLog.fromAgent = 'manager';
      delegationLog.toAgent = toAgent;
      delegationLog.reason = reason;
      delegationLog.llmReasoning = llmReasoning;
      await delegationLog.save();
    } catch { /* non-critical */ }
  };

  private loadHistory = async (userId: number): Promise<{ role: string; content: string; }[]> => {
    try {
      const history = await ConversationHistoryEntity.find({
        where: { userId },
        order: { createdAt: 'DESC' },
        take: 10,
      });
      return [...history].reverse().map((historyItem) => ({ role: historyItem.role, content: historyItem.content }));
    } catch {
      return [];
    }
  };
}
