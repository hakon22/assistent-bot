# Assistent Bot

Telegram-бот на TypeScript с мультиагентной архитектурой на основе LangGraph. Умеет искать вакансии на hh.ru, работать в браузере (покупки, туры, новости, любые сайты), сравнивать товары по реальным отзывам, ставить напоминания, отвечать на общие вопросы, распознавать голос и изображения, а также генерировать изображения через модели типа Flux. Отдельно от бота на том же сервере работают два навыка Яндекс Алисы: Deepseek и Gemini.

## Стек

- **Runtime:** Node.js 25, TypeScript 5.9, ESM
- **Telegram:** Telegraf 4.16
- **LLM:** LangChain + LangGraph 1.2, совместим с OpenAI API
- **БД:** PostgreSQL + TypeORM 0.3
- **Браузер:** rebrowser-playwright (Chromium) + ghost-cursor
- **Логи:** Winston + daily rotation

## Быстрый старт

```bash
# Установить зависимости
make install

# Запустить локально (режим polling)
make start-local
```

## Переменные окружения

Создай `.env` в корне проекта:

```env
# Telegram
TELEGRAM_BOT_TOKEN=          # токен бота от @BotFather
TELEGRAM_CHAT_ID=            # telegram_id первого пользователя (доступ к боту)
TELEGRAM_CHAT_ID2=           # telegram_id второго пользователя

# Прокси для Telegram (опционально, SOCKS5)
TELEGRAM_PROXY_HOST=         # host:port
TELEGRAM_PROXY_USER=
TELEGRAM_PROXY_PASS=

# LLM (OpenAI-совместимый endpoint)
LLM_BASE_URL=                # например https://routerai.ru/api/v1
LLM_API_KEY=                 # ключ API

# База данных
DB=LOCAL                     # LOCAL или HOST
DB_LOCAL=assistent_bot       # имя локальной БД
USER_DB_LOCAL=postgres       # пользователь локальной БД
PASSWORD_DB_LOCAL=           # пароль локальной БД
DB_HOST=assistent_bot        # имя БД на сервере
USER_DB_HOST=                # пользователь БД на сервере
PASSWORD_DB_HOST=            # пароль БД на сервере

# Яндекс
YANDEX_SEARCH_API_KEY=       # ключ Yandex Search API
YANDEX_SEARCH_FOLDER_ID=     # folder_id в Yandex Cloud
YANDEX_VOICE_API_KEY=        # ключ Yandex SpeechKit (STT)
ALICE_ALLOWED_YANDEX_USER_IDS= # session.user.user_id через запятую, кому доступны навыки Алисы

# Решение капчи (опционально, rucaptcha.com)
CAPTCHA_SOLVER_API_KEY=      # ключ RuCaptcha/2Captcha
CAPTCHA_SOLVER_HOST=         # хост сервиса (по умолчанию https://rucaptcha.com)

# Прочее
PORT=3014
NODE_ENV=development
```

## Миграции

```bash
# Применить миграции (dev)
npm run migration:run

# Применить миграции (prod)
npm run migration:run:prod

# Откатить последнюю миграцию
npm run migration:revert

# Создать новую миграцию
npm run migration:create:name -- --name=МоёИзменение
```

## Docker

### Разработка

```bash
docker-compose -f docker-compose.dev.yml up
```

### Продакшн

```bash
docker-compose -f docker-compose.prod.yml up
```

Продакшн-compose автоматически запускает миграции перед стартом бота.

## Структура проекта

```
src/
├── bot.ts                          # точка входа
├── alice/                          # типы, лимиты и доступ навыка Яндекс Алисы
├── db/
│   ├── entities/                   # TypeORM сущности
│   ├── migrations/                 # миграции БД
│   └── database.service.ts
├── services/
│   ├── alice/                      # диалог Алисы, доступ, фоновый ответ
│   ├── agents/
│   │   ├── manager.agent.ts            # роутер запросов
│   │   ├── general.agent.ts            # общие вопросы
│   │   ├── browser.agent.ts            # веб-браузер (покупки, поиск, сайты)
│   │   ├── job-search.agent.ts         # поиск работы (hh.ru)
│   │   ├── tours-hotels.agent.ts       # туры и отели (веб-ресёрч)
│   │   ├── product-comparison.agent.ts # сравнение товаров по отзывам
│   │   └── reminder.agent.ts           # напоминания
│   ├── telegram/
│   │   ├── telegram-bot.service.ts
│   │   ├── telegram-bot-command.service.ts
│   │   └── telegram.service.ts
│   ├── tools/
│   │   ├── playwright.tool.ts      # браузерный скрапинг + антибот-защита
│   │   ├── captcha-solver.tool.ts  # решение капчи (RuCaptcha/2Captcha)
│   │   ├── yandex-search.tool.ts   # Yandex Search API
│   │   ├── yandex-stt.tool.ts      # распознавание речи
│   │   └── hh-api.tool.ts          # HeadHunter API
│   ├── model/
│   │   └── model.service.ts        # управление LLM
│   ├── search/
│   │   └── search-cache.service.ts # кэш поисковых запросов (TTL 6ч)
│   └── error/
│       └── error-log.service.ts
└── routes/
    ├── alice/                      # POST /alice/deepseek, POST /alice/gemini
    ├── health/                     # GET /health
    └── integration/                # интеграционные эндпоинты
```

