import { isNil, isUndefined } from 'lodash-es';
import moment from 'moment-timezone';
import ms from 'ms';
import { Container, Singleton } from 'typescript-ioc';

import { ALICE_MAXIMUM_SPOKEN_TEXT_LENGTH } from '@/alice/alice-spoken-text-limit';
import { isSimpleUtteranceRequest } from '@/alice/guards/alice-request.guard';
import { isAliceSkillSessionState } from '@/alice/guards/alice-session-state.guard';
import { ALICE_MODEL_IDS } from '@/alice/types/alice-model';
import { ModelMessageRoleEnum } from '@/types/model-message-role';
import { AlicePendingStatusEnum } from '@/alice/types/alice-pending-status';
import { AliceHistoryRoleEnum } from '@/alice/types/alice-history-role';
import { ALICE_SESSION_STATE_VERSION } from '@/alice/types/alice-session-state';
import { ModelService } from '@/services/model/model.service';
import { BaseService } from '@/services/app/base.service';
import { AlicePendingService } from '@/services/alice/alice-pending.service';
import { AliceResponseBuilderService } from '@/services/alice/alice-response-builder.service';
import { AliceAccessService } from '@/services/alice/alice-access.service';
import type { AliceDialogHandleInput, AliceQuestionInput } from '@/alice/types/alice-dialog';
import type { AliceHistoryMessage, AliceSkillSessionState } from '@/alice/types/alice-session-state';
import type { AliceIncomingBody, AliceSimpleUtteranceRequest } from '@/alice/types/alice-request-body';
import type { AliceResponseBody, AliceResponseButton } from '@/alice/types/alice-response-body';
import type { AliceModelMessage } from '@/alice/types/alice-model';

@Singleton
export class AliceDialogService extends BaseService {
  private readonly TAG = 'AliceDialogService';

  private readonly SYNCHRONOUS_TIMEOUT_MILLISECONDS = ms('4 seconds');

  private readonly MAXIMUM_HISTORY_MESSAGE_COUNT = 6;

  private readonly MOSCOW_TIMEZONE = 'Europe/Moscow';

  private readonly PING_UTTERANCE = 'ping';

  private readonly CONTINUE_COMMANDS = ['продолжить', 'дальше', 'продолжай'];

  private readonly PING_TEXT = 'Навык на связи.';

  private readonly ACCESS_DENIED_TEXT = 'У вас нет доступа к этому навыку.';

  private readonly GREETING_TEXT = 'Задайте вопрос.';

  private readonly THINKING_TEXT = 'Думаю над ответом. Скажите «продолжить» через несколько секунд.';

  private readonly STILL_THINKING_TEXT = 'Ещё думаю. Скажите «продолжить» чуть позже.';

  private readonly ASK_QUESTION_FIRST_TEXT = 'Сначала задайте вопрос.';

  private readonly ANSWER_FAILED_TEXT = 'Не получилось получить ответ. Задайте вопрос ещё раз.';

  private readonly UNSUPPORTED_REQUEST_TEXT = 'Задайте вопрос голосом.';

  private readonly CONTINUE_BUTTON: AliceResponseButton = { title: 'Продолжить', hide: true };

  private readonly aliceAccessService = Container.get(AliceAccessService);

  private readonly alicePendingService = Container.get(AlicePendingService);

  private readonly aliceResponseBuilder = Container.get(AliceResponseBuilderService);

  private readonly modelService = Container.get(ModelService);

