# New Entity

Create a new TypeORM entity for the assistent-bot project.

Ask the user for the entity name (PascalCase, e.g. `UserSettings`) and the list of fields (name, type, nullable, default), if not already provided in the arguments.

Then perform the following steps:

## Step 1 — Create the entity file

Create `src/db/entities/<kebab-name>.entity.ts` following the existing entity style in the project:

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';

@Entity({ schema: 'assistent_bot', name: '<table_name>' })
export class <PascalName>Entity {
    @PrimaryGeneratedColumn()
    public id: number;

    // ... columns based on user input

    @CreateDateColumn()
    public createdAt: Date;

    @UpdateDateColumn()
    public updatedAt: Date;
}
```

Rules for entity files:
- Schema is always `assistent_bot`
- Table name in snake_case
- Column names in camelCase (TypeORM maps them)
- Always include `createdAt` and `updatedAt`
- Use `@ManyToOne` + `@JoinColumn` for relations, never embed foreign key manually

## Step 2 — Export from entities index

Check if `src/db/entities/index.ts` exists. If yes, add the new entity to the exports. If not, note it.

Also add the entity to the `entities` array in `src/db/database.service.ts`.

## Step 3 — Output the migration command

Print the exact command to run:

```bash
npm run migration:name Add<PascalName>Entity
```

And remind the user about SQL style rules for the migration file that will be generated:
- No abbreviations
- Schema, table, and column names wrapped in double quotes
- SQL keywords in UPPERCASE

Example of correct migration SQL:
```sql
CREATE TABLE "assistent_bot"."<table_name>" (
    "id" SERIAL NOT NULL,
    "userId" integer NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT "PK_<table_name>" PRIMARY KEY ("id"),
    CONSTRAINT "FK_<table_name>_user" FOREIGN KEY ("userId") REFERENCES "assistent_bot"."user" ("id")
);
```

## Step 4 — Remind the user

After generating the files, remind the user to:
- Run the migration command above
- Open the generated migration file and verify/complete the SQL using the correct style
- Run `npm run migration:run` (dev) or `npm run migration:run:prod` (prod) to apply
