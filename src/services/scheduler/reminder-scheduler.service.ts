import { Container, Singleton } from 'typescript-ioc';
import cron from 'node-cron';
import { LessThanOrEqual } from 'typeorm';

import { BaseService } from '@/services/app/base.service';
import { TelegramService } from '@/services/telegram/telegram.service';
import { ReminderEntity, ReminderStatusEnum } from '@/db/entities/reminder.entity';

@Singleton
export class ReminderSchedulerService extends BaseService {
  private readonly TAG = 'ReminderSchedulerService';

  private readonly OWNER_TELEGRAM_ID = process.env.TELEGRAM_CHAT_ID ?? '';

  private readonly WIFE_TELEGRAM_ID = process.env.TELEGRAM_CHAT_ID2 ?? '';

  private readonly telegramService = Container.get(TelegramService);

  public start = (): void => {
    this.loggerService.info(this.TAG, 'Запуск планировщика напоминаний (каждую минуту)');

    cron.schedule('* * * * *', this.processDueReminders);
  };

  private processDueReminders = async (): Promise<void> => {
    try {
      const dueReminders = await ReminderEntity.find({
        where: {
          status: ReminderStatusEnum.PENDING,
          scheduled: LessThanOrEqual(new Date()),
        },
      });

      if (!dueReminders.length) {
        return;
      }

      this.loggerService.info(this.TAG, `Найдено напоминаний к отправке: ${dueReminders.length}`);

      for (const reminder of dueReminders) {
        await this.sendReminder(reminder);
      }
    } catch (error) {
      this.loggerService.error(this.TAG, 'processDueReminders', error);
    }
  };

  private sendReminder = async (reminder: ReminderEntity): Promise<void> => {
    try {
      const { affected } = await ReminderEntity.createQueryBuilder()
        .update()
        .set({ status: ReminderStatusEnum.SENT })
        .where('id = :id AND status = :status', { id: reminder.id, status: ReminderStatusEnum.PENDING })
        .execute();

      if (!affected) {
        this.loggerService.warn(this.TAG, 'Напоминание уже обработано другим процессом, пропускаем', { reminderId: reminder.id });
        return;
      }

      const text = this.buildReminderText(reminder);

      await this.telegramService.sendMessage(text, reminder.targetTelegramId);

      this.loggerService.info(this.TAG, 'Напоминание отправлено', {
        reminderId: reminder.id,
        targetTelegramId: reminder.targetTelegramId,
      });
    } catch (error) {
      this.loggerService.error(this.TAG, `Ошибка отправки напоминания id=${reminder.id}`, error);
    }
  };

  private buildReminderText = (reminder: ReminderEntity): string => {
    const { senderTelegramId, targetTelegramId, reminderText } = reminder;

    const isFromOwnerToWife = senderTelegramId === this.OWNER_TELEGRAM_ID && targetTelegramId === this.WIFE_TELEGRAM_ID;
    const isFromWifeToOwner = senderTelegramId === this.WIFE_TELEGRAM_ID && targetTelegramId === this.OWNER_TELEGRAM_ID;

    if (isFromOwnerToWife) {
      return `⏰ <b>Напоминание от мужа</b>\n\n${reminderText}`;
    }

    if (isFromWifeToOwner) {
      return `⏰ <b>Напоминание от жены</b>\n\n${reminderText}`;
    }

    return `⏰ <b>Напоминание</b>\n\n${reminderText}`;
  };
}
