import { Singleton } from 'typescript-ioc';
import { ChatOpenAI } from '@langchain/openai';

@Singleton
export class ModelService {
  private readonly baseUrl = process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1';

  private readonly apiKey = process.env.LLM_API_KEY ?? '';

  private readonly modelName = 'google/gemini-3.1-flash-lite-preview';

  private readonly temperature = 0.7;

  public getChatModel = (temperature: number | null | undefined, modelId?: string | null): ChatOpenAI => {
    return new ChatOpenAI({
      model: modelId ?? this.modelName,
      ...(temperature !== null ? { temperature: temperature ?? this.temperature } : {}),
      apiKey: this.apiKey,
      configuration: {
        baseURL: this.baseUrl,
      },
    });
  };

  /** Вызов LLM с набором сообщений, возвращает текст ответа */
  public invoke = async (
    messages: { role: 'system' | 'user' | 'assistant'; content: string; }[],
    temperature?: number,
    modelId?: string | null,
  ): Promise<string> => {
    const model = this.getChatModel(temperature, modelId);
    const langchainMessages = messages.map((message) => {
      if (message.role === 'system') {
        return { _getType: () => 'system' as const, content: message.content };
      }
      if (message.role === 'user') {
        return { _getType: () => 'human' as const, content: message.content };
      }
      return { _getType: () => 'ai' as const, content: message.content };
    });
    const res = await model.invoke(langchainMessages as any);
    return typeof res.content === 'string' ? res.content.trim() : JSON.stringify(res.content);
  };
}
