import { isUndefined } from 'lodash-es';
import moment from 'moment-timezone';
import ms from 'ms';
import { Singleton } from 'typescript-ioc';

import { BaseService } from '@/services/app/base.service';
import { AlicePendingStatusEnum } from '@/alice/types/alice-pending-status';
import type { AlicePendingEntry } from '@/alice/types/alice-pending';
import type { AliceSkillModelEnum } from '@/alice/types/alice-skill-model';

/**
 * Фоновые ответы, которые не успели за лимит Алисы.
 * Хранятся в памяти процесса. После перезапуска сервера незавершённый ответ пропадает.
 */
@Singleton
export class AlicePendingService extends BaseService {
  private readonly TAG = 'AlicePendingService';

  private readonly TIME_TO_LIVE_MILLISECONDS = ms('10 minutes');

  private readonly entries = new Map<string, AlicePendingEntry>();

  public get = (sessionId: string): AlicePendingEntry | undefined => {
    const entry = this.entries.get(sessionId);

    if (isUndefined(entry)) {
      return undefined;
    }

    if (moment().diff(moment(entry.createdAt)) > this.TIME_TO_LIVE_MILLISECONDS) {
      this.entries.delete(sessionId);
      this.loggerService.debug(this.TAG, 'Dropped expired Alice pending answer', { sessionId });
      return undefined;
    }

    return entry;
  };

  public begin = (sessionId: string, skillModel: AliceSkillModelEnum): number => {
    const previousEntry = this.entries.get(sessionId);
    const generation = (previousEntry?.generation ?? 0) + 1;

    this.entries.set(sessionId, {
      status: AlicePendingStatusEnum.RUNNING,
      generation,
      createdAt: moment().valueOf(),
      skillModel,
    });

    this.loggerService.info(this.TAG, 'Background Alice answer started', { sessionId, skillModel, generation });

    return generation;
  };

  public complete = (sessionId: string, generation: number, answer: string): void => {
    const entry = this.entries.get(sessionId);

    if (isUndefined(entry) || entry.generation !== generation) {
      return;
    }

    this.entries.set(sessionId, {
      ...entry,
      status: AlicePendingStatusEnum.DONE,
      answer,
    });

    this.loggerService.info(this.TAG, 'Background Alice answer completed', { sessionId, generation });
  };

  public fail = (sessionId: string, generation: number, errorMessage: string): void => {
    const entry = this.entries.get(sessionId);

    if (isUndefined(entry) || entry.generation !== generation) {
      return;
    }

    this.entries.set(sessionId, {
      ...entry,
      status: AlicePendingStatusEnum.ERROR,
      errorMessage,
    });

    this.loggerService.error(this.TAG, 'Background Alice answer failed', { sessionId, generation, errorMessage });
  };

  public remove = (sessionId: string): void => {
    this.entries.delete(sessionId);
  };
}
