import type { AlicePendingStatusEnum } from '@/alice/types/alice-pending-status';
import type { AliceSkillModelEnum } from '@/alice/types/alice-skill-model';

export interface AlicePendingEntry {
  status: AlicePendingStatusEnum;
  generation: number;
  createdAt: number;
  skillModel: AliceSkillModelEnum;
  answer?: string;
  errorMessage?: string;
}
