import { Container, Singleton } from 'typescript-ioc';
import type { Router } from 'express';

import { BaseRouter } from '@/routes/base.route';
import { TelegramService } from '@/services/telegram/telegram.service';

@Singleton
export class IntegrationRoute extends BaseRouter {
  private readonly telegramService = Container.get(TelegramService);

  public set = (router: Router) => {
    router.post('/telegram/webhook', this.middlewareService.accessTelegram, this.telegramService.handleWebhook);
  };
}
