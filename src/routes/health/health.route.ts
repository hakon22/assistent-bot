import { Singleton } from 'typescript-ioc';
import type { Router } from 'express';

import { BaseRouter } from '@/routes/base.route';

@Singleton
export class HealthRoute extends BaseRouter {
  public set = (router: Router) => {
    router.get('/health', (_req, res) => {
      res.json({ status: 'ok', ts: new Date().toISOString() });
    });
  };
}