  public handle = async ({ body, skillModel }: AliceDialogHandleInput): Promise<AliceResponseBody> => {
    const { request, session } = body;

    this.loggerService.info(this.TAG, 'Alice request received', {
      skillModel,
      sessionId: session.session_id,
      requestType: request.type,
      isNewSession: session.new,
    });

    if (isSimpleUtteranceRequest(request) && this.isPing(request)) {
      return this.aliceResponseBuilder.buildTextResponse({
        text: this.PING_TEXT,
        endSession: false,
      });
    }

    const accessResult = this.aliceAccessService.check(session);

    if (!accessResult.allowed) {
      this.loggerService.warn(this.TAG, 'Alice access denied', {
        sessionId: session.session_id,
        reason: accessResult.reason,
      });

      return this.aliceResponseBuilder.buildTextResponse({
        text: this.ACCESS_DENIED_TEXT,
        endSession: true,
      });
    }

    const sessionState = this.readSessionState(body);

    if (!isSimpleUtteranceRequest(request)) {
      return this.aliceResponseBuilder.buildTextResponse({
        text: this.UNSUPPORTED_REQUEST_TEXT,
        endSession: false,
        sessionState,
      });
    }

    const command = request.command.trim();
    const question = this.readQuestion(request);

    if (this.isContinueCommand(command)) {
      return this.handleContinue(session.session_id, sessionState);
    }

    if (!question) {
      return this.aliceResponseBuilder.buildTextResponse({
        text: this.GREETING_TEXT,
        endSession: false,
        sessionState,
      });
    }

    return this.handleQuestion({
      sessionId: session.session_id,
      question,
      skillModel,
      sessionState,
    });
  };

  private handleContinue = (sessionId: string, sessionState: AliceSkillSessionState): AliceResponseBody => {
    const entry = this.alicePendingService.get(sessionId);

    if (isUndefined(entry)) {
      return this.aliceResponseBuilder.buildTextResponse({
        text: this.ASK_QUESTION_FIRST_TEXT,
        endSession: false,
        sessionState: this.withoutPendingQuestion(sessionState),
      });
    }

    if (entry.status === AlicePendingStatusEnum.RUNNING) {
      return this.aliceResponseBuilder.buildTextResponse({
        text: this.STILL_THINKING_TEXT,
        endSession: false,
        sessionState,
        buttons: [this.CONTINUE_BUTTON],
      });
    }

    if (entry.status === AlicePendingStatusEnum.ERROR || isNil(entry.answer) || !entry.answer.trim()) {
      this.alicePendingService.remove(sessionId);

      return this.aliceResponseBuilder.buildTextResponse({
        text: this.ANSWER_FAILED_TEXT,
        endSession: false,
        sessionState: this.withoutPendingQuestion(sessionState),
      });
    }

    const spokenAnswer = this.aliceResponseBuilder.prepareSpokenText(entry.answer);
    const question = sessionState.pendingQuestion ?? '';
    this.alicePendingService.remove(sessionId);
    this.loggerService.info(this.TAG, 'Delivered background Alice answer', { sessionId });

    return this.aliceResponseBuilder.buildTextResponse({
      text: spokenAnswer,
      endSession: false,
      sessionState: this.appendHistory(sessionState, question, spokenAnswer),
    });
  };

