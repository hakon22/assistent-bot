import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsImageGenerationToModel1774390552293 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."model"
        ADD COLUMN "is_image_generation" BOOLEAN NOT NULL DEFAULT FALSE
    `);

    await queryRunner.query(`
      UPDATE "assistent_bot"."model"
        SET "is_image_generation" = TRUE
        WHERE "model_id" IN ('black-forest-labs/flux.2-pro', 'bytedance-seed/seedream-4.5')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."model"
        DROP COLUMN "is_image_generation"
    `);
  }
}
