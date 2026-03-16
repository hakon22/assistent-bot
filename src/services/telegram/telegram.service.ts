import { Container, Singleton } from 'typescript-ioc';
import type { ExtraReplyMessage } from 'telegraf/typings/telegram-types';
import type { Request, Response } from 'express';

import { UserEntity } from '@/db/entities/user.entity';
import { LoggerService } from '@/services/app/logger.service';
import { TelegramBotService } from '@/services/telegram/telegram-bot.service';

@Singleton
export class TelegramService {
  private readonly TAG = 'TelegramService';

  private readonly loggerService = Container.get(LoggerService);

  private readonly telegramBotService = Container.get(TelegramBotService);

  public handleWebhook = async (req: Request, res: Response) => {
    try {
      const bot = this.telegramBotService.getBot();
      await bot.handleUpdate(req.body);
      res.sendStatus(200);
    } catch (e) {
      this.loggerService.error(this.TAG, e);
      res.sendStatus(500);
    }
  };

  public start = async (telegramId: string) => {
    const user = await UserEntity.findOne({ where: { telegramId } });
    const name = user?.firstName || user?.username || 'друг';

    const message = [
      `Привет, ${name}! 👋`,
      'Я твой персональный ассистент.',
      '',
      'Я могу помочь тебе:',
      '• <b>Найти работу</b> — пришли резюме командой /resume, и я подберу вакансии на hh.ru.',
      '• <b>Найти туры и отели</b> — спроси «найди тур в Турцию» или «отели в Сочи».',
      '• <b>Ответить на любой вопрос</b> — просто напиши, что тебя интересует.',
      '',
      'Просто напиши свой вопрос или воспользуйся командами меню.',
    ];

    await this.sendMessage(message, telegramId);
  };

  public sendMessage = async (message: string | string[], telegramId: string, options?: ExtraReplyMessage) => {
    const text = this.serializeText(message);

    const result = await this.telegramBotService.sendMessage(text, telegramId, options);
    if (result?.message_id) {
      this.loggerService.info(this.TAG, `Сообщение отправлено на telegramId ${telegramId}`);
      return { ...result, text };
    }
  };

  public editMessage = async (message: string | string[], telegramId: string, messageId: number, options?: ExtraReplyMessage) => {
    const text = this.serializeText(message);
    return this.telegramBotService.editMessage(text, telegramId, messageId, options);
  };

  public sendAdminMessages = async (message: string | string[], options?: ExtraReplyMessage) => {
    for (const tgId of [process.env.TELEGRAM_CHAT_ID].filter(Boolean)) {
      const adminUser = await UserEntity.findOne({ select: ['id', 'telegramId'], where: { telegramId: tgId } });
      if (!adminUser?.telegramId) {
        continue;
      }
      await this.sendMessage(message, adminUser.telegramId, options);
    }
  };

  private serializeText = (message: string | string[]) =>
    Array.isArray(message) ? message.reduce((acc, field) => acc += `${field}\n`, '') : message;
}
