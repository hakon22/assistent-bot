import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserRelationToErrorLog1773955622588 implements MigrationInterface {
  public up = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."error_log"
        ADD COLUMN "user_id" INTEGER;
    `);

    await queryRunner.query(`
      UPDATE "assistent_bot"."error_log" AS "error_log"
      SET "user_id" = "user"."id"
      FROM "assistent_bot"."user" AS "user"
      WHERE "user"."telegram_id" = "error_log"."user_telegram_id";
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."error_log"
        ADD CONSTRAINT "FK_error_log_user_id"
        FOREIGN KEY ("user_id")
        REFERENCES "assistent_bot"."user"("id")
        ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."error_log"
        DROP COLUMN "user_telegram_id";
    `);
  };

  public down = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."error_log"
        ADD COLUMN "user_telegram_id" BIGINT;
    `);

    await queryRunner.query(`
      UPDATE "assistent_bot"."error_log" AS "error_log"
      SET "user_telegram_id" = "user"."telegram_id"::BIGINT
      FROM "assistent_bot"."user" AS "user"
      WHERE "user"."id" = "error_log"."user_id";
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."error_log"
        DROP CONSTRAINT "FK_error_log_user_id";
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."error_log"
        DROP COLUMN "user_id";
    `);
  };
}
