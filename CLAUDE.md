# assistent-bot — CLAUDE.md

## Project Purpose
Personal Telegram assistant bot — a companion and helper for the owner. Supports text, images, voice, documents, and multi-agent routing.

## Tech Stack
- **Runtime:** Node.js 25, TypeScript 5.9 (ESM, path aliases)
- **Telegram:** Telegraf 4.16.3
- **AI:** LangChain 1.2 + LangGraph 1.2, OpenAI-compatible API (via `LLM_BASE_URL`)
- **DB:** PostgreSQL + TypeORM 0.3, schema `assistent_bot`
- **Web scraping:** Playwright (Chromium)
- **Logging:** Winston (daily rotation, Moscow tz)
- **DI:** typescript-ioc (Singleton)

## Key Architecture
Multi-agent system with LangGraph:
- **ManagerAgent** — routes requests to one of 3 agents
- **GeneralAgent** — default Q&A, multimodal (text/image/file)
- **JobSearchAgent** — hh.ru vacancy search + resume matching
- **ToursHotelsAgent** — agentic web research (Yandex Search + Playwright)

## Project Structure
```
src/
├── bot.ts                        # Entry point (Express + Telegraf)
├── db/
│   ├── database.service.ts
│   ├── entities/                 # 13 TypeORM entities
│   └── migrations/
├── services/
│   ├── agents/                   # manager, general, job-search, tours-hotels
│   ├── telegram/                 # bot service, commands, webhook
│   ├── tools/                    # hh-api, yandex-search, playwright, yandex-stt
│   ├── model/                    # LLM wrapper
│   ├── search/                   # 6h cache
│   ├── request/                  # request lifecycle
│   └── error/                    # error logging
└── routes/                       # health, webhook
```

## Common Commands
```bash
npm run build                 # TypeScript → ESM
npm run start:bot:dev         # Dev mode (polling + LOCAL DB)
npm run start:bot:prod        # Prod mode (webhook + HOST DB)
npm run migration:run         # Apply migrations (dev)
npm run migration:run:prod    # Apply migrations (prod)
npm run lint                  # ESLint
```

## Environment Variables (.env)
| Key | Purpose |
|-----|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token |
| `TELEGRAM_CHAT_ID` | Primary owner ID |
| `TELEGRAM_CHAT_ID2` | Secondary allowed user |
| `DB` | `LOCAL` or `HOST` |
| `LLM_BASE_URL` | LLM API endpoint |
| `LLM_API_KEY` | LLM key |
| `LLM_MODEL_NAME` | Default model |
| `YANDEX_SEARCH_API_KEY` | Yandex Search |
| `YANDEX_VOICE_API_KEY` | Yandex STT |
| `PROXY_HOST/USER/PASS` | SOCKS5 proxy (optional) |

## Database
- Schema: `assistent_bot`
- 13 entities: user, model, request, request_status, conversation_history, file_attachment, job_vacancy, search_history, search_cache, agent_delegation_log, web_research_log, error_log, telegram_dialog_state
- LOCAL DB mode: `localhost:5432` (env: `DB=LOCAL`)
- HOST DB mode: production RDS (env: `DB=HOST`)

## Bot Commands
- `/start` — greeting
- `/resume` — upload resume (PDF or URL) for job matching
- `/model` — choose LLM model
- `/stop` — cancel current operation
- `/help` — show usage

## Access Control
Only 2 Telegram user IDs are allowed (`TELEGRAM_CHAT_ID`, `TELEGRAM_CHAT_ID2`).

## MANDATORY Rules — must be followed without exception

### 1. No abbreviations
Never use abbreviations anywhere: in variable names, function names, class names, file names, comments, or SQL. Write everything in full.

Bad:  `const usrId`, `function getPgData`, `const mgr`
Good: `const userId`, `function getPostgresData`, `const manager`

### 2. Creating migrations
Migrations must always be created with the command:
```bash
npm run migration:name MigrationName
```
Never create migration files manually.

