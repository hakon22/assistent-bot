import { Container, Singleton } from 'typescript-ioc';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';

import { ModelService } from '@/services/model/model.service';
import { ConversationHistoryEntity } from '@/db/entities/conversation-history.entity';
import { SearchHistoryEntity } from '@/db/entities/search-history.entity';
import { LoggerService } from '@/services/app/logger.service';

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
export class GeneralAgentService {
  private readonly TAG = 'GeneralAgentService';

  private readonly loggerService = Container.get(LoggerService);

  private readonly modelService = Container.get(ModelService);

  public process = async (input: GeneralAgentInput): Promise<string> => {
    const { telegramId, userId, requestId, messageText, fileText, imageUrl, mediaType, modelId } = input;

    // Загружаем последние 10 сообщений из истории
    const history = await ConversationHistoryEntity.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    const systemMessage = new SystemMessage(
      [
        'Ты — умный и полезный ИИ-ассистент.',
        `Текущая дата: ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
        'Отвечай на вопросы на русском языке. Будь точным, кратким и полезным.',
        'Используй HTML-форматирование Telegram: <b>жирный</b>, <i>курсив</i>, списки с •.',
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
      answer = typeof response.content === 'string'
        ? response.content.trim()
        : JSON.stringify(response.content);
    } catch (e) {
      this.loggerService.error(this.TAG, 'LLM call failed:', e);
      throw e;
    }

    // Сохраняем в историю диалога
    await this.saveHistory(telegramId, userId, requestId, messageText, answer);

    // Логируем в search_history
    await this.logSearch(requestId, userId, messageText);

    return answer;
  };

  private saveHistory = async (telegramId: string, userId: number, requestId: number, question: string, answer: string): Promise<void> => {
    try {
      for (const [role, content] of [['user', question], ['assistant', answer]] as const) {
        const historyEntry = new ConversationHistoryEntity();
        historyEntry.telegramId = telegramId;
        historyEntry.userId = userId;
        historyEntry.requestId = requestId;
        historyEntry.role = role;
        historyEntry.content = content;
        historyEntry.agentName = 'general_agent';
        await historyEntry.save();
      }
    } catch (e) {
      this.loggerService.error(this.TAG, 'Failed to save history:', e);
    }
  };

  private logSearch = async (requestId: number, userId: number, query: string): Promise<void> => {
    try {
      const searchRecord = new SearchHistoryEntity();
      searchRecord.requestId = requestId;
      searchRecord.userId = userId;
      searchRecord.queryText = query;
      searchRecord.searchEngine = 'llm';
      searchRecord.agentName = 'general_agent';
      await searchRecord.save();
    } catch { /* non-critical */ }
  };
}
