import { SocksProxyAgent } from 'socks-proxy-agent';
import { Telegraf, Input } from 'telegraf';
import { Container, Singleton } from 'typescript-ioc';
import type { ExtraReplyMessage, ExtraEditMessageText } from 'telegraf/typings/telegram-types';
import type { Context } from 'telegraf';

import { LoggerService } from '@/services/app/logger.service';

@Singleton
export class TelegramBotService {
  private readonly TAG = 'TelegramBotService';

  private readonly loggerService = Container.get(LoggerService);

  private bot: Telegraf<Context> | null = null;

  private readonly socksProxyAgent: SocksProxyAgent | null = process.env.PROXY_USER && process.env.PROXY_PASS && process.env.PROXY_HOST
    ? new SocksProxyAgent(`socks5://${process.env.PROXY_USER}:${process.env.PROXY_PASS}@${process.env.PROXY_HOST}`)
    : null;

  public getSocksProxyAgent = (): SocksProxyAgent | null => this.socksProxyAgent;

  public init = async () => {
    try {
      this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN ?? '', this.socksProxyAgent
        ? {
          telegram: {
            agent: this.socksProxyAgent,
          },
        }
        : {});

      await this.bot.telegram.setMyCommands([
        { command: 'start', description: '🔃 Запуск бота' },
        { command: 'resume', description: '📄 Загрузить резюме' },
        { command: 'model', description: '🤖 Выбрать модель ИИ' },
        { command: 'reminders', description: '🔔 Напоминания' },
        { command: 'stop', description: '⛔ Остановить текущий поиск' },
        { command: 'help', description: '❓ Помощь' },
      ]);

      this.loggerService.info(this.TAG, 'Telegram bot initialized');
    } catch (error) {
      this.loggerService.error(this.TAG, error);
    }
  };

  public getBot = () => {
    if (!this.bot) {
      throw new Error('Telegram bot is not initialized. Call init() first.');
    }
    return this.bot;
  };

  public sendMessage = async (text: string, telegramId: string, options?: ExtraReplyMessage) => {
    try {
      return this.getBot().telegram.sendMessage(telegramId, text, {
        parse_mode: 'HTML',
        ...options,
      });
    } catch (error) {
      this.loggerService.error(this.TAG, `Ошибка отправки сообщения на telegramId ${telegramId}`, error);
      throw error;
    }
  };

  public editMessage = async (text: string, telegramId: string, messageId: number, options?: ExtraEditMessageText) => {
    try {
      return this.getBot().telegram.editMessageText(telegramId, messageId, undefined, text, {
        parse_mode: 'HTML',
        ...options,
      });
    } catch {
      this.loggerService.debug(this.TAG, 'Сообщение могло быть удалено или текст не изменился');
    }
  };

  /** Отправка файла буфером (фото или документ в зависимости от mime) */
  public sendFileFromBuffer = async (telegramId: string, buffer: Buffer, mime: string, fileName?: string) => {
    try {
      const inputFile = Input.fromBuffer(buffer, fileName ?? 'file');
      if (mime.startsWith('image/')) {
        return this.getBot().telegram.sendPhoto(telegramId, inputFile, { parse_mode: 'HTML' });
      }
      return this.getBot().telegram.sendDocument(telegramId, inputFile, { parse_mode: 'HTML' });
    } catch (error) {
      this.loggerService.error(this.TAG, `Ошибка отправки файла на telegramId ${telegramId}`, error);
      throw error;
    }
  };
}
