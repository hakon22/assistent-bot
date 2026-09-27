import type { AliceHistoryRoleEnum } from '@/alice/types/alice-history-role';

export interface AliceHistoryMessage {
  role: AliceHistoryRoleEnum;
  content: string;
}

export const ALICE_SESSION_STATE_VERSION = 1 as const;

export interface AliceSkillSessionState {
  stateVersion: typeof ALICE_SESSION_STATE_VERSION;
  history: AliceHistoryMessage[];
  pendingQuestion?: string;
}
