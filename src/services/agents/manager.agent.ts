import { Container, Singleton } from 'typescript-ioc';
import { StateGraph, END } from '@langchain/langgraph';
import { Annotation } from '@langchain/langgraph';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

import { BaseAgentService } from '@/services/agents/base-agent.service';
import { ModelService } from '@/services/model/model.service';
import { GeneralAgentService, GeneralAgentImageBuffer } from '@/services/agents/general.agent';
import { JobSearchAgentService } from '@/services/agents/job-search.agent';
import { ToursHotelsAgentService } from '@/services/agents/tours-hotels.agent';
import { ProductComparisonAgentService } from '@/services/agents/product-comparison.agent';
import { ReminderAgentService } from '@/services/agents/reminder.agent';
import { BrowserAgentService } from '@/services/agents/browser.agent';
import { AgentDelegationLogEntity } from '@/db/entities/agent-delegation-log.entity';
import { RequestEntity } from '@/db/entities/request.entity';
import { RequestService } from '@/services/request/request.service';
import { ConversationHistoryEntity } from '@/db/entities/conversation-history.entity';
import { TelegramDialogStateEntity, TelegramDialogStateEnum } from '@/db/entities/telegram-dialog-state.entity';
import { ModelEntity } from '@/db/entities/model.entity';

type AgentName = 'job_search_agent' | 'tours_hotels_agent' | 'general_agent' | 'reminder_agent' | 'browser_agent' | 'product_comparison_agent';

