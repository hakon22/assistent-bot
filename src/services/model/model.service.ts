import { Singleton } from 'typescript-ioc';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';

import { ModelMessageRoleEnum } from '@/types/model-message-role';

@Singleton
export class ModelService {
  private readonly baseUrl = process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1';

  private readonly apiKey = process.env.LLM_API_KEY ?? '';

  private readonly modelName = 'google/gemini-3.1-flash-lite-preview';

  private readonly temperature = 0.7;

  public isWebSearchModel = (modelId?: string | null): boolean => Boolean(modelId?.endsWith(':online'));

  public getChatModel = (
    temperature: number | null | undefined,
    modelId?: string | null,
    options?: { includeRawResponse?: boolean; includeImageOutput?: boolean; },
  ): ChatOpenAI => {
    return new ChatOpenAI({
      model: modelId ?? this.modelName,
      ...(temperature !== null ? { temperature: temperature ?? this.temperature } : {}),
      ...(options?.includeImageOutput ? { modelKwargs: { modalities: ['image', 'text'] } } : {}),
      ...(options?.includeRawResponse ? { __includeRawResponse: true } : {}),
      apiKey: this.apiKey,
      configuration: {
        baseURL: this.baseUrl,
      },
    });
  };

  /** Вызов LLM с набором сообщений, возвращает текст ответа */
  public invoke = async (
    messages: { role: ModelMessageRoleEnum; content: string; }[],
    temperature?: number,
    modelId?: string | null,
  ): Promise<string> => {
    const model = this.getChatModel(temperature, modelId);
    const langchainMessages = messages.map((message) => {
      if (message.role === ModelMessageRoleEnum.SYSTEM) {
        return new SystemMessage(message.content);
      }
      if (message.role === ModelMessageRoleEnum.USER) {
        return new HumanMessage(message.content);
      }
      return new AIMessage(message.content);
    });
    const res = await model.invoke(langchainMessages);
    return typeof res.content === 'string' ? res.content.trim() : JSON.stringify(res.content);
  };
}
