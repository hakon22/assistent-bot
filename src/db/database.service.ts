import { DataSource } from 'typeorm';
import { Singleton } from 'typescript-ioc';
import 'dotenv/config';

import { entities } from '@/db/entities';
import { TypeormLogger } from '@/db/typeorm.logger';

const {
  DB = 'LOCAL',
  DB_LOCAL = '',
  DB_HOST = '',
  USER_DB_LOCAL = '',
  PASSWORD_DB_LOCAL = '',
  USER_DB_HOST = '',
  PASSWORD_DB_HOST = '',
  IS_DOCKER = '',
  NODE_ENV,
} = process.env;

const host = (NODE_ENV === 'production' && DB !== 'LOCAL') || !IS_DOCKER ? 'localhost' : 'host.docker.internal';

export const databaseConfig = new DataSource({
  type: 'postgres',
  host,
  port: 5432,
  username: DB === 'LOCAL' ? USER_DB_LOCAL : USER_DB_HOST,
  password: DB === 'LOCAL' ? PASSWORD_DB_LOCAL : PASSWORD_DB_HOST,
  database: DB === 'LOCAL' ? DB_LOCAL : DB_HOST,
  logger: new TypeormLogger(),
  schema: 'assistent_bot',
  synchronize: false,
  logging: true,
  entities,
  subscribers: [],
  migrations: [`src/db/migrations/*.${NODE_ENV === 'production' ? 'js' : 'ts'}`],
});

@Singleton
export abstract class DatabaseService {
  private db: DataSource;

  constructor() {
    this.db = databaseConfig;
  }

  public getManager = () => {
    if (!this.db.isInitialized) {
      throw new Error('Database connection is not initialized. Please call init() first.');
    }
    return this.db.createEntityManager();
  };

  public init = async () => {
    try {
      await this.db.initialize();
      console.log('Соединение с PostgreSQL успешно установлено');
    } catch (e) {
      console.log('Невозможно выполнить подключение к PostgreSQL: ', e);
    }
  };
}