### 3. SQL style in migrations
All SQL in migrations must follow this style:
- No abbreviations
- Schema, table names, and column names must always be wrapped in double quotes
- Keywords in UPPERCASE

```sql
-- Correct:
ALTER TABLE "assistent_bot"."user" ADD COLUMN "telegramUsername" VARCHAR(255);
CREATE INDEX ON "assistent_bot"."conversation_history" ("userId");

-- Wrong:
ALTER TABLE assistent_bot.user ADD COLUMN telegram_username varchar(255);
```

### 4. Logging
Every significant action must be logged via `LoggerService`. This includes:
- Start and completion of agent processing
- Database writes (entities created/updated)
- External API calls (hh.ru, Yandex, Telegram)
- Routing decisions in ManagerAgent
- Errors (always)

Use appropriate levels: `info` for normal flow, `warn` for non-critical issues, `error` for failures, `debug` for detailed diagnostic data.

### 5. Complex database queries — createQueryBuilder only
Complex queries (joins, subqueries, conditions on related entities, aggregations) must use `createQueryBuilder`. Never use `find()` with deep nested relations for complex logic.

```typescript
// Correct for complex queries:
const result = await this.repository
    .createQueryBuilder('conversationHistory')
    .setParameters({
      telegramId,
    })
    .leftJoin('conversationHistory.user', 'user')
    .addSelect([
      'user.id',
    ])
    .where('user.telegramId = :telegramId')
    .orderBy('conversationHistory.createdAt', 'DESC')
    .limit(10)
    .getMany();

// Simple lookups with find() are acceptable:
const user = await this.userRepository.findOne({ where: { telegramId } });
```

### 6. Transactions for multi-table writes
If within a single operation data is written to multiple tables, the entire operation must be wrapped in a transaction.

```typescript
await this.databaseService.transaction(async (manager) => {
    await manager.save(RequestEntity, request);
    await manager.save(RequestStatusEntity, requestStatus);
});
```

### 7. Scalable, reusable, and readable code
- Extract repeated logic into separate methods
- Each method must do one thing only (Single Responsibility)
- Avoid deep nesting — extract complex branches into named methods
- Prefer composition over duplication
- Code must be easy to read and maintain without additional explanation

### 8. Arrow functions only
All functions and methods must be written as arrow functions — both standalone functions and class methods.

```typescript
// Correct:
class UserService {
    public getUser = async (userId: number): Promise<UserEntity> => { ... };

    private buildQuery = (telegramId: string) => { ... };
}

const formatMessage = (text: string): string => { ... };

// Wrong:
class UserService {
    async getUser(userId: number): Promise<UserEntity> { ... }
}

function formatMessage(text: string): string { ... }
```

### 9. Member ordering in classes
Follow this order strictly:

1. **Private constants** (at the top)
2. **Public constants / public properties**
3. **Constructor**
4. **Public methods**
5. **Private methods** (at the bottom)

```typescript
class ExampleService {
    private readonly SOME_LIMIT = 10;           // 1. private constants first

    private readonly OTHER_CONSTANT = 'value';

    public readonly name = 'ExampleService';    // 2. public properties

    public constructor(...) { ... }                    // 3. constructor

    public doSomething = async () => { ... };   // 4. public methods

    private buildPayload = () => { ... };       // 5. private methods last

    private formatResult = () => { ... };
}
```

### 10. Destructuring
Use destructuring wherever possible — in function parameters, array/object assignments, loops, and callbacks.

```typescript
// Correct:
const { userId, telegramId, resume } = user;
const [firstVacancy, ...rest] = vacancies;

vacancies.map(({ id, name, employer }) => ({ id, name, employer }));
vacancies.filter(({ salary }) => salary !== null);

const getUser = async ({ telegramId, role }: UserEntity) => { ... };

for (const { id, status } of requests) { ... }

// Wrong:
const userId = user.userId;
vacancies.map((vacancy) => vacancy.id);
```

