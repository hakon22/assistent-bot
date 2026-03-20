import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReminderTable1773949325650 implements MigrationInterface {
  public name = 'AddReminderTable1773949325650';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('SET "search_path" TO "assistent_bot"');

    await queryRunner.query(`
      ALTER TYPE "telegram_dialog_state_enum"
        ADD VALUE IF NOT EXISTS 'REMINDER_CLARIFICATION_WAITING'
    `);

    await queryRunner.query(`
      ALTER TYPE "telegram_dialog_state_enum"
        ADD VALUE IF NOT EXISTS 'REMINDER_EDIT_WAITING'
    `);

    await queryRunner.query(`
      ALTER TYPE "telegram_dialog_state_enum"
        ADD VALUE IF NOT EXISTS 'REMINDER_EDIT_CONFIRM_WAITING'
    `);

    await queryRunner.query(`
      CREATE TYPE "reminder_status_enum"
        AS ENUM ('PENDING', 'SENT', 'CANCELLED')
    `);

    await queryRunner.query(`
      CREATE TYPE "reminder_type_enum"
        AS ENUM ('SELF', 'PARTNER')
    `);

    await queryRunner.query(`
      CREATE TABLE "reminder" (
        "id"                  SERIAL PRIMARY KEY,
        "created"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted"             TIMESTAMPTZ,
        "user_id"             INTEGER NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
        "sender_telegram_id"  VARCHAR(255) NOT NULL,
        "target_telegram_id"  VARCHAR(255) NOT NULL,
        "reminder_text"       TEXT NOT NULL,
        "scheduled"           TIMESTAMPTZ NOT NULL,
        "status"              "reminder_status_enum" NOT NULL DEFAULT 'PENDING',
        "type"                "reminder_type_enum" NOT NULL DEFAULT 'SELF'
      )
    `);

    await queryRunner.query(`
      CREATE INDEX ON "reminder" ("user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX ON "reminder" ("status", "scheduled")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('SET "search_path" TO "assistent_bot"');
    await queryRunner.query('DROP TABLE IF EXISTS "reminder"');
    await queryRunner.query('DROP TYPE IF EXISTS "reminder_type_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "reminder_status_enum"');
  }
}
