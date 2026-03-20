import moment from 'moment-timezone';
import { isNil } from 'lodash-es';

import { BaseService } from '@/services/app/base.service';
import { ConversationHistoryEntity } from '@/db/entities/conversation-history.entity';
import { RequestEntity } from '@/db/entities/request.entity';
import { TelegramDialogStateEntity, TelegramDialogStateEnum } from '@/db/entities/telegram-dialog-state.entity';
import { UserEntity } from '@/db/entities/user.entity';

export abstract class BaseAgentService extends BaseService {
  protected abstract readonly TAG: string;

  protected abstract readonly AGENT_NAME: string;

  protected readonly MOSCOW_TIMEZONE = 'Europe/Moscow';

  protected saveHistory = async (
    telegramId: string,
    userId: number,
    requestId: number,
    question: string,
    answer: string,
  ): Promise<void> => {
    try {
      for (const [role, content] of [['user', question], ['assistant', answer]] as const) {
        const historyEntry = new ConversationHistoryEntity();
        historyEntry.telegramId = telegramId;
        historyEntry.user = { id: userId } as UserEntity;
        historyEntry.request = { id: requestId } as RequestEntity;
        historyEntry.role = role;
        historyEntry.content = content;
        historyEntry.agentName = this.AGENT_NAME;
        await historyEntry.save();
      }
    } catch (error) {
      this.loggerService.error(this.TAG, 'Ошибка сохранения истории', error);
    }
  };

  protected parseJsonResponse = <T>(content: string): T | null => {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (isNil(jsonMatch)) {
        return null;
      }
      return JSON.parse(jsonMatch[0]) as T;
    } catch {
      this.loggerService.error(this.TAG, 'Ошибка парсинга JSON ответа LLM', { content });
      return null;
    }
  };

  protected formatDate = (date: Date): string =>
    moment(date).tz(this.MOSCOW_TIMEZONE).locale('ru').format('D MMMM HH:mm');

  protected saveDialogState = async (
    telegramId: string,
    state: TelegramDialogStateEnum,
    data: object,
    userId?: number,
  ): Promise<void> => {
    let dialogState = await TelegramDialogStateEntity.findOne({ where: { telegramId } });

    if (isNil(dialogState)) {
      dialogState = new TelegramDialogStateEntity();
      dialogState.telegramId = telegramId;
    }

    if (userId) {
      dialogState.user = { id: userId } as UserEntity;
    }

    dialogState.state = state;
    dialogState.data = data;
    await dialogState.save();
  };

  protected clearDialogState = async (telegramId: string): Promise<void> => {
    const dialogState = await TelegramDialogStateEntity.findOne({ where: { telegramId } });

    if (isNil(dialogState)) {
      return;
    }

    dialogState.state = TelegramDialogStateEnum.IDLE;
    dialogState.data = null;
    await dialogState.save();
  };
}
