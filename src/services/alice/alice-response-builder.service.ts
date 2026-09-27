import { Singleton } from 'typescript-ioc';

import { ALICE_MAXIMUM_SPOKEN_TEXT_LENGTH } from '@/alice/alice-spoken-text-limit';
import { BaseService } from '@/services/app/base.service';
import { ALICE_PROTOCOL_VERSION } from '@/alice/types/alice-protocol-version';
import { ALICE_SESSION_STATE_VERSION } from '@/alice/types/alice-session-state';
import type { AliceResponseBody, AliceTextResponseParameters } from '@/alice/types/alice-response-body';
import type { AliceHistoryMessage, AliceSkillSessionState } from '@/alice/types/alice-session-state';

@Singleton
export class AliceResponseBuilderService extends BaseService {
  private readonly TAG = 'AliceResponseBuilderService';

  private readonly MAXIMUM_SESSION_STATE_BYTES = 1000;

  private readonly MAXIMUM_STORED_MESSAGE_CHARACTERS = 80;

  private readonly MAXIMUM_STORED_PENDING_QUESTION_CHARACTERS = 120;

  private readonly EMPTY_ANSWER_TEXT = 'Пустой ответ.';

  public prepareSpokenText = (rawText: string): string => {
    const withoutCodeFences = rawText.replace(/```[\s\S]*?```/g, ' ');
    const withoutLinks = withoutCodeFences.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
    const withoutMarkup = withoutLinks
      .replace(/<[^>]+>/g, ' ')
      .replace(/[*_~`#]/g, '');

    const collapsed = withoutMarkup.replace(/\s+/g, ' ').trim();

    if (!collapsed) {
      return this.EMPTY_ANSWER_TEXT;
    }

    return this.limitCharacters(collapsed, ALICE_MAXIMUM_SPOKEN_TEXT_LENGTH);
  };

  public buildTextResponse = ({
    text,
    endSession,
    sessionState,
    buttons,
  }: AliceTextResponseParameters): AliceResponseBody => {
    const spokenText = this.prepareSpokenText(text);
    const responseBody: AliceResponseBody = {
      response: {
        text: spokenText,
        tts: spokenText,
        end_session: endSession,
        ...(buttons ? { buttons } : {}),
      },
      version: ALICE_PROTOCOL_VERSION,
    };

    if (sessionState) {
      responseBody.session_state = this.fitSessionState(sessionState);
    }

    this.loggerService.debug(this.TAG, 'Built Alice response', {
      endSession,
      textLength: spokenText.length,
    });

    return responseBody;
  };

  private fitSessionState = (sessionState: AliceSkillSessionState): AliceSkillSessionState => {
    const history = sessionState.history.map(message => ({
      role: message.role,
      content: this.limitCharacters(message.content, this.MAXIMUM_STORED_MESSAGE_CHARACTERS),
    }));

    const pendingQuestion = sessionState.pendingQuestion
      ? this.limitCharacters(sessionState.pendingQuestion, this.MAXIMUM_STORED_PENDING_QUESTION_CHARACTERS)
      : undefined;

    let fitted = this.buildSessionState(history, pendingQuestion);

    while (this.measureBytes(fitted) > this.MAXIMUM_SESSION_STATE_BYTES && fitted.history.length) {
      fitted = this.buildSessionState(fitted.history.slice(1), fitted.pendingQuestion);
    }

    while (fitted.pendingQuestion && this.measureBytes(fitted) > this.MAXIMUM_SESSION_STATE_BYTES) {
      const shorterQuestion = fitted.pendingQuestion.slice(0, Math.max(0, fitted.pendingQuestion.length - 20)).trim();
      fitted = this.buildSessionState(fitted.history, shorterQuestion || undefined);
      if (!shorterQuestion) {
        break;
      }
    }

    return fitted;
  };

  private buildSessionState = (history: AliceHistoryMessage[], pendingQuestion?: string): AliceSkillSessionState => ({
    stateVersion: ALICE_SESSION_STATE_VERSION,
    history,
    ...(pendingQuestion ? { pendingQuestion } : {}),
  });

  private measureBytes = (sessionState: AliceSkillSessionState): number =>
    Buffer.byteLength(JSON.stringify(sessionState), 'utf8');

  private limitCharacters = (text: string, maximumLength: number): string => {
    if (text.length <= maximumLength) {
      return text;
    }

    if (maximumLength <= 1) {
      return '…';
    }

    return `${text.slice(0, maximumLength - 1).trim()}…`;
  };
}
