import { Container, Singleton } from 'typescript-ioc';
import axios from 'axios';
import PDFParser from 'pdf2json';
import { type Telegraf, type Context } from 'telegraf';

import { TelegramBotService } from '@/services/telegram/telegram-bot.service';
import { TelegramService } from '@/services/telegram/telegram.service';
import { UserEntity } from '@/db/entities/user.entity';
import { TelegramDialogStateEntity, TelegramDialogStateEnum } from '@/db/entities/telegram-dialog-state.entity';
import { ModelEntity } from '@/db/entities/model.entity';
import { ManagerAgentService } from '@/services/agents/manager.agent';
import { JobSearchAgentService } from '@/services/agents/job-search.agent';
import { RequestService } from '@/services/request/request.service';
import { ErrorLogService } from '@/services/error/error-log.service';
import { YandexSttTool } from '@/services/tools/yandex-stt.tool';
import { PlaywrightTool } from '@/services/tools/playwright.tool';
import { BaseService } from '@/services/app/base.service';

const ACKNOWLEDGEMENTS: Record<string, string> = {
  job_search_agent: 'Ищу подходящие вакансии',
  tours_hotels_agent: 'Ищу в интернете',
  general_agent: 'Обрабатываю запрос',
};

const DOTS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

@Singleton
export class TelegramBotCommandService extends BaseService {
  private readonly TAG = 'TelegramBotCommandService';

  private readonly telegramBotService = Container.get(TelegramBotService);

  private readonly telegramService = Container.get(TelegramService);

  private readonly managerAgentService = Container.get(ManagerAgentService);

  private readonly jobSearchAgentService = Container.get(JobSearchAgentService);

  private readonly requestService = Container.get(RequestService);

  private readonly errorLogService = Container.get(ErrorLogService);

  private readonly yandexSttTool = Container.get(YandexSttTool);

  private readonly playwrightTool = Container.get(PlaywrightTool);

  private readonly MAX_ERROR_MESSAGE_LENGTH = 4000;

  /** telegramId → функция отмены текущего запроса */
  private readonly cancelMap = new Map<string, () => void>();

