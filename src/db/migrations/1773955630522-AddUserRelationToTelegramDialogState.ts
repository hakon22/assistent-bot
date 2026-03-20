import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserRelationToTelegramDialogState1773955630522 implements MigrationInterface {
  public up = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."telegram_dialog_state"
        ADD COLUMN "user_id" INTEGER;
    `);

    await queryRunner.query(`
      UPDATE "assistent_bot"."telegram_dialog_state" AS "tds"
      SET "user_id" = "user"."id"
      FROM "assistent_bot"."user" AS "user"
      WHERE "user"."telegram_id" = "tds"."telegram_id"::BIGINT;
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."telegram_dialog_state"
        ADD CONSTRAINT "FK_telegram_dialog_state_user_id"
        FOREIGN KEY ("user_id")
        REFERENCES "assistent_bot"."user"("id")
        ON DELETE CASCADE;
    `);
  };

  public down = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."telegram_dialog_state"
        DROP CONSTRAINT "FK_telegram_dialog_state_user_id";
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."telegram_dialog_state"
        DROP COLUMN "user_id";
    `);
  };
}
