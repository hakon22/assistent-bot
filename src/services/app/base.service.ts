import { Container } from 'typescript-ioc';
import type { Response } from 'express';

import { DatabaseService } from '@/db/database.service';
import { LoggerService } from '@/services/app/logger.service';

export abstract class BaseService {
  protected databaseService = Container.get(DatabaseService);

  protected loggerService = Container.get(LoggerService);

  protected errorHandler = (error: unknown, res: Response, statusCode = 500) => {
    this.loggerService.error(error);

    const typedError = error as { name?: string; message?: string; path?: string; };
    let errorMessage = `${typedError?.name}: ${typedError?.message}`;

    if (typedError?.name === 'ValidationError') {
      errorMessage = `${typedError?.name}: "${typedError?.path}" ${typedError?.message}`;
    }

    res.status(statusCode).json({ error: errorMessage });
  };
}
