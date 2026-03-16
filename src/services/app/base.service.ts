import { Container } from 'typescript-ioc';
import type { Response } from 'express';

import { DatabaseService } from '@/db/database.service';
import { LoggerService } from '@/services/app/logger.service';

export abstract class BaseService {
  protected databaseService = Container.get(DatabaseService);

  protected loggerService = Container.get(LoggerService);

  protected errorHandler = (e: any, res: Response, statusCode = 500) => {
    this.loggerService.error(e);

    let error = `${e?.name}: ${e?.message}`;

    if (e?.name === 'ValidationError') {
      error = `${e?.name}: "${e?.path}" ${e?.message}`;
    }

    res.status(statusCode).json({ error });
  };
}
