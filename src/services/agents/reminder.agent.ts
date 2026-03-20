import { Container, Singleton } from 'typescript-ioc';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import moment from 'moment-timezone';
import { isNil, isEmpty } from 'lodash-es';

import { BaseAgentService } from '@/services/agents/base-agent.service';
import { ModelService } from '@/services/model/model.service';
import { ReminderEntity, ReminderStatusEnum, ReminderTypeEnum } from '@/db/entities/reminder.entity';
import { TelegramDialogStateEntity, TelegramDialogStateEnum } from '@/db/entities/telegram-dialog-state.entity';
import { UserEntity } from '@/db/entities/user.entity';

export interface ReminderAgentInput {
  telegramId: string;
  userId: number;
  requestId: number;
  messageText: string;
  modelId?: string | null;
}

export interface ReminderAgentResult {
  responseText: string;
  inlineKeyboard?: string | null;
}

type ReminderIntent = 'CREATE' | 'LIST' | 'DELETE' | 'EDIT';

interface ParsedReminderResponse {
  intent: ReminderIntent;
  reminderText: string;
  targetPerson: 'self' | 'partner';
  scheduled: string | null;
  needsClarification: boolean;
  clarificationQuestion: string | null;
  confirmationMessage: string | null;
  searchQuery: string | null;
  newScheduled: string | null;
  newReminderText: string | null;
}

interface ParsedTimeResponse {
  scheduled: string | null;
  confirmationMessage: string;
}

interface PartialReminderState {
  reminderText: string;
  targetPerson: 'self' | 'partner';
}

interface PendingEditState {
  reminderId: number;
  newReminderText: string | null;
  newScheduled: string | null;
}

interface EditWaitingState {
  reminderId: number;
}

@Singleton
export class ReminderAgentService extends BaseAgentService {
  protected readonly TAG = 'ReminderAgentService';

  protected readonly AGENT_NAME = 'reminder_agent';

  private readonly OWNER_TELEGRAM_ID = process.env.TELEGRAM_CHAT_ID ?? '';

  private readonly WIFE_TELEGRAM_ID = process.env.TELEGRAM_CHAT_ID2 ?? '';

  private readonly modelService = Container.get(ModelService);

  public process = async (input: ReminderAgentInput): Promise<ReminderAgentResult> => {
    this.loggerService.info(this.TAG, 'Начало обработки запроса на напоминание', { telegramId: input.telegramId });

    try {
      const dialogState = await TelegramDialogStateEntity.findOne({
        where: { telegramId: input.telegramId },
      });

      if (dialogState?.state === TelegramDialogStateEnum.REMINDER_CLARIFICATION_WAITING) {
        return await this.processTimeClarification(input, dialogState);
      }

      if (dialogState?.state === TelegramDialogStateEnum.REMINDER_EDIT_WAITING) {
        return await this.processEditWaiting(input, dialogState);
      }

      return await this.processInitialRequest(input);
    } catch (error) {
      this.loggerService.error(this.TAG, 'process', error);
      throw error;
    }
  };

  /** Возвращает список предстоящих PENDING-напоминаний пользователя с inline-клавиатурой */
  public buildRemindersList = async (userId: number, telegramId: string): Promise<ReminderAgentResult> => {
    const reminders = await ReminderEntity.createQueryBuilder('reminder')
      .setParameters({
        userId,
        status: ReminderStatusEnum.PENDING,
      })
      .where('reminder.user = :userId')
      .andWhere('reminder.status = :status')
      .orderBy('reminder.scheduled', 'ASC')
      .getMany();

    if (isEmpty(reminders)) {
      return { responseText: '📭 У тебя нет запланированных напоминаний.' };
    }

    const isOwner = telegramId === this.OWNER_TELEGRAM_ID;
    const partnerLabel = isOwner ? 'зайчику' : 'мужу';

    const lines: string[] = ['📋 <b>Мои напоминания:</b>', ''];
    const keyboardRows: { text: string; callback_data: string; }[][] = [];

    reminders.forEach((reminder, index) => {
      const number = index + 1;
      const dateStr = this.formatDate(reminder.scheduled);
      const targetLabel = reminder.reminderType === ReminderTypeEnum.PARTNER ? ` → ${partnerLabel}` : '';
      lines.push(`${number}. 📅 <b>${dateStr}</b>${targetLabel}`);
      lines.push(`   ${reminder.reminderText}`);
      lines.push('');
      keyboardRows.push([
        { text: `✏️ ${number}`, callback_data: `reminder:edit:${reminder.id}` },
        { text: `🗑 ${number}`, callback_data: `reminder:delete:${reminder.id}` },
      ]);
    });

    return {
      responseText: lines.join('\n').trimEnd(),
      inlineKeyboard: JSON.stringify({ inline_keyboard: keyboardRows }),
    };
  };

