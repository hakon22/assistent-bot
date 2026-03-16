import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserModelId1710000000001 implements MigrationInterface {
  public name = 'AddUserModelId1710000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('SET "search_path" TO "assistent_bot"');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "model" (
        "model_id"   VARCHAR NOT NULL PRIMARY KEY,
        "name"       VARCHAR NOT NULL,
        "price_in"   VARCHAR NOT NULL,
        "price_out"  VARCHAR NOT NULL,
        "modalities" VARCHAR NOT NULL,
        "is_default" BOOLEAN NOT NULL DEFAULT false,
        "is_active"  BOOLEAN NOT NULL DEFAULT true,
        "sort_order" INTEGER NOT NULL DEFAULT 0
      )
    `);

    await queryRunner.query(`
      INSERT INTO "model" ("model_id", "name", "price_in", "price_out", "modalities", "is_default", "sort_order") VALUES
        ('google/gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash Lite', '26₽',  '156₽',  'Текст · Фото · Видео · Аудио', true,  0),
        ('google/gemini-3-flash-preview',        'Gemini 3 Flash',        '~52₽', '~312₽', 'Текст · Фото · Видео',         false, 1),
        ('qwen/qwen3.5-9b',                      'Qwen 3.5 9B',           '5₽',   '15₽',   'Текст · Фото · Видео',         false, 2),
        ('bytedance-seed/seed-2.0-mini',         'Seed 2.0 Mini',         '10₽',  '41₽',   'Текст · Фото · Видео',         false, 3),
        ('bytedance-seed/seed-2.0-lite',         'Seed 2.0 Lite',         '26₽',  '208₽',  'Текст · Фото · Видео',         false, 4),
        ('qwen/qwen3.5-flash-02-23',             'Qwen 3.5 Flash',        '10₽',  '41₽',   'Текст · Фото · Видео',         false, 5),
        ('qwen/qwen3.5-27b',                     'Qwen 3.5 27B',          '20₽',  '162₽',  'Текст · Фото · Видео',         false, 6),
        ('qwen/qwen3.5-35b-a3b',                 'Qwen 3.5 35B-A3B',      '26₽',  '104₽',  'Текст · Фото · Видео',         false, 7),
        ('qwen/qwen3.5-plus-02-15',              'Qwen 3.5 Plus',         '27₽',  '162₽',  'Текст · Фото · Видео',         false, 8),
        ('qwen/qwen3.5-122b-a10b',               'Qwen 3.5 122B',         '27₽',  '216₽',  'Текст · Фото · Видео',         false, 9)
      ON CONFLICT ("model_id") DO NOTHING
    `);

    await queryRunner.query(`
      ALTER TABLE "user"
        ADD COLUMN IF NOT EXISTS "model_id" VARCHAR REFERENCES "model" ("model_id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('SET "search_path" TO "assistent_bot"');
    await queryRunner.query('ALTER TABLE "user" DROP COLUMN IF EXISTS "model_id"');
    await queryRunner.query('DROP TABLE IF EXISTS "model"');
  }
}
