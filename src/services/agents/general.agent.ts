import { Container, Singleton } from 'typescript-ioc';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';

import { BaseAgentService } from '@/services/agents/base-agent.service';
import { ModelService } from '@/services/model/model.service';
import { ConversationHistoryEntity } from '@/db/entities/conversation-history.entity';
import { RequestEntity } from '@/db/entities/request.entity';
import { SearchHistoryEntity } from '@/db/entities/search-history.entity';
import { UserEntity } from '@/db/entities/user.entity';

export interface GeneralAgentInput {
  telegramId: string;
  userId: number;
  requestId: number;
  messageText: string;
  fileText?: string;
  /** Telegram download URL for image (valid ~1h) */
  imageUrl?: string;
  mediaType?: string;
  modelId?: string | null;
}

@Singleton
export class GeneralAgentService extends BaseAgentService {
  protected readonly TAG = 'GeneralAgentService';

  protected readonly AGENT_NAME = 'general_agent';

  private readonly modelService = Container.get(ModelService);

  public process = async (input: GeneralAgentInput): Promise<string> => {
    const { telegramId, userId, requestId, messageText, fileText, imageUrl, mediaType, modelId } = input;

    // Загружаем последние 10 сообщений из истории
    const history = await ConversationHistoryEntity.find({
      where: { user: { id: userId } },
      order: { created: 'DESC' },
      take: 10,
    });

    const systemMessage = new SystemMessage(
      [
        'Ты — умный и полезный ИИ-ассистент.',
        this.buildAgentCurrentDatePromptBlock(),
        'Отвечай на вопросы на русском языке. Будь точным, кратким и полезным.',
        '',
        'ФОРМАТИРОВАНИЕ — используй ТОЛЬКО Telegram HTML:',
        '  <b>жирный</b>  <i>курсив</i>  <a href="URL">ссылка</a>  списки с •',
        'ЗАПРЕЩЕНО: markdown ** **, [ ]( ), # заголовки, --- разделители.',
        '',
        'ССЫЛКИ: включай только реально существующие URL которые ты знаешь наверняка.',
        'У тебя НЕТ доступа к интернету. Не имитируй веб-поиск.',
        'Не генерируй ссылки с utm-параметрами и не придумывай URL к магазинам.',
        '',
        'Если прислали изображение — опиши что на нём изображено.',
        'Если прислали голосовое или видео — содержимое уже распознано и передано текстом.',
      ].join('\n'),
    );

    // Строим историю (oldest first)
    const historyMessages = [...history].reverse().map((item) =>
      item.role === 'user'
        ? new HumanMessage(item.content)
        : new AIMessage(item.content),
    );

    // Текущее сообщение пользователя — с поддержкой мультимодальности
    const isImage = mediaType === 'photo' || mediaType === 'mixed';
    let userMessage: HumanMessage;

    if (isImage && imageUrl) {
      const textPart = messageText
        ? `${messageText}${fileText ? `\n\n[Файл]:\n${fileText.substring(0, 3000)}` : ''}`
        : '[Пользователь прислал изображение]';

      userMessage = new HumanMessage({
        content: [
          { type: 'text', text: textPart },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      });
    } else {
      let text = messageText;
      if (fileText?.trim()) {
        text += `\n\n[Содержимое файла]:\n${fileText.substring(0, 3000)}`;
      }
      userMessage = new HumanMessage(text);
    }

    const model = this.modelService.getChatModel(0.7, modelId);

    let answer: string;
    try {
      const response = await model.invoke([systemMessage, ...historyMessages, userMessage]);
      const raw = typeof response.content === 'string'
        ? response.content.trim()
        : JSON.stringify(response.content);
      answer = this.convertMarkdownToHtml(raw);
    } catch (error) {
      this.loggerService.error(this.TAG, 'LLM call failed:', error);
      throw error;
    }

    // Сохраняем в историю диалога
    await this.saveHistory(telegramId, userId, requestId, messageText, answer);

    // Логируем в search_history
    await this.logSearch(requestId, userId, messageText);

    return answer;
  };

  private convertMarkdownToHtml = (text: string): string =>
    text
      .replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')
      .replace(/\*(.+?)\*/gs, '<i>$1</i>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
      .replace(/^-\s+/gm, '• ');

  private logSearch = async (requestId: number, userId: number, query: string): Promise<void> => {
    try {
      const searchRecord = new SearchHistoryEntity();
      searchRecord.request = { id: requestId } as RequestEntity;
      searchRecord.user = { id: userId } as UserEntity;
      searchRecord.queryText = query;
      searchRecord.searchEngine = 'llm';
      searchRecord.agentName = 'general_agent';
      await searchRecord.save();
    } catch { /* non-critical */ }
  };
}
