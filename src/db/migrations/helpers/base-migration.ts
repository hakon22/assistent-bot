import type { QueryRunner } from 'typeorm';

export abstract class BaseMigration {
  protected toPosgresEnum = (values: string[]): string => `ENUM(${values.map(value => `'${value}'`).join(', ')})`;

  protected async changeEnum({ runner, schema, table, tables, column, enumName, values, defaultValue }: { runner: QueryRunner; schema: string; table?: string; tables?: string[]; column: string; enumName: string; values: string[]; defaultValue?: string; }): Promise<void> {
    if (defaultValue) {
      await runner.query(`ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" DROP DEFAULT`);
    }

    await runner.query(`ALTER TYPE "${schema}"."${enumName}" RENAME TO "${enumName}_before"`);
    await runner.query(`CREATE TYPE "${schema}"."${enumName}" AS ${this.toPosgresEnum(values)}`);

    if (table) {
      await this.changeColumnType({ runner, schema, table, column, enumName });
    } else if (tables?.length) {
      for (const value of tables) {
        await this.changeColumnType({ runner, schema, table: value, column, enumName });
      }
    }

    await runner.query(`DROP TYPE "${schema}"."${enumName}_before"`);

    if (defaultValue) {
      await runner.query(`ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" SET DEFAULT '${defaultValue}'`);
    }
  }

  protected async changeColumnType({ runner, schema, table, column, enumName }: { runner: QueryRunner; schema: string; table: string; column: string; enumName: string; }): Promise<void> {
    await runner.query(`
      ALTER TABLE "${schema}"."${table}"
        ALTER column "${column}" TYPE "${schema}"."${enumName}" USING ${column}::text::"${schema}"."${enumName}"
    `);
  }
}
