import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertUserRoleAndStatusToEnum1773955995089 implements MigrationInterface {
  public up = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`
      CREATE TYPE "assistent_bot"."user_role_enum" AS ENUM ('USER', 'ADMIN', 'OPERATOR');
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."user"
        ALTER COLUMN "role" DROP DEFAULT;
    `);

    await queryRunner.query(`
      UPDATE "assistent_bot"."user"
      SET "role" = UPPER("role");
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."user"
        ALTER COLUMN "role" TYPE "assistent_bot"."user_role_enum"
        USING "role"::"assistent_bot"."user_role_enum";
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."user"
        ALTER COLUMN "role" SET DEFAULT 'USER';
    `);

    await queryRunner.query(`
      CREATE TYPE "assistent_bot"."user_status_enum" AS ENUM ('ACTIVE', 'BANNED', 'INACTIVE');
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."user"
        ALTER COLUMN "status" DROP DEFAULT;
    `);

    await queryRunner.query(`
      UPDATE "assistent_bot"."user"
      SET "status" = UPPER("status");
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."user"
        ALTER COLUMN "status" TYPE "assistent_bot"."user_status_enum"
        USING "status"::"assistent_bot"."user_status_enum";
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."user"
        ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
    `);
  };

  public down = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."user"
        ALTER COLUMN "status" DROP DEFAULT;
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."user"
        ALTER COLUMN "status" TYPE CHARACTER VARYING
        USING LOWER("status"::TEXT);
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."user"
        ALTER COLUMN "status" SET DEFAULT 'active';
    `);

    await queryRunner.query(`
      DROP TYPE "assistent_bot"."user_status_enum";
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."user"
        ALTER COLUMN "role" DROP DEFAULT;
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."user"
        ALTER COLUMN "role" TYPE CHARACTER VARYING
        USING LOWER("role"::TEXT);
    `);

    await queryRunner.query(`
      ALTER TABLE "assistent_bot"."user"
        ALTER COLUMN "role" SET DEFAULT 'user';
    `);

    await queryRunner.query(`
      DROP TYPE "assistent_bot"."user_role_enum";
    `);
  };
}
