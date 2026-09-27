import { isEmpty, isNil } from 'lodash-es';
import { Singleton } from 'typescript-ioc';

import { BaseService } from '@/services/app/base.service';
import { parseAliceAllowedUserIds } from '@/alice/config/alice-environment';
import { AliceAccessDeniedReasonEnum } from '@/alice/types/alice-access-denied-reason';
import type { AliceAccessResult } from '@/alice/types/alice-access';
import type { AliceSession } from '@/alice/types/alice-session';


@Singleton
export class AliceAccessService extends BaseService {
  private readonly TAG = 'AliceAccessService';

  private readonly allowedUserIds = parseAliceAllowedUserIds();

  private whitelistWarningLogged = false;

  public check = (session: AliceSession): AliceAccessResult => {
    this.warnIfWhitelistEmpty();

    const userId = session.user?.user_id;

    if (isNil(userId) || !userId.trim()) {
      return {
        allowed: false,
        reason: AliceAccessDeniedReasonEnum.NO_USER,
      };
    }

    if (!this.allowedUserIds.includes(userId)) {
      return {
        allowed: false,
        reason: AliceAccessDeniedReasonEnum.NOT_WHITELISTED,
      };
    }

    return { allowed: true };
  };

  private warnIfWhitelistEmpty = (): void => {
    if (!isEmpty(this.allowedUserIds) || this.whitelistWarningLogged) {
      return;
    }

    this.whitelistWarningLogged = true;
    this.loggerService.warn(this.TAG, 'ALICE_ALLOWED_YANDEX_USER_IDS is empty, every Alice user will be rejected');
  };
}
