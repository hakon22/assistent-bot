import type { AliceAccessDeniedReasonEnum } from '@/alice/types/alice-access-denied-reason';

export interface AliceAccessResult {
  allowed: boolean;
  reason?: AliceAccessDeniedReasonEnum;
}
