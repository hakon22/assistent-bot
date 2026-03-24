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

  private readonly socksProxyAgent: SocksProxyAgent | null = process.env.TELEGRAM_PROXY_USER && process.env.TELEGRAM_PROXY_PASS && process.env.TELEGRAM_PROXY_HOST
    ? new SocksProxyAgent(`socks5://${process.env.TELEGRAM_PROXY_USER}:${process.env.TELEGRAM_PROXY_PASS}@${process.env.TELEGRAM_PROXY_HOST}`)
    : null;

  private readonly PHOTO_SIZE_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB

  // Теги, которые поддерживает Telegram HTML-парсер
  private readonly ALLOWED_TELEGRAM_TAGS = new Set(['b', 'i', 'u', 's', 'strike', 'del', 'code', 'pre', 'a', 'tg-spoiler', 'tg-emoji']);

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
      return this.getBot().telegram.sendMessage(telegramId, this.sanitizeTelegramHtml(text), {
        parse_mode: 'HTML',
        ...options,
      });
    } catch (error) {
      this.loggerService.error(this.TAG, `Ошибка отправки сообщения на telegramId ${telegramId}`, error);
      throw error;
    }
  };

  /** Обновить только inline-клавиатуру (например callback_data после появления requestId). */
  public editMessageReplyMarkup = async (
    telegramId: string,
    messageId: number,
    replyMarkup: { inline_keyboard: { text: string; callback_data: string; }[][]; },
  ): Promise<void> => {
    try {
      await this.getBot().telegram.editMessageReplyMarkup(telegramId, messageId, undefined, replyMarkup);
    } catch (error) {
      this.loggerService.debug(this.TAG, 'editMessageReplyMarkup failed', error);
    }
  };

  public editMessage = async (text: string, telegramId: string, messageId: number, options?: ExtraEditMessageText) => {
    const sanitizedText = this.sanitizeTelegramHtml(text);
    try {
      return await this.getBot().telegram.editMessageText(telegramId, messageId, undefined, sanitizedText, {
        parse_mode: 'HTML',
        ...options,
      });
    } catch (error: any) {
      const description: string = error?.description ?? error?.message ?? '';
      if (description.includes('message is not modified') || description.includes('not found')) {
        this.loggerService.debug(this.TAG, 'editMessage: сообщение не изменилось или удалено');
        return;
      }
      // Для любой другой ошибки (например, Can't parse entities) — отправляем новым сообщением
      this.loggerService.warn(this.TAG, `editMessage failed, falling back to sendMessage: ${description}`);
      try {
        await this.getBot().telegram.sendMessage(telegramId, sanitizedText, { parse_mode: 'HTML' });
      } catch (sendError: any) {
        this.loggerService.error(this.TAG, 'sendMessage fallback also failed', sendError);
      }
    }
  };

  /** Отправка файла буфером (фото или документ в зависимости от mime и размера) */
  public sendFileFromBuffer = async (telegramId: string, buffer: Buffer, mime: string, fileName?: string) => {
    try {
      const inputFile = Input.fromBuffer(buffer, fileName ?? 'file');
      if (mime.startsWith('image/') && buffer.length <= this.PHOTO_SIZE_LIMIT_BYTES) {
        this.loggerService.debug(this.TAG, `sendFileFromBuffer → sendPhoto (${buffer.length} bytes)`);
        return this.getBot().telegram.sendPhoto(telegramId, inputFile, { parse_mode: 'HTML' });
      }
      this.loggerService.debug(this.TAG, `sendFileFromBuffer → sendDocument (${buffer.length} bytes, mime: ${mime})`);
      return this.getBot().telegram.sendDocument(telegramId, inputFile, { parse_mode: 'HTML' });
    } catch (error) {
      this.loggerService.error(this.TAG, `Ошибка отправки файла на telegramId ${telegramId}`, error);
      throw error;
    }
  };

  private sanitizeTelegramHtml = (text: string): string =>
    text.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?\s*\/?>/g, (match, tagName: string) => {
      if (this.ALLOWED_TELEGRAM_TAGS.has(tagName.toLowerCase())) {
        return match;
      }
      return '';
    });
}