  public register = (bot: Telegraf<Context>): void => {

    // /start
    bot.start(async (ctx) => {
      try {
        const user = await this.ensureUser(ctx);
        if (!this.isAllowed(user)) {
          await ctx.reply('Извините, у вас нет доступа к этому боту.');
          return;
        }
        await this.telegramService.start(user.telegramId);
      } catch (err) {
        await this.sendErrorToUser(ctx.from?.id?.toString(), err);
      }
    });

    // /resume
    bot.command('resume', async (ctx) => {
      try {
        const user = await this.ensureUser(ctx);
        if (!this.isAllowed(user)) {
          return;
        }
        await this.setState(user.telegramId, TelegramDialogStateEnum.PROFILE_WAIT_RESUME);
        await this.telegramService.sendMessage(
          [
            'Пришли резюме одним из способов:',
            '',
            '📎 PDF-файл — прикрепи файл',
            '🔗 Ссылка — отправь URL (hh.ru, LinkedIn и др.)',
          ],
          user.telegramId,
        );
      } catch (err) {
        await this.sendErrorToUser(ctx.from?.id?.toString(), err);
      }
    });

    // /model
    bot.command('model', async (ctx) => {
      try {
        const user = await this.ensureUser(ctx);
        if (!this.isAllowed(user)) {
          return;
        }
        await this.sendModelPicker(user);
      } catch (err) {
        await this.sendErrorToUser(ctx.from?.id?.toString(), err);
      }
    });

    // /stop
    bot.command('stop', async (ctx) => {
      const telegramId = ctx.from?.id?.toString();
      if (!telegramId) return;
      const cancel = this.cancelMap.get(telegramId);
      if (cancel) {
        cancel();
      } else {
        await this.telegramService.sendMessage('Нет активных задач для остановки.', telegramId);
      }
    });

    // /help
    bot.command('help', async (ctx) => {
      try {
        const user = await this.ensureUser(ctx);
        if (!this.isAllowed(user)) {
          return;
        }
        await this.telegramService.sendMessage(
          [
            '<b>Как пользоваться ботом:</b>',
            '',
            '• Напиши любой вопрос — я отвечу.',
            '• «Найди вакансии Python разработчика» — поищу на hh.ru.',
            '• «Найди туры в Турцию в июне» — поищу в интернете.',
            '• /resume — загрузить резюме для умного подбора вакансий.',
            '• /model — выбрать модель ИИ для общения.',
            '• /stop — остановить текущий поиск.',
          ],
          user.telegramId,
        );
      } catch (err) {
        await this.sendErrorToUser(ctx.from?.id?.toString(), err);
      }
    });

    // Текстовые сообщения
    bot.on('text', async (ctx) => {
      const telegramId = ctx.from?.id?.toString();
      try {
        const user = await this.ensureUser(ctx);
        if (!this.isAllowed(user)) {
          await ctx.reply('Извините, у вас нет доступа к этому боту.');
          return;
        }
        await this.updateLastSeen(user);

        const state = await this.getOrCreateState(telegramId!);
        const text = ctx.message.text ?? '';

        if (state.state === TelegramDialogStateEnum.PROFILE_WAIT_RESUME) {
          const urlMatch = text.match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            const spinner = await this.createSpinner(telegramId!, 'Скачиваю резюме по ссылке');
            try {
              const result = await this.playwrightTool.browse(urlMatch[0], 3000);
              const resumeText = [result.title, result.content].filter(Boolean).join('\n').trim();
              if (resumeText.length < 100) {
                await this.setState(telegramId!, TelegramDialogStateEnum.IDLE);
                await spinner.finish('Не удалось извлечь текст по ссылке. Попробуй прикрепить PDF-файл.');
                return;
              }
              user.resumeText = resumeText.substring(0, 50000);
              await user.save();
              await this.setState(telegramId!, TelegramDialogStateEnum.IDLE);
              await spinner.finish([
                '✅ Резюме сохранено.',
                `Извлечено <b>${resumeText.length}</b> символов.`,
                '',
                'Теперь напиши «найди вакансии» — подберу подходящие под твоё резюме.',
              ].join('\n'));
            } catch {
              await this.setState(telegramId!, TelegramDialogStateEnum.IDLE);
              await spinner.finish('Не удалось открыть ссылку. Попробуй прикрепить PDF-файл.');
            }
            return;
          }
          await this.setState(telegramId!, TelegramDialogStateEnum.IDLE);
          await this.telegramService.sendMessage('Пожалуйста, пришли PDF-файл или ссылку на резюме.', telegramId!);
          return;
        }

        await this.processTextMessage(user, text, 'text');
      } catch (err) {
        await this.handleError(err, { telegramId, serviceName: this.TAG, nodeName: 'text_handler' });
      }
    });

    // Документы (PDF и другие файлы)
    bot.on('document', async (ctx) => {
      const telegramId = ctx.from?.id?.toString();
      try {
        const user = await this.ensureUser(ctx);
        if (!this.isAllowed(user)) {
          return;
        }
        await this.updateLastSeen(user);

        const document = ctx.message.document;
        if (!document) {
          return;
        }

        const mimeType = document.mime_type ?? 'application/octet-stream';
        const fileName = document.file_name ?? 'document';
        const caption = ctx.message.caption ?? '';
        const state = await this.getOrCreateState(telegramId!);

        if (state.state === TelegramDialogStateEnum.PROFILE_WAIT_RESUME && mimeType === 'application/pdf') {
          const spinner = await this.createSpinner(telegramId!, 'Обрабатываю резюме');
          const { buffer } = await this.downloadTelegramFile(document.file_id);
          const resumeText = (await this.parsePdfBuffer(buffer)).trim();

          user.resumeText = resumeText.substring(0, 50000);
          user.resumeFileId = document.file_id;
          await user.save();

          await this.setState(telegramId!, TelegramDialogStateEnum.IDLE);
          await spinner.finish([
            '✅ Резюме сохранено.',
            `Извлечено <b>${resumeText.length}</b> символов.`,
            '',
            'Теперь напиши «найди вакансии» — подберу подходящие под твоё резюме.',
          ].join('\n'));
          return;
        }

        // Обычный документ с вопросом
        let fileText = '';
        const { buffer, downloadUrl } = await this.downloadTelegramFile(document.file_id);

        if (mimeType === 'application/pdf') {
          try {
            fileText = (await this.parsePdfBuffer(buffer)).trim();
          } catch { /* ignore */ }
        }

        await this.processFileMessage(user, caption || `Файл: ${fileName}`, fileText, downloadUrl, document.file_id, 'document', mimeType, fileName, buffer.length);
      } catch (err) {
        await this.handleError(err, { telegramId, serviceName: this.TAG, nodeName: 'document_handler' });
      }
    });

