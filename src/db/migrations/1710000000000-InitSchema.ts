import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1710000000000 implements MigrationInterface {
  public name = 'InitSchema1710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "assistent_bot"');
    await queryRunner.query('SET "search_path" TO "assistent_bot"');

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "telegram_dialog_state_enum" AS ENUM (
          'IDLE',
          'PROFILE_WAIT_RESUME',
          'USER_CLARIFICATION_WAITING'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        "id"              SERIAL PRIMARY KEY,
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        "telegram_id"     BIGINT NOT NULL UNIQUE,
        "username"        VARCHAR,
        "display_name"    VARCHAR,
        "first_name"      VARCHAR,
        "last_name"       VARCHAR,
        "role"            VARCHAR NOT NULL DEFAULT 'user',
        "status"          VARCHAR NOT NULL DEFAULT 'active',
        "resume_text"     TEXT,
        "resume_file_id"  VARCHAR,
        "extra_data"      JSONB NOT NULL DEFAULT '{}',
        "last_seen_at"    TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "request" (
        "id"                      SERIAL PRIMARY KEY,
        "request_uuid"            UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        "user_id"                 INTEGER REFERENCES "user"("id") ON DELETE SET NULL,
        "telegram_message_id"     BIGINT,
        "telegram_chat_id"        BIGINT,
        "raw_text"                TEXT,
        "media_type"              VARCHAR,
        "agent_handled"           VARCHAR,
        "final_response"          TEXT,
        "execution_id"            VARCHAR,
        "processing_started_at"   TIMESTAMPTZ,
        "processing_completed_at" TIMESTAMPTZ,
        "created_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"              TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "request_status" (
        "id"          SERIAL PRIMARY KEY,
        "request_id"  INTEGER NOT NULL REFERENCES "request"("id") ON DELETE CASCADE,
        "status"      VARCHAR NOT NULL,
        "agent_name"  VARCHAR,
        "notes"       TEXT,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_request_status_request_id"
        ON "request_status" ("request_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "file_attachment" (
        "id"               SERIAL PRIMARY KEY,
        "request_id"       INTEGER REFERENCES "request"("id") ON DELETE SET NULL,
        "user_id"          INTEGER REFERENCES "user"("id") ON DELETE SET NULL,
        "telegram_file_id" VARCHAR NOT NULL,
        "file_type"        VARCHAR,
        "mime_type"        VARCHAR,
        "file_name"        VARCHAR,
        "file_size"        INTEGER,
        "download_url"     TEXT,
        "extracted_text"   TEXT,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_delegation_log" (
        "id"            SERIAL PRIMARY KEY,
        "request_id"    INTEGER NOT NULL REFERENCES "request"("id") ON DELETE CASCADE,
        "from_agent"    VARCHAR NOT NULL DEFAULT 'manager',
        "to_agent"      VARCHAR NOT NULL,
        "reason"        TEXT,
        "llm_reasoning" TEXT,
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conversation_history" (
        "id"          SERIAL PRIMARY KEY,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "user_id"     INTEGER REFERENCES "user"("id") ON DELETE CASCADE,
        "telegram_id" VARCHAR,
        "request_id"  INTEGER REFERENCES "request"("id") ON DELETE SET NULL,
        "role"        VARCHAR NOT NULL,
        "content"     TEXT NOT NULL,
        "agent_name"  VARCHAR,
        "token_count" INTEGER
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_conversation_history_user_id"
        ON "conversation_history" ("user_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "search_history" (
        "id"             SERIAL PRIMARY KEY,
        "request_id"     INTEGER REFERENCES "request"("id") ON DELETE SET NULL,
        "user_id"        INTEGER REFERENCES "user"("id") ON DELETE SET NULL,
        "query_text"     TEXT NOT NULL,
        "search_engine"  VARCHAR NOT NULL DEFAULT 'yandex',
        "source_url"     TEXT,
        "result_snippet" TEXT,
        "page_content"   TEXT,
        "agent_name"     VARCHAR,
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "search_cache" (
        "id"            SERIAL PRIMARY KEY,
        "query_hash"    CHAR(64) NOT NULL UNIQUE,
        "query_text"    TEXT NOT NULL,
        "search_engine" VARCHAR NOT NULL DEFAULT 'yandex',
        "results"       JSONB NOT NULL,
        "hit_count"     INTEGER NOT NULL DEFAULT 0,
        "expires_at"    TIMESTAMPTZ NOT NULL,
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_search_cache_expires_at"
        ON "search_cache" ("expires_at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "job_vacancy" (
        "id"                  SERIAL PRIMARY KEY,
        "request_id"          INTEGER REFERENCES "request"("id") ON DELETE SET NULL,
        "user_id"             INTEGER REFERENCES "user"("id") ON DELETE SET NULL,
        "hh_vacancy_id"       VARCHAR,
        "title"               VARCHAR(512) NOT NULL,
        "company_name"        VARCHAR,
        "salary_from"         INTEGER,
        "salary_to"           INTEGER,
        "salary_currency"     VARCHAR NOT NULL DEFAULT 'RUR',
        "employment_type"     VARCHAR,
        "experience"          VARCHAR,
        "location"            VARCHAR,
        "url"                 TEXT,
        "description_snippet" TEXT,
        "skills"              JSONB NOT NULL DEFAULT '[]',
        "match_score"         NUMERIC(5,2),
        "match_reason"        TEXT,
        "is_saved"            BOOLEAN NOT NULL DEFAULT false,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_job_vacancy_request_id"
        ON "job_vacancy" ("request_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_job_vacancy_user_id"
        ON "job_vacancy" ("user_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "web_research_log" (
        "id"            SERIAL PRIMARY KEY,
        "request_id"    INTEGER REFERENCES "request"("id") ON DELETE SET NULL,
        "user_id"       INTEGER REFERENCES "user"("id") ON DELETE SET NULL,
        "goal"          TEXT NOT NULL,
        "iterations"    SMALLINT NOT NULL DEFAULT 0,
        "pages_fetched" SMALLINT NOT NULL DEFAULT 0,
        "searches_done" SMALLINT NOT NULL DEFAULT 0,
        "response_text" TEXT,
        "results"       JSONB NOT NULL DEFAULT '[]',
        "agent_name"    VARCHAR NOT NULL DEFAULT 'tours_hotels_agent',
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "error_log" (
        "id"               SERIAL PRIMARY KEY,
        "request_id"       INTEGER REFERENCES "request"("id") ON DELETE SET NULL,
        "user_telegram_id" BIGINT,
        "service_name"     VARCHAR,
        "node_name"        VARCHAR,
        "error_message"    TEXT NOT NULL,
        "error_stack"      TEXT,
        "error_data"       JSONB,
        "error_notified"   BOOLEAN NOT NULL DEFAULT false,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "telegram_dialog_state" (
        "id"          SERIAL PRIMARY KEY,
        "created"     TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated"     TIMESTAMPTZ NOT NULL DEFAULT now(),
        "telegram_id" VARCHAR NOT NULL UNIQUE,
        "state"       "telegram_dialog_state_enum" NOT NULL DEFAULT 'IDLE',
        "data"        JSONB
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "telegram_dialog_state" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "error_log" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "web_research_log" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "job_vacancy" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "search_cache" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "search_history" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "conversation_history" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "agent_delegation_log" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "file_attachment" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "request_status" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "request" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "user" CASCADE');
    await queryRunner.query('DROP TYPE IF EXISTS "telegram_dialog_state_enum"');
  }
}