### 11. Strict equality and lodash checks
Always use strict equality/inequality operators. Never use `==` or `!=`.

```typescript
// Correct:
if (status === 'completed') {
    ...
}

// Wrong:
if (status == 'completed') {... }
if (count != 0) { ... }
```

Avoid redundant comparisons against zero or boolean literals — rely on truthiness instead:

```typescript
// Correct:
if (count) {
  ...
}
if (array.length) {
  ...
}
if (isActive) {
  ...
}
if (!isActive) {
  ...
}

// Wrong:
if (count !== 0) { ... }
if (array.length > 0) { ... }
if (isActive === true) { ... }
if (isActive === false) { ... }
```

For checks against `undefined`, `null`, empty arrays, or empty objects — always use lodash functions instead of manual checks:

```typescript
import { isNil, isNull, isUndefined, isEmpty } from 'lodash';

// Correct:
if (isNil(value)) {
  ...
}           // null or undefined
if (isNull(value)) {
  ...
}          // strictly null
if (isUndefined(value)) {
  ...
}     // strictly undefined
if (isEmpty(list)) {
  ...
}          // [], {}, '', null, undefined
if (!isEmpty(vacancies)) {
  ...
}    // non-empty array

// Wrong:
if (value === null || value === undefined) { ... }
if (value == null) { ... }
if (!list.length) { ... }
if (Object.keys(obj).length === 0) { ... }
```

### 12. Dependency injection — BaseService + Container.get
Never inject dependencies via constructor parameters.

All services, agents, tools, and commands must extend `BaseService` (`@services/app/base.service`). It provides `loggerService` and `databaseService` out of the box — never redeclare them.

Additional dependencies are declared as private readonly properties using `Container.get()`.

```typescript
// Correct:
@Singleton
export class SomeService extends BaseService {
    private readonly TAG = 'SomeService';

    private readonly userService = Container.get(UserService);
    // loggerService and databaseService are inherited — no need to declare
}

// Wrong:
export class SomeService {
    public constructor(
        private readonly loggerService: LoggerService,
        private readonly userService: UserService,
    ) {}
}

// Also wrong — redeclaring what BaseService already provides:
export class SomeService extends BaseService {
    private readonly loggerService = Container.get(LoggerService);
}
```

### 13. TAG constant for logging
Every class must have a private `TAG` constant equal to the class name. Use `this.TAG` as the first argument in every logger call.

Logger signature: `loggerService.info(tag, message, meta?)` / `loggerService.error(tag, message, error?)`.

```typescript
@Singleton
export class UserService {
    private readonly TAG = 'UserService';

    public getUser = async (telegramId: string) => {
        this.loggerService.info(this.TAG, 'Fetching user', { telegramId });

        try {
            ...
        } catch (error) {
            this.loggerService.error(this.TAG, 'getUser', error);
            throw error;
        }
    };
}
```

### 14. TypeScript type syntax
- Arrays: always use `Type[]`, never `Array<Type>`
- Object types: always end the last field with `;`

```typescript
// Correct:
{ type: string; content: string; }[]
string[]
number[]

// Wrong:
Array<{ type: string; content: string }>
Array<string>
```

## Code Conventions
- All services are Singleton via `@Singleton` decorator (typescript-ioc)
- Use Winston logger via `LoggerService` (not `console.log`)
- Database access via TypeORM Repository pattern
- Agents return `string` (formatted HTML for Telegram)
- Error handling: always wrap in `try/catch` and call `ErrorLogService.log()`

## Deployment
- Docker: multi-stage build (Node 25 Alpine + Chromium)
- `docker-compose.prod.yml`: runs migrations then bot
- Logs: `/srv/logs/` with daily rotation (14 days, 20MB max)
- Port: 3014 (configurable via `PORT`)
- Webhook URL: `TELEGRAM_WEBHOOK_URL`