  private handleQuestion = async ({
    sessionId,
    question,
    skillModel,
    sessionState,
  }: AliceQuestionInput): Promise<AliceResponseBody> => {
    const modelId = ALICE_MODEL_IDS[skillModel];
    const messages = this.buildModelMessages(sessionState.history, question);
    const background: { generation?: number; } = {};
    const invocation = this.modelService.invoke(messages, 0.7, modelId);

    this.loggerService.info(this.TAG, 'Calling language model for Alice', { sessionId, skillModel, modelId });

    void invocation.then((rawAnswer) => {
      if (isUndefined(background.generation)) {
        return;
      }

      this.alicePendingService.complete(
        sessionId,
        background.generation,
        this.aliceResponseBuilder.prepareSpokenText(rawAnswer),
      );
    }, (error: unknown) => {
      if (isUndefined(background.generation)) {
        return;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.alicePendingService.fail(sessionId, background.generation, errorMessage);
      this.loggerService.error(this.TAG, 'Background Alice answer failed', error);
    });

    try {
      const synchronousAnswer = await this.raceWithTimeout(invocation);

      if (synchronousAnswer !== null) {
        const spokenAnswer = this.aliceResponseBuilder.prepareSpokenText(synchronousAnswer);
        this.loggerService.info(this.TAG, 'Alice answer ready in time', { sessionId, skillModel });

        return this.aliceResponseBuilder.buildTextResponse({
          text: spokenAnswer,
          endSession: false,
          sessionState: this.appendHistory(sessionState, question, spokenAnswer),
        });
      }
    } catch (error) {
      this.loggerService.error(this.TAG, 'Alice language model call failed', error);
      throw error;
    }

    background.generation = this.alicePendingService.begin(sessionId, skillModel);
    this.loggerService.info(this.TAG, 'Alice answer moved to background', { sessionId, skillModel });

    return this.aliceResponseBuilder.buildTextResponse({
      text: this.THINKING_TEXT,
      endSession: false,
      sessionState: {
        stateVersion: ALICE_SESSION_STATE_VERSION,
        history: sessionState.history,
        pendingQuestion: question,
      },
      buttons: [this.CONTINUE_BUTTON],
    });
  };

  private raceWithTimeout = async (invocation: Promise<string>): Promise<string | null> => {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve(null);
      }, this.SYNCHRONOUS_TIMEOUT_MILLISECONDS);
    });

    try {
      return await Promise.race([invocation, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  };

  private readSessionState = (body: AliceIncomingBody): AliceSkillSessionState => {
    const storedSession = body.state?.session;

    if (isAliceSkillSessionState(storedSession)) {
      return storedSession;
    }

    return {
      stateVersion: ALICE_SESSION_STATE_VERSION,
      history: [],
    };
  };

  private readQuestion = (request: AliceSimpleUtteranceRequest): string => {
    const originalUtterance = request.original_utterance.trim();

    if (originalUtterance) {
      return originalUtterance;
    }

    return request.command.trim();
  };

  private isPing = (request: AliceSimpleUtteranceRequest): boolean => {
    const originalUtterance = request.original_utterance.trim().toLowerCase();
    const command = request.command.trim().toLowerCase();

    return originalUtterance === this.PING_UTTERANCE || command === this.PING_UTTERANCE;
  };

  private isContinueCommand = (command: string): boolean =>
    this.CONTINUE_COMMANDS.includes(command.trim().toLowerCase());

  private appendHistory = (sessionState: AliceSkillSessionState, question: string, answer: string): AliceSkillSessionState => ({
    stateVersion: ALICE_SESSION_STATE_VERSION,
    history: [
      ...sessionState.history,
      { role: AliceHistoryRoleEnum.USER, content: question },
      { role: AliceHistoryRoleEnum.ASSISTANT, content: answer },
    ].slice(-this.MAXIMUM_HISTORY_MESSAGE_COUNT),
  });

  private withoutPendingQuestion = (sessionState: AliceSkillSessionState): AliceSkillSessionState => ({
    stateVersion: ALICE_SESSION_STATE_VERSION,
    history: sessionState.history,
  });

  private buildModelMessages = (history: AliceHistoryMessage[], question: string): AliceModelMessage[] => {
    const historyMessages: AliceModelMessage[] = history.map(message => ({
      role: message.role === AliceHistoryRoleEnum.USER
        ? ModelMessageRoleEnum.USER
        : ModelMessageRoleEnum.ASSISTANT,
      content: message.content,
    }));

    return [
      { role: ModelMessageRoleEnum.SYSTEM, content: this.buildSystemPrompt() },
      ...historyMessages,
      { role: ModelMessageRoleEnum.USER, content: question },
    ];
  };

  private buildSystemPrompt = (): string => {
    const now = moment().tz(this.MOSCOW_TIMEZONE);
    const year = now.format('YYYY');
    const datePretty = now.locale('ru').format('D MMMM YYYY');

    return [
      'Ты голосовой помощник. Отвечай по-русски, кратко, разговорным языком, чтобы ответ было удобно озвучить.',
      'Не используй markdown, html, списки со звёздочками и ссылки.',
      `Ответ не длиннее ${ALICE_MAXIMUM_SPOKEN_TEXT_LENGTH} символов. Это предел озвучки. Уложись в этот лимит и закончи мысль, не обрывай фразу.`,
      `Сейчас на календаре (Москва, UTC+3): ${datePretty}, ${year} год.`,
      `Календарный год сейчас — ${year}. Не описывай ${year} год как ещё не наступивший, в будущем или ожидаемый.`,
    ].join(' ');
  };
}