  /** Строит сообщение подтверждения удаления с inline-клавиатурой */
  public buildDeleteConfirmation = (reminder: ReminderEntity): ReminderAgentResult => {
    const dateStr = this.formatDate(reminder.scheduled);
    const lines = [
      '🗑 <b>Удалить напоминание?</b>',
      '',
      `📅 ${dateStr}`,
      reminder.reminderText,
    ];

    const keyboard = {
      inline_keyboard: [[
        { text: '✅ Подтвердить', callback_data: `reminder:confirm_delete:${reminder.id}` },
        { text: '❌ Отмена', callback_data: 'reminder:cancel' },
      ]],
    };

    return {
      responseText: lines.join('\n'),
      inlineKeyboard: JSON.stringify(keyboard),
    };
  };

  // ──────────────── INTENT PROCESSING ────────────────

  private processInitialRequest = async (input: ReminderAgentInput): Promise<ReminderAgentResult> => {
    const { telegramId, userId, requestId, messageText, modelId } = input;

    this.loggerService.info(this.TAG, 'Обработка первичного запроса', { telegramId, messageText });

    const systemPrompt = this.buildInitialSystemPrompt(telegramId);
    const model = this.modelService.getChatModel(0.1, modelId);

    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(messageText),
    ]);

    const content = typeof response.content === 'string' ? response.content.trim() : '';
    const parsed = this.parseJsonResponse<ParsedReminderResponse>(content);

    if (isNil(parsed)) {
      const fallback = 'Не смог разобрать запрос. Попробуй написать, например: «Напомни мне позвонить маме завтра в 10 утра»';
      await this.saveHistory(telegramId, userId, requestId, messageText, fallback);
      return { responseText: fallback };
    }

    const { intent } = parsed;
    this.loggerService.info(this.TAG, `Определён интент: ${intent}`, { telegramId });

    if (intent === 'LIST') {
      const result = await this.buildRemindersList(userId, telegramId);
      await this.saveHistory(telegramId, userId, requestId, messageText, result.responseText);
      return result;
    }

    if (intent === 'DELETE') {
      return this.processDeleteIntent(input, parsed);
    }

    if (intent === 'EDIT') {
      return this.processEditIntent(input, parsed);
    }

    // CREATE
    return this.processCreateIntent(input, parsed);
  };

  private processCreateIntent = async (input: ReminderAgentInput, parsed: ParsedReminderResponse): Promise<ReminderAgentResult> => {
    const { telegramId, userId, requestId, messageText } = input;

    if (parsed.needsClarification) {
      const question = parsed.clarificationQuestion ?? 'Когда тебе напомнить?';

      if (!isNil(parsed.reminderText) && parsed.reminderText.trim()) {
        await this.saveDialogState(telegramId, TelegramDialogStateEnum.REMINDER_CLARIFICATION_WAITING, {
          reminderText: parsed.reminderText,
          targetPerson: parsed.targetPerson,
        }, userId);
      } else {
        this.loggerService.warn(this.TAG, 'needsClarification=true но reminderText пустой — стейт не сохраняем', { telegramId });
      }

      await this.saveHistory(telegramId, userId, requestId, messageText, question);
      this.loggerService.info(this.TAG, 'Ожидание уточнения', { telegramId });
      return { responseText: question };
    }

    const targetTelegramId = this.resolveTargetTelegramId(telegramId, parsed.targetPerson);
    const reminderType = parsed.targetPerson === 'partner' ? ReminderTypeEnum.PARTNER : ReminderTypeEnum.SELF;
    const scheduled = new Date(parsed.scheduled!);

    await this.saveReminder(userId, telegramId, targetTelegramId, parsed.reminderText, scheduled, reminderType);
    await this.clearDialogState(telegramId);

    const confirmation = parsed.confirmationMessage ?? 'Напоминание записано!';
    await this.saveHistory(telegramId, userId, requestId, messageText, confirmation);

    this.loggerService.info(this.TAG, 'Напоминание сохранено', { telegramId, targetTelegramId, scheduled });

    return { responseText: confirmation };
  };

  private processDeleteIntent = async (input: ReminderAgentInput, parsed: ParsedReminderResponse): Promise<ReminderAgentResult> => {
    const { telegramId, userId, requestId, messageText } = input;

    const searchQuery = parsed.searchQuery ?? parsed.reminderText ?? '';
    const reminders = await this.findPendingReminders(userId, searchQuery);

    if (isEmpty(reminders)) {
      const response = `Не нашёл активных напоминаний по запросу «${searchQuery}». Используй /reminders чтобы увидеть все напоминания.`;
      await this.saveHistory(telegramId, userId, requestId, messageText, response);
      return { responseText: response };
    }

    if (reminders.length > 1) {
      const listResult = await this.buildRemindersList(userId, telegramId);
      const prefix = `Нашёл ${reminders.length} подходящих напоминания. Выбери нужное:\n\n`;
      await this.saveHistory(telegramId, userId, requestId, messageText, prefix + listResult.responseText);
      return { responseText: prefix + listResult.responseText, inlineKeyboard: listResult.inlineKeyboard };
    }

    const [reminder] = reminders;
    const result = this.buildDeleteConfirmation(reminder);
    await this.saveHistory(telegramId, userId, requestId, messageText, result.responseText);
    return result;
  };

  private processEditIntent = async (input: ReminderAgentInput, parsed: ParsedReminderResponse): Promise<ReminderAgentResult> => {
    const { telegramId, userId, requestId, messageText } = input;

    const searchQuery = parsed.searchQuery ?? parsed.reminderText ?? '';
    const reminders = await this.findPendingReminders(userId, searchQuery);

    if (isEmpty(reminders)) {
      const response = `Не нашёл активных напоминаний по запросу «${searchQuery}». Используй /reminders чтобы увидеть все напоминания.`;
      await this.saveHistory(telegramId, userId, requestId, messageText, response);
      return { responseText: response };
    }

    if (reminders.length > 1) {
      const listResult = await this.buildRemindersList(userId, telegramId);
      const prefix = `Нашёл ${reminders.length} подходящих напоминания. Выбери нужное:\n\n`;
      await this.saveHistory(telegramId, userId, requestId, messageText, prefix + listResult.responseText);
      return { responseText: prefix + listResult.responseText, inlineKeyboard: listResult.inlineKeyboard };
    }

    const [reminder] = reminders;
    const hasNewInfo = !isNil(parsed.newScheduled) || !isNil(parsed.newReminderText);

    if (!hasNewInfo) {
      await this.saveDialogState(telegramId, TelegramDialogStateEnum.REMINDER_EDIT_WAITING, {
        reminderId: reminder.id,
      }, userId);
      const dateStr = this.formatDate(reminder.scheduled);
      const response = `✏️ Редактирую напоминание:\n\n📅 ${dateStr}\n${reminder.reminderText}\n\nЧто изменить? Введи новый текст или новое время:`;
      await this.saveHistory(telegramId, userId, requestId, messageText, response);
      return { responseText: response };
    }

    return this.buildEditConfirmation(telegramId, userId, requestId, messageText, reminder, {
      newReminderText: parsed.newReminderText,
      newScheduled: parsed.newScheduled,
    });
  };

  private processTimeClarification = async (input: ReminderAgentInput, dialogState: TelegramDialogStateEntity): Promise<ReminderAgentResult> => {
    const { telegramId, userId, requestId, messageText, modelId } = input;

    this.loggerService.info(this.TAG, 'Обработка уточнения времени', { telegramId });

    const partialState = dialogState.data as PartialReminderState | null;
    const { reminderText, targetPerson } = partialState ?? { reminderText: null, targetPerson: 'self' as const };

    if (isNil(reminderText) || !reminderText.trim()) {
      this.loggerService.warn(this.TAG, 'reminderText отсутствует в dialogState — обрабатываем как новый запрос', { telegramId });
      await this.clearDialogState(telegramId);
      return this.processInitialRequest(input);
    }

    const systemPrompt = this.buildTimeParsingSystemPrompt();
    const model = this.modelService.getChatModel(0.1, modelId);

    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(messageText),
    ]);

    const content = typeof response.content === 'string' ? response.content.trim() : '';
    const parsed = this.parseJsonResponse<ParsedTimeResponse>(content);

    if (isNil(parsed) || isNil(parsed.scheduled)) {
      const fallback = 'Не смог понять время. Укажи, пожалуйста, например: «завтра в 10 утра» или «20 марта в 15:30»';
      await this.saveHistory(telegramId, userId, requestId, messageText, fallback);
      return { responseText: fallback };
    }

    const targetTelegramId = this.resolveTargetTelegramId(telegramId, targetPerson);
    const reminderType = targetPerson === 'partner' ? ReminderTypeEnum.PARTNER : ReminderTypeEnum.SELF;
    const scheduled = new Date(parsed.scheduled);

    await this.saveReminder(userId, telegramId, targetTelegramId, reminderText, scheduled, reminderType);
    await this.clearDialogState(telegramId);

    const confirmation = parsed.confirmationMessage;
    await this.saveHistory(telegramId, userId, requestId, messageText, confirmation);

    this.loggerService.info(this.TAG, 'Напоминание сохранено после уточнения', { telegramId, targetTelegramId, scheduled });

    return { responseText: confirmation };
  };

  private processEditWaiting = async (input: ReminderAgentInput, dialogState: TelegramDialogStateEntity): Promise<ReminderAgentResult> => {
    const { telegramId, userId, requestId, messageText, modelId } = input;

    this.loggerService.info(this.TAG, 'Обработка ввода при редактировании', { telegramId });

    const { reminderId } = dialogState.data as EditWaitingState;
    const reminder = await ReminderEntity.findOne({ where: { id: reminderId } });

    if (isNil(reminder) || reminder.status !== ReminderStatusEnum.PENDING) {
      await this.clearDialogState(telegramId);
      const response = 'Напоминание не найдено или уже отправлено. Используй /reminders для просмотра списка.';
      await this.saveHistory(telegramId, userId, requestId, messageText, response);
      return { responseText: response };
    }

    const systemPrompt = this.buildEditParsingSystemPrompt(reminder);
    const model = this.modelService.getChatModel(0.1, modelId);

    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(messageText),
    ]);

    const content = typeof response.content === 'string' ? response.content.trim() : '';
    const parsed = this.parseJsonResponse<{ newReminderText: string | null; newScheduled: string | null; }>( content);

    if (isNil(parsed) || (isNil(parsed.newReminderText) && isNil(parsed.newScheduled))) {
      const fallback = 'Не смог понять что изменить. Введи новый текст напоминания или новое время (например, «завтра в 10 утра»).';
      await this.saveHistory(telegramId, userId, requestId, messageText, fallback);
      return { responseText: fallback };
    }

    return this.buildEditConfirmation(telegramId, userId, requestId, messageText, reminder, parsed);
  };

  // ──────────────── EDIT CONFIRMATION ────────────────

  private buildEditConfirmation = async (
    telegramId: string,
    userId: number,
    requestId: number,
    messageText: string,
    reminder: ReminderEntity,
    changes: { newReminderText: string | null; newScheduled: string | null; },
  ): Promise<ReminderAgentResult> => {
    const pendingEdit: PendingEditState = {
      reminderId: reminder.id,
      newReminderText: changes.newReminderText,
      newScheduled: changes.newScheduled,
    };

    await this.saveDialogState(telegramId, TelegramDialogStateEnum.REMINDER_EDIT_CONFIRM_WAITING, pendingEdit, userId);

    const oldDate = this.formatDate(reminder.scheduled);
    const newDate = changes.newScheduled ? this.formatDate(new Date(changes.newScheduled)) : null;
    const newText = changes.newReminderText ?? reminder.reminderText;

    const lines = ['✏️ <b>Изменить напоминание?</b>', ''];

    if (newDate && newDate !== oldDate) {
      lines.push(`📅 Было: ${oldDate}`);
      lines.push(`📅 Станет: <b>${newDate}</b>`);
    } else {
      lines.push(`📅 ${oldDate}`);
    }

    lines.push(`📝 ${newText}`);

    const keyboard = {
      inline_keyboard: [[
        { text: '✅ Подтвердить', callback_data: `reminder:confirm_edit:${reminder.id}` },
        { text: '❌ Отмена', callback_data: 'reminder:cancel' },
      ]],
    };

    const responseText = lines.join('\n');
    await this.saveHistory(telegramId, userId, requestId, messageText, responseText);

    return { responseText, inlineKeyboard: JSON.stringify(keyboard) };
  };

  /** Применяет изменения из состояния REMINDER_EDIT_CONFIRM_WAITING */
  public applyPendingEdit = async (telegramId: string, reminderId: number): Promise<string> => {
    const dialogState = await TelegramDialogStateEntity.findOne({ where: { telegramId } });

    if (isNil(dialogState) || dialogState.state !== TelegramDialogStateEnum.REMINDER_EDIT_CONFIRM_WAITING) {
      return 'Нет ожидающих изменений. Используй /reminders для управления напоминаниями.';
    }

    const { reminderId: pendingId, newReminderText, newScheduled } = dialogState.data as PendingEditState;

    if (pendingId !== reminderId) {
      return 'Ошибка подтверждения: идентификатор не совпадает. Попробуй снова.';
    }

    const reminder = await ReminderEntity.findOne({ where: { id: reminderId } });
    if (isNil(reminder) || reminder.status !== ReminderStatusEnum.PENDING) {
      await this.clearDialogState(telegramId);
      return 'Напоминание не найдено или уже отправлено.';
    }

    if (!isNil(newReminderText)) {
      reminder.reminderText = newReminderText;
    }
    if (!isNil(newScheduled)) {
      reminder.scheduled = new Date(newScheduled);
    }

    await reminder.save();
    await this.clearDialogState(telegramId);

    const dateStr = this.formatDate(reminder.scheduled);
    this.loggerService.info(this.TAG, 'Напоминание обновлено', { reminderId, telegramId });

    return `✅ Напоминание обновлено!\n\n📅 ${dateStr}\n${reminder.reminderText}`;
  };

  /** Мягко удаляет напоминание */
  public cancelReminder = async (telegramId: string, reminderId: number): Promise<string> => {
    const reminder = await ReminderEntity.findOne({
      where: { id: reminderId, status: ReminderStatusEnum.PENDING },
    });

    if (isNil(reminder)) {
      return 'Напоминание не найдено или уже отправлено/удалено.';
    }

    reminder.status = ReminderStatusEnum.CANCELLED;
    await reminder.save();
    await reminder.softRemove();

    this.loggerService.info(this.TAG, 'Напоминание удалено (soft delete)', { reminderId, telegramId });

    return '🗑 Напоминание удалено.';
  };

  /** Устанавливает состояние REMINDER_EDIT_WAITING для конкретного напоминания (из /reminders) */
  public startEditFromCommand = async (telegramId: string, reminderId: number): Promise<string> => {
    const reminder = await ReminderEntity.findOne({
      where: { id: reminderId, status: ReminderStatusEnum.PENDING },
    });

    if (isNil(reminder)) {
      return 'Напоминание не найдено или уже отправлено.';
    }

    await this.saveDialogState(telegramId, TelegramDialogStateEnum.REMINDER_EDIT_WAITING, { reminderId });

    const dateStr = this.formatDate(reminder.scheduled);
    return `✏️ Редактирую напоминание:\n\n📅 ${dateStr}\n${reminder.reminderText}\n\nЧто изменить? Введи новый текст или новое время:`;
  };

  // ──────────────── SYSTEM PROMPTS ────────────────

  private buildInitialSystemPrompt = (senderTelegramId: string): string => {
    const now = moment().tz(this.MOSCOW_TIMEZONE);
    const currentDatetime = now.format('D MMMM YYYY, HH:mm (dddd)');

    const isOwner = senderTelegramId === this.OWNER_TELEGRAM_ID;
    const senderRole = isOwner ? 'муж (владелец бота)' : 'жена';
    const partnerRole = isOwner ? 'жена' : 'муж (владелец бота)';

    return [
      'Ты — умный агент-напоминальщик. Определи намерение пользователя и верни структурированный JSON.',
      '',
      `Текущие дата и время: ${currentDatetime} (Московское время, UTC+3).`,
      '',
      'Информация о пользователях:',
      `- Текущий пользователь: ${senderRole}`,
      `- Партнёр: ${partnerRole}`,
      '- Псевдоним партнёра: «зайчик» — если упоминается, адресат всегда партнёр.',
      '',
      'Возможные намерения (intent):',
      '- CREATE — создать новое напоминание',
      '- LIST — показать список своих напоминаний',
      '- DELETE — удалить напоминание',
      '- EDIT — изменить напоминание',
      '',
      'Верни ТОЛЬКО валидный JSON без пояснений:',
      '{',
      '  "intent": "CREATE" | "LIST" | "DELETE" | "EDIT",',
      '  "reminderText": "текст напоминания или null",',
      '  "targetPerson": "self" или "partner",',
      '  "scheduled": "ISO 8601 с +03:00" или null,',
      '  "needsClarification": true | false,',
      '  "clarificationQuestion": "вопрос или null",',
      '  "confirmationMessage": "подтверждение (HTML Telegram) или null",',
      '  "searchQuery": "ключевое слово для поиска существующего напоминания или null",',
      '  "newScheduled": "ISO 8601 с +03:00 для EDIT или null",',
      '  "newReminderText": "новый текст для EDIT или null"',
      '}',
      '',
      'Правила:',
      '- CREATE без времени: needsClarification: true, clarificationQuestion — вопрос о времени.',
      '- «утром» = 09:00, «днём» = 13:00, «вечером» = 19:00, «ночью» = 22:00.',
      '- «завтра» = следующий день, «послезавтра» = через 2 дня.',
      '- confirmationMessage: HTML, пример: «Записал! ✅ Напомню <b>20 марта в 10:00</b>»',
      '- Для DELETE/EDIT: searchQuery — ключевое слово из текста напоминания.',
      '- Для EDIT с новым временем: заполни newScheduled.',
      '- Для EDIT с новым текстом: заполни newReminderText.',
    ].join('\n');
  };

  private buildTimeParsingSystemPrompt = (): string => {
    const now = moment().tz(this.MOSCOW_TIMEZONE);
    const currentDatetime = now.format('D MMMM YYYY, HH:mm (dddd)');

    return [
      'Ты — парсер времени. Пользователь уточняет время для напоминания. Верни ТОЛЬКО валидный JSON.',
      '',
      `Текущие дата и время: ${currentDatetime} (Московское время, UTC+3).`,
      '',
      '{ "scheduled": "ISO 8601 с +03:00 или null", "confirmationMessage": "подтверждение (HTML Telegram)" }',
      '',
      '«утром» = 09:00, «днём» = 13:00, «вечером» = 19:00, «ночью» = 22:00.',
      'Пример confirmationMessage: «Записал! ✅ Напомню <b>20 марта в 10:00</b>»',
    ].join('\n');
  };

  private buildEditParsingSystemPrompt = (reminder: ReminderEntity): string => {
    const now = moment().tz(this.MOSCOW_TIMEZONE);
    const currentDatetime = now.format('D MMMM YYYY, HH:mm (dddd)');
    const reminderDate = this.formatDate(reminder.scheduled);

    return [
      'Ты — парсер изменений напоминания. Определи что пользователь хочет изменить. Верни ТОЛЬКО валидный JSON.',
      '',
      `Текущие дата и время: ${currentDatetime} (Московское время, UTC+3).`,
      '',
      `Текущее напоминание: "${reminder.reminderText}" — ${reminderDate}`,
      '',
      '{ "newReminderText": "новый текст или null", "newScheduled": "ISO 8601 с +03:00 или null" }',
      '',
      '- Если пользователь указал только время — заполни newScheduled, newReminderText = null.',
      '- Если пользователь указал только текст — заполни newReminderText, newScheduled = null.',
      '- «утром» = 09:00, «днём» = 13:00, «вечером» = 19:00.',
    ].join('\n');
  };

  // ──────────────── DB HELPERS ────────────────

  private findPendingReminders = async (userId: number, searchQuery: string): Promise<ReminderEntity[]> => {
    return ReminderEntity.createQueryBuilder('reminder')
      .setParameters({
        userId,
        status: ReminderStatusEnum.PENDING,
        query: `%${searchQuery}%`,
      })
      .where('reminder.user = :userId')
      .andWhere('reminder.status = :status')
      .andWhere('reminder.reminderText ILIKE :query')
      .orderBy('reminder.scheduled', 'ASC')
      .getMany();
  };

  private saveReminder = async (
    userId: number,
    senderTelegramId: string,
    targetTelegramId: string,
    reminderText: string,
    scheduled: Date,
    reminderType: ReminderTypeEnum,
  ): Promise<void> => {
    const reminder = new ReminderEntity();
    reminder.user = { id: userId } as UserEntity;
    reminder.senderTelegramId = senderTelegramId;
    reminder.targetTelegramId = targetTelegramId;
    reminder.reminderText = reminderText;
    reminder.scheduled = scheduled;
    reminder.status = ReminderStatusEnum.PENDING;
    reminder.reminderType = reminderType;
    await reminder.save();

    this.loggerService.info(this.TAG, 'Напоминание записано в БД', {
      userId,
      senderTelegramId,
      targetTelegramId,
      scheduled,
      reminderType,
    });
  };

  private resolveTargetTelegramId = (senderTelegramId: string, targetPerson: string): string => {
    if (targetPerson === 'partner') {
      return senderTelegramId === this.OWNER_TELEGRAM_ID
        ? this.WIFE_TELEGRAM_ID
        : this.OWNER_TELEGRAM_ID;
    }

    return senderTelegramId;
  };

}