const AGENTS_REGISTRY: { name: AgentName; description: string; }[] = [
  {
    name: 'job_search_agent',
    description: 'Используй когда пользователь хочет найти работу, просмотреть вакансии, узнать об открытых позициях, отправить резюме, узнать зарплату по специальности. Ключевые слова: работа, вакансия, резюме, зарплата, трудоустройство, hh, хэдхантер, оффер, собеседование, устроиться.',
  },
  {
    name: 'browser_agent',
    description: 'Используй когда пользователь хочет найти что-то в интернете, на конкретном сайте, купить товар (WB, Ozon, AliExpress и другие магазины), найти тур, отель, авиабилеты, сравнить цены, прочитать новость, найти информацию на сайте, заполнить форму или выполнить любое другое действие в браузере. Ключевые слова: найди на, открой, зайди на, поищи в интернете, вайлдберис, озон, алиэкспресс, авиасейлс, купи, найди товар, тур, отель, билет, цена, скидка.',
  },
  {
    name: 'tours_hotels_agent',
    description: 'Используй только когда пользователь прямо упоминает конкретный туристический сайт (ostrovok, 101hotel, booking) или просит подобрать тур/отель с детальным сравнением вариантов через веб-ресёрч.',
  },
  {
    name: 'product_comparison_agent',
    description: 'Используй когда пользователь хочет сравнить два или более конкретных товара, узнать какой лучше, прочитать реальные отзывы и выбрать между альтернативами. Ключевые слова: сравни, сравнение, что лучше, выбрать между, какой лучше, отзывы на, плюсы и минусы, vs, versus, iPhone vs, резина, шины, ноутбук сравнение.',
  },
  {
    name: 'general_agent',
    description: 'Используй для всех остальных запросов. Отвечает на общие вопросы, ведёт беседу, объясняет понятия, даёт советы, помогает с текстом, кодом, переводом. Используй как fallback по умолчанию.',
  },
  {
    name: 'reminder_agent',
    description: 'Используй когда пользователь хочет поставить напоминание — себе или партнёру. Ключевые слова: напомни, напоминание, не забудь, напомни зайчику, напомни жене, напомни мужу, поставь напоминание, через X минут, через X часов, таймер, в X часов напомни.',
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
  imageBuffers: Annotation<GeneralAgentImageBuffer[] | undefined>(),
  onAgentSelected: Annotation<((agentName: string) => Promise<void>) | undefined>(),
  onStatusUpdate: Annotation<((text: string) => Promise<void>) | undefined>(),
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
  onStatusUpdate?: (text: string) => Promise<void>;
}

export interface ManagerResult {
  responseText: string;
  agentName: string;
  inlineKeyboard?: string | null;
  imageBuffers?: GeneralAgentImageBuffer[];
}

@Singleton
export class ManagerAgentService extends BaseAgentService {
  protected readonly TAG = 'ManagerAgentService';

  protected readonly AGENT_NAME = 'manager_agent';

  private readonly REMINDER_PATTERN = /^(?:напомни\b|поставь напоминание|не забудь|через \d+\s*(?:секунд|минут|минуты|минуту|час|часа|часов))/i;

  private readonly MEDIA_PREFIX_PATTERN = /^\[(?:Голосовое|Видеосообщение|Видео|Аудио)\]:\s*/i;

  private readonly modelService = Container.get(ModelService);

  private readonly generalAgentService = Container.get(GeneralAgentService);

  private readonly jobSearchAgentService = Container.get(JobSearchAgentService);

  private readonly toursHotelsAgentService = Container.get(ToursHotelsAgentService);

  private readonly reminderAgentService = Container.get(ReminderAgentService);

  private readonly browserAgentService = Container.get(BrowserAgentService);

  private readonly productComparisonAgentService = Container.get(ProductComparisonAgentService);

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
      this.buildAgentCurrentDatePromptBlock(),
      'Проанализируй сообщение пользователя и выбери наиболее подходящего агента.',
      '',
      'Доступные агенты:',
      agentsList,
      '',
      'Ответь ТОЛЬКО валидным JSON:',
      '{"agent_name": "<имя агента>", "reason": "<краткое объяснение>", "user_acknowledgment": "<статус обработки>"}',
    ].join('\n');

    let userContent = state.messageText.replace(/^\[(?:Голосовое|Видеосообщение|Видео|Аудио)\]:\s*/i, '');
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
      this.loggerService.error(this.TAG, 'Router LLM error', error);
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
      this.loggerService.error(this.TAG, 'JobSearchAgent error', error);
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
        onStatusUpdate: state.onStatusUpdate,
      });
      return { response };
    } catch (error) {
      this.loggerService.error(this.TAG, 'ToursHotelsAgent error', error);
      return { response: 'Произошла ошибка при поиске. Попробуйте позже.' };
    }
  };

  private generalNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    try {
      const { text, imageBuffers } = await this.generalAgentService.process({
        telegramId: state.telegramId,
        userId: state.userId,
        requestId: state.requestId,
        messageText: state.messageText,
        fileText: state.fileText,
        imageUrl: state.imageUrl,
        mediaType: state.mediaType,
        modelId: state.modelId,
      });
      return { response: text, imageBuffers };
    } catch (error) {
      this.loggerService.error(this.TAG, 'GeneralAgent error', error);
      throw error;
    }
  };

  private productComparisonNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    try {
      const response = await this.productComparisonAgentService.process({
        telegramId: state.telegramId,
        userId: state.userId,
        requestId: state.requestId,
        messageText: state.messageText,
        modelId: state.modelId,
        onStatusUpdate: state.onStatusUpdate,
      });
      return { response };
    } catch (error) {
      this.loggerService.error(this.TAG, 'ProductComparisonAgent error', error);
      return { response: 'Произошла ошибка при сравнении товаров. Попробуйте позже.' };
    }
  };

  private browserNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    try {
      const response = await this.browserAgentService.process({
        telegramId: state.telegramId,
        userId: state.userId,
        requestId: state.requestId,
        messageText: state.messageText,
        modelId: state.modelId,
        onStatusUpdate: state.onStatusUpdate,
      });
      return { response };
    } catch (error) {
      this.loggerService.error(this.TAG, 'BrowserAgent error', error);
      return { response: 'Произошла ошибка при работе браузера. Попробуйте позже.' };
    }
  };

  private reminderNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    try {
      const result = await this.reminderAgentService.process({
        telegramId: state.telegramId,
        userId: state.userId,
        requestId: state.requestId,
        messageText: state.messageText,
        modelId: state.modelId,
      });
      return { response: result.responseText, inlineKeyboard: result.inlineKeyboard ?? null };
    } catch (error) {
      this.loggerService.error(this.TAG, 'ReminderAgent error', error);
      return { response: 'Произошла ошибка при создании напоминания. Попробуй позже.' };
    }
  };

  private buildGraph = () => {
    const graph = new StateGraph(AgentStateAnnotation)
      .addNode('router', this.routerNode)
      .addNode('job_search_agent', this.jobSearchNode)
      .addNode('tours_hotels_agent', this.toursHotelsNode)
      .addNode('general_agent', this.generalNode)
      .addNode('reminder_agent', this.reminderNode)
      .addNode('browser_agent', this.browserNode)
      .addNode('product_comparison_agent', this.productComparisonNode)
      .addEdge('__start__', 'router')
      .addConditionalEdges(
        'router',
        (state: AgentState) => state.selectedAgent ?? 'general_agent',
        {
          job_search_agent: 'job_search_agent',
          tours_hotels_agent: 'tours_hotels_agent',
          general_agent: 'general_agent',
          reminder_agent: 'reminder_agent',
          browser_agent: 'browser_agent',
          product_comparison_agent: 'product_comparison_agent',
        },
      )
      .addEdge('job_search_agent', END)
      .addEdge('tours_hotels_agent', END)
      .addEdge('general_agent', END)
      .addEdge('reminder_agent', END)
      .addEdge('browser_agent', END)
      .addEdge('product_comparison_agent', END);

    return graph.compile();
  };

  private readonly graph = this.buildGraph();

  public process = async (input: ManagerInput): Promise<ManagerResult> => {
    if (input.modelId && await this.isImageGenerationModel(input.modelId)) {
      return this.processImageGenerationRequest(input);
    }

    const dialogState = await TelegramDialogStateEntity.findOne({
      where: { telegramId: input.telegramId },
    });

    const cleanMessageText = input.messageText.replace(this.MEDIA_PREFIX_PATTERN, '');
    const isExplicitReminderRequest = this.REMINDER_PATTERN.test(cleanMessageText);

    // EDIT_WAITING всегда имеет приоритет: пользователь вводит новый текст напоминания
    const isEditWaiting = dialogState?.state === TelegramDialogStateEnum.REMINDER_EDIT_WAITING;

    // CLARIFICATION_WAITING перехватывается только если пользователь НЕ начинает новый запрос явно
    const isClarificationWaiting = dialogState?.state === TelegramDialogStateEnum.REMINDER_CLARIFICATION_WAITING;
    const shouldInterceptForReminder = isEditWaiting || (isClarificationWaiting && !isExplicitReminderRequest);

    if (shouldInterceptForReminder) {
      await this.requestService.markProcessing(input.requestId);
      const result = await this.reminderAgentService.process({
        telegramId: input.telegramId,
        userId: input.userId,
        requestId: input.requestId,
        messageText: input.messageText,
        modelId: input.modelId,
      });
      await this.requestService.markCompleted(input.requestId, 'reminder_agent', result.responseText);
      return { responseText: result.responseText, agentName: 'reminder_agent', inlineKeyboard: result.inlineKeyboard ?? null };
    }

    if (isExplicitReminderRequest) {
      this.loggerService.info(this.TAG, 'Детерминированный роутинг → reminder_agent', { messageText: cleanMessageText });
      await this.requestService.markProcessing(input.requestId);
      const result = await this.reminderAgentService.process({
        telegramId: input.telegramId,
        userId: input.userId,
        requestId: input.requestId,
        messageText: input.messageText,
        modelId: input.modelId,
      });
      await this.requestService.markCompleted(input.requestId, 'reminder_agent', result.responseText);
      return { responseText: result.responseText, agentName: 'reminder_agent', inlineKeyboard: result.inlineKeyboard ?? null };
    }

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
      imageBuffers: undefined,
      onAgentSelected: input.onAgentSelected,
      onStatusUpdate: input.onStatusUpdate,
    });

    const responseText = result.response || (result.imageBuffers?.length ? 'Изображение сгенерировано' : 'Извините, не удалось обработать ваш запрос.');
    const agentName = result.selectedAgent ?? 'general_agent';

    await this.requestService.markCompleted(input.requestId, agentName, responseText);

    return { responseText, agentName, inlineKeyboard: result.inlineKeyboard ?? null, imageBuffers: result.imageBuffers };
  };

  private logDelegation = async (requestId: number, toAgent: string, reason: string, llmReasoning: string): Promise<void> => {
    try {
      const delegationLog = new AgentDelegationLogEntity();
      delegationLog.request = { id: requestId } as RequestEntity;
      delegationLog.fromAgent = 'manager';
      delegationLog.toAgent = toAgent;
      delegationLog.reason = reason;
      delegationLog.llmReasoning = llmReasoning;
      await delegationLog.save();
    } catch { /* non-critical */ }
  };

  private isImageGenerationModel = async (modelId: string): Promise<boolean> => {
    try {
      const model = await ModelEntity.findOne({ select: ['modelId', 'isImageGeneration'], where: { modelId, isActive: true } });
      return model?.isImageGeneration ?? false;
    } catch (error) {
      this.loggerService.error(this.TAG, 'isImageGenerationModel error', error);
      return false;
    }
  };

  private processImageGenerationRequest = async (input: ManagerInput): Promise<ManagerResult> => {
    this.loggerService.info(this.TAG, 'Запрос на генерацию изображения', { telegramId: input.telegramId, modelId: input.modelId });

    await this.requestService.markProcessing(input.requestId);

    const cleanText = input.messageText.replace(this.MEDIA_PREFIX_PATTERN, '');
    const isImageRequest = await this.isImageGenerationRequest(cleanText);

    if (!isImageRequest) {
      this.loggerService.warn(this.TAG, 'Запрос не является генерацией изображения, возвращаем ошибку', { cleanText });
      const errorText = [
        '<b>⚠️ Выбранная модель предназначена только для генерации изображений.</b>',
        '',
        'Опишите изображение, которое нужно создать.',
        'Например: «нарисуй закат над горами» или «создай портрет кота в стиле аниме».',
        '',
        'Для обычных вопросов смените модель командой /model.',
      ].join('\n');
      await this.requestService.markCompleted(input.requestId, 'image_generation_agent', errorText);
      return { responseText: errorText, agentName: 'image_generation_agent' };
    }

    if (input.onAgentSelected) {
      await input.onAgentSelected('image_generation_agent').catch(() => undefined);
    }

    const optimizedPrompt = await this.optimizeImagePrompt(cleanText);
    this.loggerService.info(this.TAG, 'Оптимизированный промпт для генерации изображения', { optimizedPrompt });

    const { text, imageBuffers } = await this.generalAgentService.process({
      telegramId: input.telegramId,
      userId: input.userId,
      requestId: input.requestId,
      messageText: optimizedPrompt,
      modelId: input.modelId,
      skipHistory: true,
    });

    await this.requestService.markCompleted(input.requestId, 'image_generation_agent', text || 'Изображение сгенерировано');

    return { responseText: text || 'Изображение сгенерировано', agentName: 'image_generation_agent', imageBuffers };
  };

  private isImageGenerationRequest = async (messageText: string): Promise<boolean> => {
    try {
      const model = this.modelService.getChatModel(0, null);
      const systemPrompt = [
        'Ты определяешь, является ли запрос пользователя просьбой о генерации, создании или рисовании изображения.',
        'Ответь ТОЛЬКО одним словом: "да" или "нет".',
      ].join('\n');
      const response = await model.invoke([new SystemMessage(systemPrompt), new HumanMessage(messageText)]);
      const answer = typeof response.content === 'string' ? response.content.trim().toLowerCase() : '';
      return answer.startsWith('да');
    } catch (error) {
      this.loggerService.error(this.TAG, 'isImageGenerationRequest error', error);
      return false;
    }
  };

  private optimizeImagePrompt = async (messageText: string): Promise<string> => {
    try {
      const model = this.modelService.getChatModel(0.3, null);
      const systemPrompt = [
        'Ты оптимизируешь запросы для модели генерации изображений.',
        'Извлеки суть запроса и переформулируй его в виде чёткого, лаконичного промпта.',
        'Отвечай ТОЛЬКО на английском языке — это обязательное требование модели.',
        'Возвращай ТОЛЬКО промпт, без пояснений и вводных фраз.',
        'ЗАПРЕЩЕНО добавлять теги разрешения и качества (8k, 4k, HD, ultra-detailed, high-resolution, professional lighting, photorealistic, hyperrealistic и подобные), если пользователь явно их не запросил.',
        'Промпт должен описывать только то, что просил пользователь — без лишних украшений.',
      ].join('\n');
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(messageText),
      ]);
      const optimized = typeof response.content === 'string' ? response.content.trim() : '';
      return optimized || messageText;
    } catch (error) {
      this.loggerService.error(this.TAG, 'optimizeImagePrompt error', error);
      return messageText;
    }
  };

  private loadHistory = async (userId: number): Promise<{ role: string; content: string; }[]> => {
    try {
      const history = await ConversationHistoryEntity.find({
        where: { user: { id: userId } },
        order: { created: 'DESC' },
        take: 10,
      });
      return [...history].reverse().map((historyItem) => ({ role: historyItem.role, content: historyItem.content }));
    } catch {
      return [];
    }
  };
}
