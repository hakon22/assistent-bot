import { Container, Singleton } from 'typescript-ioc';
import type { Router } from 'express';

import { AliceSkillModelEnum, ALICE_WEBHOOK_PATH } from '@/alice/types';
import { BaseRouter } from '@/routes/base.route';
import { AliceWebhookService } from '@/services/alice/alice-webhook.service';

@Singleton
export class AliceRoute extends BaseRouter {
  private readonly aliceWebhookService = Container.get(AliceWebhookService);

  public set = (router: Router) => {
    router.post(
      ALICE_WEBHOOK_PATH[AliceSkillModelEnum.DEEPSEEK],
      this.aliceWebhookService.handle(AliceSkillModelEnum.DEEPSEEK),
    );
    router.post(
      ALICE_WEBHOOK_PATH[AliceSkillModelEnum.GEMINI],
      this.aliceWebhookService.handle(AliceSkillModelEnum.GEMINI),
    );
    router.post(
      ALICE_WEBHOOK_PATH[AliceSkillModelEnum.GROK],
      this.aliceWebhookService.handle(AliceSkillModelEnum.GROK),
    );
    router.post(
      ALICE_WEBHOOK_PATH[AliceSkillModelEnum.GPT],
      this.aliceWebhookService.handle(AliceSkillModelEnum.GPT),
    );
  };
}
