import type { AliceSkillModelEnum } from '@/alice/types/alice-skill-model';
import type { AliceIncomingBody } from '@/alice/types/alice-request-body';
import type { AliceSkillSessionState } from '@/alice/types/alice-session-state';

export interface AliceDialogHandleInput {
  body: AliceIncomingBody;
  skillModel: AliceSkillModelEnum;
}

export interface AliceQuestionInput {
  sessionId: string;
  question: string;
  skillModel: AliceSkillModelEnum;
  sessionState: AliceSkillSessionState;
}