    // Фото
    bot.on('photo', async (ctx) => {
      const telegramId = ctx.from?.id?.toString();
      try {
        const user = await this.ensureUser(ctx);
        if (!this.isAllowed(user)) {
          return;
        }
        await this.updateLastSeen(user);

        const photos = ctx.message.photo;
        if (!photos?.length) {
          return;
        }

        const photo = photos[photos.length - 1];
        const caption = ctx.message.caption ?? '';
        const { downloadUrl } = await this.downloadTelegramFile(photo.file_id);

        await this.processFileMessage(
          user,
          caption || '[Пользователь прислал фото]',
          '',
          downloadUrl,
          photo.file_id,
          'photo',
          'image/jpeg',
          `photo_${photo.file_unique_id}.jpg`,
          null,
          downloadUrl, // imageUrl для multimodal
        );
      } catch (err) {
        await this.handleError(err, { telegramId, serviceName: this.TAG, nodeName: 'photo_handler' });
      }
    });

    // Голосовые сообщения
    bot.on('voice', async (ctx) => {
      const telegramId = ctx.from?.id?.toString();
      try {
        const user = await this.ensureUser(ctx);
        if (!this.isAllowed(user)) {
          return;
        }
        await this.updateLastSeen(user);

        const voice = ctx.message.voice;
        if (!voice) {
          return;
        }

        const spinner = await this.createSpinner(telegramId!, 'Распознаю голосовое сообщение');
        const { buffer, downloadUrl } = await this.downloadTelegramFile(voice.file_id);
        const transcript = await this.transcribeAudio(buffer, 'oggopus');
        const text = `[Голосовое]: ${transcript}`;

        await this.processFileMessage(user, text, '', downloadUrl, voice.file_id, 'voice', 'audio/ogg', 'voice.ogg', buffer.length, undefined, spinner);
      } catch (err) {
        await this.handleError(err, { telegramId, serviceName: this.TAG, nodeName: 'voice_handler' });
      }
    });

    // Видео-кружки (video_note)
    bot.on('video_note', async (ctx) => {
      const telegramId = ctx.from?.id?.toString();
      try {
        const user = await this.ensureUser(ctx);
        if (!this.isAllowed(user)) {
          return;
        }
        await this.updateLastSeen(user);

        const note = ctx.message.video_note;
        if (!note) {
          return;
        }

        const spinner = await this.createSpinner(telegramId!, 'Распознаю видеосообщение');
        const { buffer, downloadUrl } = await this.downloadTelegramFile(note.file_id);
        const transcript = await this.transcribeAudio(buffer, 'mp4');
        const text = `[Видеосообщение]: ${transcript}`;

        await this.processFileMessage(user, text, '', downloadUrl, note.file_id, 'video_note', 'video/mp4', 'video_note.mp4', buffer.length, undefined, spinner);
      } catch (err) {
        await this.handleError(err, { telegramId, serviceName: this.TAG, nodeName: 'video_note_handler' });
      }
    });

    // Обычное видео
    bot.on('video', async (ctx) => {
      const telegramId = ctx.from?.id?.toString();
      try {
        const user = await this.ensureUser(ctx);
        if (!this.isAllowed(user)) {
          return;
        }
        await this.updateLastSeen(user);

        const video = ctx.message.video;
        if (!video) {
          return;
        }

        const caption = ctx.message.caption ?? '';
        const spinner = await this.createSpinner(telegramId!, 'Распознаю видео');
        const { buffer, downloadUrl } = await this.downloadTelegramFile(video.file_id);
        const transcript = await this.transcribeAudio(buffer, 'mp4');
        const text = caption ? `${caption}\n[Видео]: ${transcript}` : `[Видео]: ${transcript}`;

        await this.processFileMessage(user, text, '', downloadUrl, video.file_id, 'video', video.mime_type ?? 'video/mp4', video.file_name ?? 'video.mp4', buffer.length, undefined, spinner);
      } catch (err) {
        await this.handleError(err, { telegramId, serviceName: this.TAG, nodeName: 'video_handler' });
      }
    });

