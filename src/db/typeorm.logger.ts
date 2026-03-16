
import { Logger, QueryRunner } from 'typeorm';
import { Container, Singleton } from 'typescript-ioc';

import { LoggerService } from '@/services/app/logger.service';

@Singleton
export class TypeormLogger implements Logger {
  private readonly loggerService = Container.get(LoggerService);

  public log(level: 'log' | 'info' | 'warn', message: string, queryRunner?: QueryRunner): void {
    if (level === 'log') {
      if (queryRunner) {
        this.loggerService.debug('SQL', queryRunner.getMemorySql());
      }
      if (message) {
        this.loggerService.debug('SQL', message);
      }
    } else if (level === 'info') {
      if (queryRunner) {
        this.loggerService.info('SQL', queryRunner.getMemorySql());
      }
      if (message) {
        this.loggerService.info('SQL', message);
      }
    } else if (level === 'warn') {
      if (queryRunner) {
        this.loggerService.warn('SQL', queryRunner.getMemorySql());
      }
      if (message) {
        this.loggerService.warn('SQL', message);
      }
    }
  }

  public logMigration(message: string): void {
    if (message) {
      this.loggerService.debug('SQL', message);
    }
  }

  public logQuery(query: string, parameters?: string[]): void {
    if (query) {
      this.loggerService.debug('SQL', query);
    }
    if (parameters && parameters.length > 0) {
      this.loggerService.debug('SQL', parameters);
    }
  }

  public logQueryError(error: string, query: string, parameters?: string[]): void {
    if (error && query) {
      this.loggerService.error('SQL', error, ':', query);
    }
    if (parameters && parameters.length > 0) {
      this.loggerService.error('SQL', parameters);
    }
  }

  public logQuerySlow(time: number, query: string, parameters?: string[]): void {
    if (time) {
      this.loggerService.error('SQL', `SLOW QUERY: ${time}`);
    }
    if (query) {
      this.loggerService.error('SQL', query);
    }
    if (parameters && parameters.length > 0) {
      this.loggerService.error('SQL', parameters);
    }
  }

  public logSchemaBuild(message: string): void {
    if (message) {
      this.loggerService.debug('SQL', message);
    }
  }
}
