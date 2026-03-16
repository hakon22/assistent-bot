import { Container, Singleton } from 'typescript-ioc';

import { MiddlewareService } from '@/services/app/middleware.service';

@Singleton
export abstract class BaseRouter {
  protected middlewareService = Container.get(MiddlewareService);
}
