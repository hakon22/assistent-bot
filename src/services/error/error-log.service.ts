import { Container, Singleton } from 'typescript-ioc';

import { ErrorLogEntity } from '@/db/entities/error-log.entity';
import { RequestStatusEntity } from '@/db/entities/request-status.entity';
import { LoggerService } from '@/services/app/logger.service';
import { TelegramBotService } from '@/services/telegram/telegram-bot.service';

@Singleton
export class ErrorLogService {
  private readonly TAG = 'ErrorLogService';

  private readonly loggerService = Container.get(LoggerService);

  private readonly telegramBotService = Container.get(TelegramBotService);

  /**
   * Log error to DB, optionally mark request as failed and notify user via Telegram.
   */
  public handle = async (options: {
    error: unknown;
    serviceName?: string;
    nodeName?: string;
    requestId?: number;
    userTelegramId?: string;
    notifyUser?: boolean;
  }): Promise<void> => {
    const { error, serviceName, nodeName, requestId, userTelegramId, notifyUser = true } = options;

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? (error.stack ?? null) : null;

    this.loggerService.error(this.TAG, serviceName, errorMessage, errorStack);

    try {
      const log = new ErrorLogEntity();
      log.requestId = requestId ?? null;
      log.userTelegramId = userTelegramId ?? null;
      log.serviceName = serviceName ?? null;
      log.nodeName = nodeName ?? null;
      log.errorMessage = errorMessage;
      log.errorStack = errorStack;
      log.errorData = error instanceof Error ? { name: error.name } : null;
      log.errorNotified = false;
      const saved = await log.save();

      if (requestId) {
        const requestStatus = new RequestStatusEntity();
        requestStatus.requestId = requestId;
        requestStatus.status = 'failed';
        requestStatus.agentName = serviceName ?? null;
        requestStatus.notes = `Error in ${nodeName ?? serviceName}: ${errorMessage.substring(0, 200)}`;
        await requestStatus.save();
      }

      if (notifyUser && userTelegramId) {
        await this.notifyUser(userTelegramId);
        saved.errorNotified = true;
        await saved.save();
      }
    } catch (dbErr) {
      this.loggerService.error(this.TAG, 'Failed to save error to DB', dbErr);
    }
  };

  private notifyUser = async (telegramId: string): Promise<void> => {
    try {
      const bot = this.telegramBotService.getBot();
      await bot.telegram.sendMessage(
        telegramId,
        '⚠️ Извините, при обработке вашего запроса произошла техническая ошибка.\n\nПожалуйста, попробуйте позже или перефразируйте запрос.',
      );
    } catch (e) {
      this.loggerService.error(this.TAG, 'Failed to notify user about error', e);
    }
  };
}
