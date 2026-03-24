# Assistent Bot

Telegram-бот на TypeScript с мультиагентной архитектурой на основе LangGraph. Умеет искать вакансии на hh.ru, работать в браузере (покупки, туры, новости, любые сайты), сравнивать товары по реальным отзывам, ставить напоминания, отвечать на общие вопросы, распознавать голос и изображения, а также генерировать изображения через модели типа Flux.

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
├── db/
│   ├── entities/                   # TypeORM сущности
│   ├── migrations/                 # миграции БД
│   └── database.service.ts
├── services/
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

## Команды бота

| Команда | Описание |
|---|---|
| `/start` | Запуск бота |
| `/model` | Выбрать LLM-модель для общения |
| `/resume` | Загрузить резюме (PDF или ссылка) |
| `/stop` | Остановить текущий поиск |
| `/help` | Помощь |

## Доступ

Бот работает только для пользователей, перечисленных в `TELEGRAM_CHAT_ID` и `TELEGRAM_CHAT_ID2`. Все остальные получают отказ.
