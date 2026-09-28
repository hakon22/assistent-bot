import { AliceSkillModelEnum } from '@/alice/types/alice-skill-model';

export const ALICE_WEBHOOK_PATH = {
  [AliceSkillModelEnum.DEEPSEEK]: '/alice/deepseek',
  [AliceSkillModelEnum.GEMINI]: '/alice/gemini',
  [AliceSkillModelEnum.GROK]: '/alice/grok',
  [AliceSkillModelEnum.GPT]: '/alice/gpt',
} as const satisfies Record<AliceSkillModelEnum, string>;

export type AliceWebhookPath = typeof ALICE_WEBHOOK_PATH[keyof typeof ALICE_WEBHOOK_PATH];
