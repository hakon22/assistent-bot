import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameTimestampColumns1773953524162 implements MigrationInterface {
  public up = async (queryRunner: QueryRunner): Promise<void> => {
    const tablesWithCreatedAt = [
      'user',
      'request',
      'agent_delegation_log',
      'conversation_history',
      'error_log',
      'file_attachment',
      'job_vacancy',
      'request_status',
      'search_cache',
      'search_history',
      'web_research_log',
    ];

    const tablesWithUpdatedAt = [
      'user',
      'request',
    ];

    for (const table of tablesWithCreatedAt) {
      await queryRunner.query(`
        ALTER TABLE "assistent_bot"."${table}"
        RENAME COLUMN "created_at" TO "created"
      `);
    }

    for (const table of tablesWithUpdatedAt) {
      await queryRunner.query(`
        ALTER TABLE "assistent_bot"."${table}"
        RENAME COLUMN "updated_at" TO "updated"
      `);
    }
  };

  public down = async (queryRunner: QueryRunner): Promise<void> => {
    const tablesWithCreated = [
      'user',
      'request',
      'agent_delegation_log',
      'conversation_history',
      'error_log',
      'file_attachment',
      'job_vacancy',
      'request_status',
      'search_cache',
      'search_history',
      'web_research_log',
    ];

    const tablesWithUpdated = [
      'user',
      'request',
    ];

    for (const table of tablesWithCreated) {
      await queryRunner.query(`
        ALTER TABLE "assistent_bot"."${table}"
        RENAME COLUMN "created" TO "created_at"
      `);
    }

    for (const table of tablesWithUpdated) {
      await queryRunner.query(`
        ALTER TABLE "assistent_bot"."${table}"
        RENAME COLUMN "updated" TO "updated_at"
      `);
    }
  };
}
