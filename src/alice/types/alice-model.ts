import { AliceSkillModelEnum } from '@/alice/types/alice-skill-model';
import type { ModelMessageRoleEnum } from '@/types/model-message-role';

export const ALICE_MODEL_IDS: Record<AliceSkillModelEnum, string> = {
  [AliceSkillModelEnum.DEEPSEEK]: '~deepseek/deepseek-v4-flash-latest',
  [AliceSkillModelEnum.GEMINI]: 'google/gemini-3.1-flash-lite',
  [AliceSkillModelEnum.GROK]: '~x-ai/grok-latest',
};

export interface AliceModelMessage {
  role: ModelMessageRoleEnum;
  content: string;
}
