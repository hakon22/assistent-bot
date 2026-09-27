import { AliceSkillModelEnum } from '@/alice/types/alice-skill-model';
import type { ModelMessageRoleEnum } from '@/types/model-message-role';

export const ALICE_MODEL_IDS: Record<AliceSkillModelEnum, string> = {
  [AliceSkillModelEnum.DEEPSEEK]: '~deepseek/deepseek-v4-flash-latest',
  [AliceSkillModelEnum.GEMINI]: '~google/gemini-flash-latest',
};

export interface AliceModelMessage {
  role: ModelMessageRoleEnum;
  content: string;
}