    // Аудио
    bot.on('audio', async (ctx) => {
      const telegramId = ctx.from?.id?.toString();
      try {
        const user = await this.ensureUser(ctx);
        if (!this.isAllowed(user)) {
          return;
        }
        await this.updateLastSeen(user);

        const audio = ctx.message.audio;
        if (!audio) {
          return;
        }

        const caption = ctx.message.caption ?? '';
        const spinner = await this.createSpinner(telegramId!, 'Распознаю аудио');
        const { buffer, downloadUrl } = await this.downloadTelegramFile(audio.file_id);
        const transcript = await this.transcribeAudio(buffer, 'mp4');
        const text = caption ? `${caption}\n[Аудио]: ${transcript}` : `[Аудио]: ${transcript}`;

        await this.processFileMessage(user, text, '', downloadUrl, audio.file_id, 'audio', audio.mime_type ?? 'audio/mpeg', audio.file_name ?? 'audio.mp3', buffer.length, undefined, spinner);
      } catch (err) {
        await this.handleError(err, { telegramId, serviceName: this.TAG, nodeName: 'audio_handler' });
      }
    });

    // Callback (пагинация вакансий)
    bot.on('callback_query', async (ctx) => {
      const telegramId = ctx.from?.id?.toString();
      try {
        await ctx.answerCbQuery();
        const user = await this.ensureUser(ctx);
        if (!this.isAllowed(user)) {
          return;
        }

        const data = 'data' in ctx.callbackQuery ? (ctx.callbackQuery.data ?? '') : '';

        // Формат: model:<modelId>
        if (data.startsWith('model:')) {
          const modelId = data.slice('model:'.length);
          const modelInfo = await ModelEntity.findOne({ where: { modelId, isActive: true } });
          if (modelInfo) {
            user.modelId = modelId;
            await user.save();
            const pickerMessageId = 'message' in ctx.callbackQuery ? ctx.callbackQuery.message?.message_id : undefined;
            if (pickerMessageId) {
              await ctx.deleteMessage(pickerMessageId).catch(() => undefined);
            }
            const lines = [
              `✅ Модель изменена на <b>${modelInfo.name}</b>`,
              `📝 ${modelInfo.modalities}`,
              `💰 вход ${modelInfo.priceIn}/1M · выход ${modelInfo.priceOut}/1M`,
            ];
            await this.telegramService.sendMessage(lines.join('\n'), user.telegramId);
          }
          return;
        }

        // stop:<telegramId>
        if (data.startsWith('stop:')) {
          const targetId = data.slice('stop:'.length);
          const cancel = this.cancelMap.get(targetId);
          if (cancel) {
            cancel();
          } else {
            await this.telegramService.sendMessage('Задача уже завершена или не найдена.', user.telegramId);
          }
          return;
        }

        // Формат: jobs:<requestId>:<offset>
        if (data.startsWith('jobs:')) {
          const [, requestIdStr, offsetStr] = data.split(':');
          const requestId = parseInt(requestIdStr, 10);
          const offset = parseInt(offsetStr, 10);

          if (!isNaN(requestId) && !isNaN(offset)) {
            const result = await this.jobSearchAgentService.handleCallback(requestId, offset);
            await this.sendResult(user.telegramId, result.responseText, result.inlineKeyboard ?? null);
          }
          return;
        }
      } catch (err) {
        await this.handleError(err, { telegramId, serviceName: this.TAG, nodeName: 'callback_handler' });
      }
    });