## Схема БД

PostgreSQL, схема `assistent_bot`:

| Таблица | Назначение |
|---|---|
| `user` | Пользователи бота |
| `model` | Доступные LLM-модели и цены |
| `request` | Запросы пользователей |
| `request_status` | Статусы запросов |
| `conversation_history` | История диалогов |
| `file_attachment` | Загруженные файлы |
| `job_vacancy` | Вакансии с hh.ru |
| `search_history` | История поиска |
| `search_cache` | Кэш поисковых запросов (TTL 6ч) |
| `agent_delegation_log` | Лог маршрутизации агентов |
| `web_research_log` | Лог веб-исследований |
| `error_log` | Ошибки приложения |
| `telegram_dialog_state` | Состояние диалога пользователя |

## Агенты

Менеджер-агент (`manager.agent.ts`) анализирует сообщение и маршрутизирует его к нужному агенту:

| Агент | Триггеры |
|---|---|
| `browser_agent` | поиск в интернете, покупки (WB, Ozon, AliExpress), туры, авиабилеты, отели, сравнение цен, любые действия в браузере |
| `job_search_agent` | работа, вакансия, резюме, зарплата, hh.ru |
| `tours_hotels_agent` | конкретный туристический сайт (ostrovok, 101hotel, booking) или детальный веб-ресёрч туров |
| `product_comparison_agent` | сравни, что лучше, отзывы на, плюсы и минусы, vs/versus, выбрать между двумя товарами |
| `reminder_agent` | напомни, поставь напоминание, через X минут/часов |
| `general_agent` | всё остальное |

### Генерация изображений

Если пользователь выбирает модель `black-forest-labs/flux.2-pro` через `/model`, включается специальный режим:

1. **Проверка запроса** — дефолтная модель определяет, является ли сообщение просьбой о генерации изображения.
2. **Не запрос на генерацию** — бот возвращает ошибку с объяснением и предложением сменить модель.
3. **Запрос на генерацию** — дефолтная модель переводит и детализирует промпт на английском, затем Flux генерирует изображение.

Изображения отправляются напрямую в чат:
- ≤ 10 MB → `sendPhoto` (превью в чате)
- > 10 MB → `sendDocument` (файл)

### Веб-поиск

Если к `model_id` модели добавлен суффикс `:online` (например `google/gemini-3-flash-preview:online`), включается режим нативного веб-поиска RouterAI:

1. **Маршрутизация** — запросы в интернет направляются в `general_agent`, а не в `browser_agent` (Playwright не используется).
2. **Поиск** — RouterAI автоматически активирует плагин `web` для выбранной модели.
3. **Источники** — ссылки из `url_citation` добавляются в ответ, если модель их не включила в текст.

Чтобы включить режим, добавьте `:online` к `model_id` в таблице `model` или выберите такую модель через `/model`. Подробнее: [документация RouterAI](https://routerai.ru/docs/guides/overview/plugins/web-search).

## Команды бота

| Команда | Описание |
|---|---|
| `/start` | Запуск бота |
| `/model` | Выбрать LLM-модель для общения |
| `/resume` | Загрузить резюме (PDF или ссылка) |
| `/stop` | Остановить текущий поиск |
| `/help` | Помощь |

## Яндекс Алиса

Два приватных навыка в [консоли Яндекс Диалогов](https://dialogs.yandex.ru/developer/). Тот же процесс и порт `3014`, тот же `LLM_BASE_URL` / `LLM_API_KEY`. В граф Telegram-агентов запросы не попадают.

| Как сказать | Backend URL | Модель |
|---|---|---|
| «Алиса, спроси у дипсика …» | `POST /alice/deepseek` | `~deepseek/deepseek-v4-flash-latest` |
| «Алиса, спроси у джемини …» | `POST /alice/gemini` | `~google/gemini-flash-latest` |

Пока сессия навыка открыта, следующие реплики идут в ту же модель. Обычный ответ не завершает сессию. Выход из навыка делает сама Алиса: пауза, ошибка или отказ в доступе.

Диалоги ждут ответ около 4,5 секунд. Навык ждёт модель 4 секунды. Если она не успела, Алиса просит сказать «продолжить»: ответ дописывается в памяти процесса и отдаётся следующим запросом в той же сессии. После перезапуска сервера такой незаконченный ответ пропадает.

Текст для озвучки не длиннее 1024 символов. Короткая история диалога хранится в `session_state` Яндекса (лимит 1 КБ), не в PostgreSQL.

`user_id` для `ALICE_ALLOWED_YANDEX_USER_IDS` берётся из `session.user.user_id` в логе запросов консоли. Это не Telegram id. У одного человека в навыке «дипсик» и в навыке «джемини» идентификаторы разные.

## Доступ

Бот работает только для пользователей, перечисленных в `TELEGRAM_CHAT_ID` и `TELEGRAM_CHAT_ID2`. Все остальные получают отказ.

Навыки Алисы пускают только `session.user.user_id` из `ALICE_ALLOWED_YANDEX_USER_IDS`. Пустой список закрывает навыки для всех.
