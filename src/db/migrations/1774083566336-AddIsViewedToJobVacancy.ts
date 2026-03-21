import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsViewedToJobVacancy1774083566336 implements MigrationInterface {
  public name = 'AddIsViewedToJobVacancy1774083566336';

  public up = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."job_vacancy"
        ADD COLUMN "is_viewed" BOOLEAN NOT NULL DEFAULT FALSE
    `);
  };

  public down = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."job_vacancy"
        DROP COLUMN "is_viewed"
    `);
  };

}