    // Глобальный обработчик ошибок бота
    bot.catch((err: unknown, ctx) => {
      this.loggerService.error(this.TAG, 'Unhandled bot error', err);
      const tid = ctx.chat?.id?.toString();
      if (tid) {
        this.sendErrorToUser(tid, err).catch(() => undefined);
      }
    });
  };

  // ──────────────── MODEL PICKER ────────────────

  private sendModelPicker = async (user: UserEntity): Promise<void> => {
    const models = await ModelEntity.find({ where: { isActive: true }, order: { sortOrder: 'ASC' } });
    const defaultModel = models.find((m) => m.isDefault);
    const currentModelId = user.modelId ?? defaultModel?.modelId ?? models[0]?.modelId ?? '';

    const lines = ['<b>Выбери модель для общения:</b>', ''];
    for (const m of models) {
      const marker = m.modelId === currentModelId ? '✅ ' : '';
      lines.push(`${marker}<b>${m.name}</b>`);
      lines.push(`📝 ${m.modalities}`);
      lines.push(`💰 вход ${m.priceIn}/1M · выход ${m.priceOut}/1M`);
      lines.push('');
    }

    const keyboard = {
      inline_keyboard: models.map((m) => [{
        text: (m.modelId === currentModelId ? '✅ ' : '') + m.name,
        callback_data: `model:${m.modelId}`,
      }]),
    };

    await this.telegramService.sendMessage(lines.join('\n'), user.telegramId, { reply_markup: keyboard });
  };

  // ──────────────── CORE HANDLERS ────────────────

  private processTextMessage = async (user: UserEntity, text: string, mediaType: string): Promise<void> => {
    const request = await this.requestService.create({
      userId: user.id,
      telegramChatId: user.telegramId,
      rawText: text,
      mediaType: 'text',
    });

    // Fire-and-forget: не блокируем Telegraf-хендлер (таймаут 90с),
    // runManager сам отправляет результат и обрабатывает ошибки
    this.runManager(user, text, {
      requestId: request.id,
      mediaType,
    }).catch(() => undefined);
  };

  private processFileMessage = async (
    user: UserEntity,
    text: string,
    fileText: string,
    downloadUrl: string,
    fileId: string,
    fileType: string,
    mimeType: string,
    fileName: string,
    fileSize: number | null,
    imageUrl?: string,
    spinner?: Awaited<ReturnType<TelegramBotCommandService['createSpinner']>>,
  ): Promise<void> => {
    const mediaType = (fileType as any) ?? 'document';

    const request = await this.requestService.create({
      userId: user.id,
      telegramChatId: user.telegramId,
      rawText: text,
      mediaType,
    });

    // Сохраняем вложение
    await this.requestService.saveFileAttachment({
      userId: user.id,
      telegramFileId: fileId,
      fileType,
      mimeType,
      fileName,
      fileSize: fileSize ?? undefined,
      downloadUrl,
      extractedText: fileText || undefined,
    }, request.id);

    // Fire-and-forget: не блокируем Telegraf-хендлер
    this.runManager(user, text, {
      requestId: request.id,
      fileText: fileText || undefined,
      imageUrl,
      mediaType,
      spinner,
    }).catch(() => undefined);
  };

  private createSpinner = async (telegramId: string, baseText: string) => {
    let dotStep = 0;
    let messageId: number | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stopKeyboard = { inline_keyboard: [[{ text: '⛔ Остановить', callback_data: `stop:${telegramId}` }]] };

    const renderText = () => `${DOTS[dotStep]} ${baseText}...`;

    const sent = await this.telegramService
      .sendMessage(renderText(), telegramId, { reply_markup: stopKeyboard } as any)
      .catch(() => undefined);
    messageId = sent?.message_id ?? null;

    const updateText = async (newBase: string) => {
      baseText = newBase;
      if (messageId) {
        await this.telegramService
          .editMessage(renderText(), telegramId, messageId, { reply_markup: stopKeyboard } as any)
          .catch(() => undefined);
      }
    };

    if (messageId) {
      timer = setInterval(async () => {
        dotStep = (dotStep + 1) % DOTS.length;
        await this.telegramService
          .editMessage(renderText(), telegramId, messageId!, { reply_markup: stopKeyboard } as any)
          .catch(() => undefined);
      }, 3000);
    }

    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };

    const finish = async (finalText: string, replyMarkup?: object) => {
      stop();
      if (messageId) {
        await this.telegramService
          .editMessage(finalText, telegramId, messageId, replyMarkup ? { reply_markup: replyMarkup } as any : undefined)
          .catch(() => undefined);
      } else {
        await this.telegramService.sendMessage(finalText, telegramId, replyMarkup ? { reply_markup: replyMarkup } as any : undefined);
      }
    };

    return { messageId, updateText, stop, finish };
  };

  private runManager = async (
    user: UserEntity,
    messageText: string,
    options: {
      requestId: number;
      fileText?: string;
      imageUrl?: string;
      mediaType?: string;
      spinner?: Awaited<ReturnType<TelegramBotCommandService['createSpinner']>>;
    },
  ): Promise<void> => {
    let spinner = options.spinner ?? null;

    // Cancel-промис: resolve вызывается через cancelMap
    let cancelFn: () => void = () => undefined;
    const cancelPromise = new Promise<never>((_, reject) => {
      cancelFn = () => reject(new Error('Cancelled'));
    });
    this.cancelMap.set(user.telegramId, cancelFn);

    try {
      const result = await Promise.race([
        this.managerAgentService.process({
          telegramId: user.telegramId,
          userId: user.id,
          requestId: options.requestId,
          messageText,
          fileText: options.fileText,
          imageUrl: options.imageUrl,
          mediaType: options.mediaType,
          resumeText: user.resumeText ?? undefined,
          modelId: user.modelId ?? undefined,
          onAgentSelected: async (agentName: string) => {
            const ackText = ACKNOWLEDGEMENTS[agentName] ?? 'Обрабатываю запрос';
            if (spinner) {
              await spinner.updateText(ackText);
            } else {
              spinner = await this.createSpinner(user.telegramId, ackText);
            }
          },
        }),
        cancelPromise,
      ]);

      const inlineKeyboard = result.inlineKeyboard ? (() => {
        try { return JSON.parse(result.inlineKeyboard!); } catch { return undefined; }
      })() : undefined;

      if (spinner) {
        await spinner.finish(result.responseText, inlineKeyboard);
      } else {
        await this.sendResult(user.telegramId, result.responseText, result.inlineKeyboard ?? null);
      }
    } catch (err) {
      spinner?.stop();
      if (err instanceof Error && err.message === 'Cancelled') {
        if (spinner) {
          await spinner.finish('⛔ Поиск остановлен.');
        } else {
          await this.telegramService.sendMessage('⛔ Поиск остановлен.', user.telegramId);
        }
      } else {
        await this.sendErrorToUser(user.telegramId, err);
      }
    } finally {
      this.cancelMap.delete(user.telegramId);
    }
  };

  private sendResult = async (telegramId: string, text: string, inlineKeyboard: string | null): Promise<void> => {
    if (inlineKeyboard) {
      try {
        const kb = JSON.parse(inlineKeyboard);
        await this.telegramService.sendMessage(text, telegramId, { reply_markup: kb });
        return;
      } catch { /* fallback to plain send */ }
    }
    await this.telegramService.sendMessage(text, telegramId);
  };

  // ──────────────── HELPERS ────────────────

  private transcribeAudio = async (buffer: Buffer, format: 'oggopus' | 'mp4'): Promise<string> => {
    try {
      return await this.yandexSttTool.transcribe(buffer, format);
    } catch (e) {
      this.loggerService.error(this.TAG, 'STT failed:', e);
      return '[Не удалось распознать аудио]';
    }
  };

  private parsePdfBuffer = (buffer: Buffer): Promise<string> => {
    return new Promise((resolve, reject) => {
      const pdfParser = new PDFParser(null, true);
      pdfParser.on('pdfParser_dataError', (errData: { parserError: Error; } | Error) => {
        reject(errData && typeof errData === 'object' && 'parserError' in errData ? errData.parserError : errData);
      });
      pdfParser.on('pdfParser_dataReady', () => {
        resolve(pdfParser.getRawTextContent());
      });
      pdfParser.parseBuffer(buffer, 0);
    });
  };

  private downloadTelegramFile = async (fileId: string): Promise<{ buffer: Buffer; downloadUrl: string }> => {
    const telegram = this.telegramBotService.getBot().telegram;
    const link = await telegram.getFileLink(fileId);
    const downloadUrl = String(link);

    const proxyAgent = this.telegramBotService.getSocksProxyAgent();
    const axiosConfig = proxyAgent
      ? { httpAgent: proxyAgent, httpsAgent: proxyAgent, responseType: 'arraybuffer' as const }
      : { responseType: 'arraybuffer' as const };

    const response = await axios.get<ArrayBuffer>(downloadUrl, axiosConfig);
    return { buffer: Buffer.from(response.data), downloadUrl };
  };

  private readonly ALLOWED_TELEGRAM_IDS = new Set(
    [process.env.TELEGRAM_CHAT_ID, process.env.TELEGRAM_CHAT_ID2].filter(Boolean) as string[],
  );

  private isAllowed = (user: UserEntity) => {
    if (this.ALLOWED_TELEGRAM_IDS.size === 0) {
      return false;
    }
    return user.status === 'active' && this.ALLOWED_TELEGRAM_IDS.has(user.telegramId);
  };

  private ensureUser = async (ctx: Context): Promise<UserEntity> => {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) {
      throw new Error('Telegram id not found in context');
    }

    let user = await UserEntity.findOne({ where: { telegramId } });
    if (!user) {
      user = new UserEntity();
      user.telegramId = telegramId;
      user.role = 'user';
      user.status = 'active';
      user.extraData = {};
    }

    user.username = ctx.from?.username ?? user.username ?? null;
    user.firstName = ctx.from?.first_name ?? user.firstName ?? null;
    user.lastName = ctx.from?.last_name ?? user.lastName ?? null;
    user.displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || user.displayName;

    return user.save();
  };

  private updateLastSeen = async (user: UserEntity): Promise<void> => {
    user.lastSeenAt = new Date();
    await user.save();
  };

  private getOrCreateState = async (telegramId: string): Promise<TelegramDialogStateEntity> => {
    let state = await TelegramDialogStateEntity.findOne({ where: { telegramId } });
    if (!state) {
      state = new TelegramDialogStateEntity();
      state.telegramId = telegramId;
      state.state = TelegramDialogStateEnum.IDLE;
      state.data = {};
      await state.save();
    }
    return state;
  };

  private setState = async (telegramId: string, nextState: TelegramDialogStateEnum, data?: Record<string, any>): Promise<void> => {
    const state = await this.getOrCreateState(telegramId);
    state.state = nextState;
    state.data = data ?? state.data ?? {};
    await state.save();
  };

  private handleError = async (err: unknown, context: {
    telegramId?: string;
    requestId?: number;
    serviceName?: string;
    nodeName?: string;
  }): Promise<void> => {
    await this.errorLogService.handle({
      error: err,
      serviceName: context.serviceName,
      nodeName: context.nodeName,
      requestId: context.requestId,
      userTelegramId: context.telegramId,
      notifyUser: true,
    });
  };

  private escapeHtml = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  private formatErrorForChat = (err: unknown): string => {
    const message = err instanceof Error ? err.message : String(err);
    const rawStack = err instanceof Error && err.stack ? err.stack.trim() : '';
    const msgPart = `⚠️ Ошибка: <b>${this.escapeHtml(message)}</b>`;
    if (!rawStack) {
      return msgPart.length <= this.MAX_ERROR_MESSAGE_LENGTH ? msgPart : msgPart.slice(0, this.MAX_ERROR_MESSAGE_LENGTH - 10) + '…';
    }
    const prefix = `${msgPart}\n\n`;
    const codeWrap = '<pre><code>';
    const codeEnd = '</code></pre>';
    const maxBlock = this.MAX_ERROR_MESSAGE_LENGTH - prefix.length - codeWrap.length - codeEnd.length;
    const stack = this.escapeHtml(rawStack);
    const stackInBlock = stack.length <= maxBlock - 15 ? stack : stack.slice(0, maxBlock - 25) + '\n… (обрезано)';
    return `${prefix}${codeWrap}${stackInBlock}${codeEnd}`;
  };

  private sendErrorToUser = async (telegramId: string | undefined, err: unknown): Promise<void> => {
    if (!telegramId) {
      return;
    }
    try {
      await this.telegramService.sendMessage(this.formatErrorForChat(err), telegramId);
    } catch { /* ignore */ }
  };
}
