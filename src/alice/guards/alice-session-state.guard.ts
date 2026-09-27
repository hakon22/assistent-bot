import { AliceHistoryRoleEnum } from '@/alice/types/alice-history-role';
import { ALICE_SESSION_STATE_VERSION } from '@/alice/types/alice-session-state';
import { isAliceObject } from '@/alice/guards/alice-object.guard';
import type { AliceSkillSessionState } from '@/alice/types/alice-session-state';

const isHistoryRole = (value: unknown): value is AliceHistoryRoleEnum =>
  value === AliceHistoryRoleEnum.USER || value === AliceHistoryRoleEnum.ASSISTANT;

const isHistoryValid = (history: unknown): boolean => {
  if (!Array.isArray(history)) {
    return false;
  }

  return history.every((message) => {
    if (!isAliceObject(message)) {
      return false;
    }

    return isHistoryRole(message.role) && typeof message.content === 'string';
  });
};

export const isAliceSkillSessionState = (value: unknown): value is AliceSkillSessionState => {
  if (!isAliceObject(value)) {
    return false;
  }

  if (value.stateVersion !== ALICE_SESSION_STATE_VERSION) {
    return false;
  }

  if (!isHistoryValid(value.history)) {
    return false;
  }

  if (value.pendingQuestion !== undefined && typeof value.pendingQuestion !== 'string') {
    return false;
  }

  return true;
};
