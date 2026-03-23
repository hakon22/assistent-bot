import { Container, Singleton } from 'typescript-ioc';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { Page } from 'rebrowser-playwright';

import { BaseAgentService } from '@/services/agents/base-agent.service';
import { ModelService } from '@/services/model/model.service';
import { PlaywrightTool, type BrowseResult, type PageAction } from '@/services/tools/playwright.tool';
import { YandexSearchTool, type YandexSearchResult } from '@/services/tools/yandex-search.tool';
import { SearchHistoryEntity } from '@/db/entities/search-history.entity';
import { RequestEntity } from '@/db/entities/request.entity';
import { UserEntity } from '@/db/entities/user.entity';

export interface BrowserAgentInput {
  telegramId: string;
  userId: number;
  requestId: number;
  messageText: string;
  modelId?: string | null;
  onStatusUpdate?: (text: string) => Promise<void>;
}

interface StepRecord {
  step: number;
  action: string;
  url: string;
  reasoning: string;
}

type SearchDecision =
  | { decision: 'answer'; result: string; }
  | { decision: 'browse'; url: string; reason: string; };

type BrowserAction =
  | { action: 'navigate'; url: string; reasoning: string; }
  | { action: 'click'; x: number; y: number; reasoning: string; }
  | { action: 'click_text'; text: string; reasoning: string; }
  | { action: 'click_selector'; selector: string; reasoning: string; }
  | { action: 'type'; text: string; clear?: boolean; reasoning: string; }
  | { action: 'fill_selector'; selector: string; value: string; reasoning: string; }
  | { action: 'fill_placeholder'; placeholder: string; value: string; reasoning: string; }
  | { action: 'fill_label'; label: string; value: string; reasoning: string; }
  | { action: 'select_option'; selector: string; value: string; reasoning: string; }
  | { action: 'set_checked'; selector: string; checked: boolean; reasoning: string; }
  | { action: 'hover_selector'; selector: string; reasoning: string; }
  | { action: 'press_key'; key: string; selector?: string; reasoning: string; }
  | { action: 'scroll'; direction: 'up' | 'down'; pixels?: number; reasoning: string; }
  | { action: 'wait'; milliseconds: number; reasoning: string; }
  | { action: 'done'; result: string; reasoning: string; }
  | { action: 'failed'; reason: string; reasoning: string; };

@Singleton
export class BrowserAgentService extends BaseAgentService {
  private readonly MAX_STEPS = 20;

  private readonly PRODUCT_QUERY_PATTERN = /купи|найди товар|товар|цена|акци|скидк|дешев|дорог|магазин|вайлдберис|wb|wildberries|ozon|озон|алиэкспресс|aliexpress|lamoda|сбермегамаркет|яндекс маркет|market|молоко|хлеб|мясо|телефон|ноутбук|одежда|кроссовк|кофе|чай|шампунь|корм|игрушк/i;

  protected readonly TAG = 'BrowserAgentService';

  protected readonly AGENT_NAME = 'browser_agent';

  private readonly modelService = Container.get(ModelService);

  private readonly playwrightTool = Container.get(PlaywrightTool);

  private readonly yandexSearchTool = Container.get(YandexSearchTool);

  public process = async (input: BrowserAgentInput): Promise<string> => {
    const { telegramId, userId, requestId, messageText, modelId, onStatusUpdate } = input;

    this.loggerService.info(this.TAG, 'Browser agent started', { messageText });

    // Шаг 1: пробуем ответить через Яндекс Search API без браузера
    const searchAnswer = await this.tryAnswerFromSearch(messageText, requestId, userId, modelId);
    if (searchAnswer) {
      this.loggerService.info(this.TAG, 'Answered from Yandex Search without browser');
      await this.saveHistory(telegramId, userId, requestId, messageText, searchAnswer);
      return searchAnswer;
    }

    this.loggerService.info(this.TAG, 'Yandex Search insufficient, starting browser');

    const session = await this.playwrightTool.createSession();
    const steps: StepRecord[] = [];
    let consecutiveCaptchaSteps = 0;
    const MAX_CONSECUTIVE_CAPTCHA_STEPS = 3;

    const notifyStatus = async (text: string) => {
      if (onStatusUpdate) {
        await onStatusUpdate(text).catch(() => undefined);
      }
    };

    try {
      const startUrl = await this.decideStartUrl(messageText, modelId);
      this.loggerService.info(this.TAG, 'Navigating to start URL', { startUrl });

      const startHostname = (() => {
        try {
          return new URL(startUrl).hostname;
        } catch {
          return startUrl;
        }
      })();
      await notifyStatus(`Читаю: ${startHostname}`);

      let currentResult = await this.playwrightTool.browseInSession(session.page, {
        url: startUrl,
        waitMs: 2000,
        autoScroll: false,
      });

      steps.push({ step: 0, action: `navigate:${startUrl}`, url: currentResult.finalUrl ?? startUrl, reasoning: 'Начальная навигация' });

      for (let step = 1; step <= this.MAX_STEPS; step++) {
        if (currentResult.captchaDetected) {
          consecutiveCaptchaSteps += 1;
          this.loggerService.warn(this.TAG, `Step ${step}: captcha detected (consecutive: ${consecutiveCaptchaSteps}), attempting to solve`);

          if (consecutiveCaptchaSteps > MAX_CONSECUTIVE_CAPTCHA_STEPS) {
            this.loggerService.warn(this.TAG, `Step ${step}: too many consecutive captcha steps, falling back to Google search`);
            const fallbackUrl = `https://www.google.com/search?q=${encodeURIComponent(messageText)}&hl=ru`;
            currentResult = await this.playwrightTool.browseInSession(session.page, { url: fallbackUrl, waitMs: 2000, autoScroll: false });
            consecutiveCaptchaSteps = 0;
            steps.push({ step, action: `navigate:${fallbackUrl}`, url: fallbackUrl, reasoning: 'Обход капчи — переход на Google' });
            continue;
          }

          await this.playwrightTool.solveCaptchaIfNeeded(session.page);
          await session.page.waitForTimeout(2000);
          currentResult = await this.playwrightTool.clickAndExtract(session.page, [], 2000);
        } else {
          consecutiveCaptchaSteps = 0;
        }

        const action = await this.decideNextAction(messageText, currentResult, steps, step, modelId);

        this.loggerService.info(this.TAG, `Step ${step}: ${action.action}`, {
          reasoning: action.reasoning,
          url: currentResult.finalUrl ?? currentResult.url,
        });

        if (action.reasoning) {
          await notifyStatus(action.reasoning.substring(0, 120));
        }

        steps.push({
          step,
          action: action.action,
          url: currentResult.finalUrl ?? currentResult.url,
          reasoning: action.reasoning,
        });

        if (action.action === 'done') {
          this.loggerService.info(this.TAG, 'Browser agent completed', { steps: steps.length });
          await this.logSearch(requestId, userId, messageText, currentResult.finalUrl ?? currentResult.url);
          const sanitizedResult = this.sanitizeTelegramHtml(action.result);
          await this.saveHistory(telegramId, userId, requestId, messageText, sanitizedResult);
          return sanitizedResult;
        }

        if (action.action === 'failed') {
          this.loggerService.warn(this.TAG, 'Browser agent failed', { reason: action.reason });
          return `Не удалось выполнить запрос: ${action.reason}`;
        }

        currentResult = await this.executeStep(session.page, action, currentResult);
      }

      this.loggerService.warn(this.TAG, 'Max steps reached', { steps: this.MAX_STEPS });
      return `Достиг лимита шагов (${this.MAX_STEPS}). Последняя страница: ${currentResult.finalUrl ?? currentResult.url}\n\n${currentResult.content.substring(0, 2000)}`;
    } catch (error) {
      this.loggerService.error(this.TAG, 'Browser agent error', error);
      throw error;
    } finally {
      await this.playwrightTool.closeSession(session);
    }
  };

  private isProductQuery = (goal: string): boolean => this.PRODUCT_QUERY_PATTERN.test(goal);

  private buildProductSearchQueries = async (goal: string, modelId?: string | null): Promise<string[]> => {
    try {
      const model = this.modelService.getChatModel(0.1, modelId);
      const response = await model.invoke([
        new SystemMessage([
          'Тебе дан запрос пользователя на покупку товара.',
          'Сгенерируй ровно 4 поисковых запроса для Яндекса, которые найдут КОНКРЕТНЫЕ страницы товаров с ценами (не каталоги).',
          '',
          'Правила:',
          '- Каждый запрос должен содержать конкретное название товара/бренда + маркетплейс (ozon, wildberries, megamarket, lenta, перекрёсток)',
          '- Используй реальные бренды подходящие к запросу',
          '- Включай объём/размер если применимо (1л, 930мл, 1кг и т.д.)',
          '- Добавляй слово "цена" в запрос — это заставляет Яндекс показывать сниппеты с ценами',
          '- Пример для "купить молоко до 100р":',
          '  ["Простоквашино молоко 2.5% 930мл цена купить megamarket ozon", "Домик в деревне молоко 2.5% 950г цена купить wildberries lenta", "Вкуснотеево молоко 3.2% 1л цена купить megamarket перекрёсток", "Лианозовское молоко 3.2% 950г цена купить ozon wildberries"]',
          '',
          'Ответь ТОЛЬКО валидным JSON-массивом строк: ["запрос1","запрос2","запрос3","запрос4"]',
        ].join('\n')),
        new SystemMessage(`ЗАПРОС ПОЛЬЗОВАТЕЛЯ: ${goal}`),
      ], { timeout: 20000 });

      const content = typeof response.content === 'string' ? response.content.trim() : '';
      const arrayMatch = content.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        const parsed = JSON.parse(arrayMatch[0]) as string[];
        if (Array.isArray(parsed) && parsed.length) {
          return parsed.slice(0, 4);
        }
      }
    } catch (error) {
      this.loggerService.warn(this.TAG, 'buildProductSearchQueries LLM error', error);
    }

    // Fallback: один общий запрос
    return [`${goal} купить ozon megamarket wildberries`];
  };

  private runMultipleSearches = async (queries: string[]): Promise<YandexSearchResult[]> => {
    const results = await Promise.all(
      queries.map((query) => this.yandexSearchTool.search(query, 8).catch(() => [])),
    );

    const seen = new Set<string>();
    return results.flat().filter(({ url }) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
  };

  private tryAnswerFromSearch = async (
    goal: string,
    requestId: number,
    userId: number,
    modelId?: string | null,
  ): Promise<string | null> => {
    try {
      const isProduct = this.isProductQuery(goal);

      let results: YandexSearchResult[];

      if (isProduct) {
        // Товарный запрос: генерируем точечные запросы для поиска карточек товаров
        const queries = await this.buildProductSearchQueries(goal, modelId);
        this.loggerService.info(this.TAG, 'Product search queries', { queries });
        results = await this.runMultipleSearches(queries);
      } else {
        results = await this.yandexSearchTool.search(goal, 10);
      }

      if (!results.length) return null;

      this.loggerService.debug(this.TAG, 'Yandex Search results', {
        count: results.length,
        urls: results.map(({ url }) => url),
      });

      const decision = await this.decideFromSearchResults(goal, results, isProduct, modelId);
      if (decision.decision !== 'answer') return null;

      await this.logSearch(requestId, userId, goal, results[0]?.url ?? '');
      return this.sanitizeTelegramHtml(decision.result);
    } catch (error) {
      this.loggerService.warn(this.TAG, 'tryAnswerFromSearch failed', error);
      return null;
    }
  };

  private decideFromSearchResults = async (
    goal: string,
    results: YandexSearchResult[],
    isProduct: boolean,
    modelId?: string | null,
  ): Promise<SearchDecision> => {
    const model = this.modelService.getChatModel(0.2, modelId);

    const resultsText = results
      .map(({ title, url, snippet }, index) => `${index + 1}. ${title}\nURL: ${url}\nСниппет: ${snippet}`)
      .join('\n\n');

    const productRules = isProduct
      ? [
        '',
        'ЭТО ТОВАРНЫЙ ЗАПРОС. Правила для товаров:',
        '- Ищи прямые ссылки на конкретные товары (карточки товаров на WB, Ozon, Мегамаркет, Лента, Перекрёсток, Дикси, Метро и т.д.)',
        '- URL карточки товара: wildberries.ru/catalog/ЧИСЛО, ozon.ru/product/..., megamarket.ru/catalog/details/..., market.yandex.ru/product/..., lenta.com/product/..., dixy.ru/product/..., metro-cc.ru/products/...',
        '- Также подходят небольшие магазины с конкретными страницами товаров',
        '- Результаты пришли из нескольких точечных запросов — среди них должны быть прямые страницы товаров',
        '- Если есть хотя бы 4-6 прямых ссылок на конкретные товары — всегда возвращай answer',
        '- ОБЯЗАТЕЛЬНО ищи цены в сниппетах. Цена выглядит так: "79.90 руб", "от 89₽", "цена 95 р", "89 руб/шт", "скидка 20%" и т.д.',
        '- Если в сниппете есть две цены (зачёркнутая старая и новая со скидкой) — показывай обе: "~~150 р~~ → 95 р"',
        '- Если цены нет в сниппете — просто не указывай цену для этого товара',
        '- Если все ссылки ведут только на категории/поиск — верни browse',
      ]
      : [];

    const systemPrompt = [
      'Тебе дан запрос пользователя и результаты поиска Яндекса.',
      'Реши: достаточно ли этих результатов чтобы дать точный ответ с реальными ссылками?',
      ...productRules,
      '',
      'Если ДА — верни JSON:',
      '{"decision":"answer","result":"<полный ответ пользователю с реальными ссылками из результатов поиска>"}',
      '',
      'Если нет — верни JSON:',
      '{"decision":"browse","url":"<url сайта для захода>","reason":"<причина>"}',
      '',
      'Правила для result (товарные запросы):',
      '- ТОЛЬКО реальные URL из результатов поиска — не придумывай ссылки',
      '- Формат каждой позиции:',
      '  <b>Название товара</b> — <i>цена (если есть в сниппете)</i>',
      '  • <a href="URL">Магазин</a>',
      '- Если есть скидка (старая и новая цена) — пиши: <s>старая цена</s> → <b>новая цена</b>',
      '- Группируй по товару если одна позиция продаётся в нескольких магазинах',
      '- Только теги <b>, <i>, <s>, <a href="...">, <code>. НЕ использовать <ul> <li> <br> — вместо них • и \\n',
      '- Верни ТОЛЬКО JSON, без пояснений',
    ].join('\n');

    try {
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(`ЗАПРОС: ${goal}\n\nРЕЗУЛЬТАТЫ ПОИСКА:\n${resultsText}`),
      ], { timeout: 30000 });

      const content = typeof response.content === 'string' ? response.content.trim() : '';
      this.loggerService.debug(this.TAG, 'decideFromSearchResults', { response: content.substring(0, 200) });

      const parsed = this.parseJsonResponse<SearchDecision>(this.repairJson(content));
      if (parsed?.decision) return parsed;
    } catch (error) {
      this.loggerService.warn(this.TAG, 'decideFromSearchResults LLM error', error);
    }

    return { decision: 'browse', url: '', reason: 'LLM error' };
  };

  private decideStartUrl = async (goal: string, modelId?: string | null): Promise<string> => {
    try {
      const model = this.modelService.getChatModel(0.1, modelId);
      const response = await model.invoke([
        new SystemMessage([
          'Тебе дана цель пользователя. Верни JSON с URL для начала поиска в браузере.',
          'Если указан конкретный сайт — используй его напрямую.',
          'Если пользователь ищет товар для покупки (одежда, электроника, продукты, цена, скидка, акция) — используй поиск на Wildberries: https://www.wildberries.ru/catalog/0/search.aspx?search=ЗАПРОС',
          'Если товар скорее подходит для Ozon (электроника, бытовая техника, книги) — используй: https://www.ozon.ru/search/?text=ЗАПРОС',
          'Для остального — обычный поиск Google: https://www.google.com/search?q=...&hl=ru',
          'Ответь ТОЛЬКО валидным JSON: {"url":"...","reason":"..."}',
        ].join('\n')),
        new HumanMessage(goal),
      ], { timeout: 20000 });

      const content = typeof response.content === 'string' ? response.content.trim() : '';
      const parsed = this.parseJsonResponse<{ url: string; }>(content);
      if (parsed?.url) return parsed.url;
    } catch (error) {
      this.loggerService.warn(this.TAG, 'decideStartUrl failed, using Google', error);
    }

    return `https://www.google.com/search?q=${encodeURIComponent(goal)}&hl=ru`;
  };

  private decideNextAction = async (
    goal: string,
    currentResult: BrowseResult,
    history: StepRecord[],
    stepNumber: number,
    modelId?: string | null,
  ): Promise<BrowserAction> => {
    const model = this.modelService.getChatModel(0.1, modelId);

    const historyText = history
      .slice(-8)
      .map(({ step, action, url, reasoning }) => `Шаг ${step}: [${action}] на ${url} — ${reasoning}`)
      .join('\n');

    const currentUrl = currentResult.finalUrl ?? currentResult.url;
    const contentPreview = currentResult.content.substring(0, 2000);

    // Реальные ссылки со страницы — используем в ответе вместо придуманных
    const linksText = currentResult.links.length
      ? currentResult.links
        .slice(0, 30)
        .map(({ text, href }) => `${text} → ${href}`)
        .join('\n')
      : '';

    const filtersText = currentResult.filters.length
      ? currentResult.filters
        .slice(0, 35)
        .map((filterItem) => {
          const optionsText = filterItem.options?.length ? ` [${filterItem.options.slice(0, 5).join(' | ')}]` : '';
          return `• [${filterItem.type}] ${filterItem.label}${optionsText} → ${filterItem.selector}`;
        })
        .join('\n')
      : '';

    const buttonsText = currentResult.buttons.length
      ? currentResult.buttons
        .slice(0, 40)
        .map((button) => `• "${button.text}" → ${button.selector}`)
        .join('\n')
      : '';

    this.loggerService.debug(this.TAG, `Step ${stepNumber} linksText`, {
      linksCount: currentResult.links.length,
      linksPreview: linksText.substring(0, 800),
    });

    const systemPrompt = [
      'Ты — высокоинтеллектуальный веб-агент. Ты видишь скриншот браузера и управляешь им.',
      this.buildAgentCurrentDatePromptBlock(),
      'Анализируй скриншот внимательно: определяй кнопки, поля ввода, ссылки, контент.',
      '',
      `ЦЕЛЬ ПОЛЬЗОВАТЕЛЯ: ${goal}`,
      `Текущий шаг: ${stepNumber} из ${this.MAX_STEPS}`,
      `Текущий URL: ${currentUrl}`,
      currentResult.captchaDetected ? '⚠️ ОБНАРУЖЕНА КАПЧА на странице!' : '',
      '',
      'История действий:',
      historyText || 'Начало работы',
      '',
      'Текстовое содержимое страницы (до 2000 символов):',
      contentPreview,
      '',
      linksText ? 'РЕАЛЬНЫЕ ССЫЛКИ СО СТРАНИЦЫ (используй только их — не придумывай URL):' : '',
      linksText || '',
      '',
      filtersText ? 'ФИЛЬТРЫ И ПОЛЯ ФОРМ (готовые CSS-селекторы — для select_option, set_checked, click_selector):' : '',
      filtersText || '',
      '',
      buttonsText ? 'КНОПКИ (текст → селектор для click_selector):' : '',
      buttonsText || '',
      '',
      'ДОСТУПНЫЕ ДЕЙСТВИЯ — верни ТОЛЬКО один валидный JSON:',
      '{"action":"navigate","url":"https://...","reasoning":"причина"}',
      '{"action":"click","x":123,"y":456,"reasoning":"причина"}  — клик по координатам скриншота',
      '{"action":"click_text","text":"Текст кнопки","reasoning":"причина"}  — клик по видимому тексту',
      '{"action":"click_selector","selector":"#id или CSS","reasoning":"причина"}  — клик по селектору из списка кнопок/фильтров ниже',
      '{"action":"type","text":"текст","clear":true,"reasoning":"причина"}  — ввод в УЖЕ сфокусированное поле (после клика по полю)',
      '{"action":"fill_selector","selector":"#search","value":"запрос","reasoning":"причина"}  — ввести текст в поле по CSS-селектору',
      '{"action":"fill_placeholder","placeholder":"Что ищем?","value":"текст","reasoning":"причина"}  — поле по placeholder (как на скрине)',
      '{"action":"fill_label","label":"Дата заезда","value":"01.06.2026","reasoning":"причина"}  — поле по подписи/aria-label рядом с полем',
      '{"action":"select_option","selector":"select","value":"Сначала дешёвые","reasoning":"причина"}  — выбрать опцию в выпадающем списке',
      '{"action":"set_checked","selector":"#agree","checked":true,"reasoning":"причина"}  — чекбокс/радио',
      '{"action":"hover_selector","selector":".menu","reasoning":"причина"}  — навести (открыть подменю)',
      '{"action":"press_key","key":"Enter","reasoning":"причина"}  или {"action":"press_key","key":"Enter","selector":"#q","reasoning":"..."} — клавиша глобально или внутри поля',
      '{"action":"scroll","direction":"down","pixels":500,"reasoning":"причина"}',
      '{"action":"wait","milliseconds":2000,"reasoning":"причина"}',
      '{"action":"done","result":"ответ пользователю — только теги <b>, <i>, <u>, <a href=\\"...\\">текст</a>, <code>. НЕ использовать <ul> <li> <br> <p> <div> — вместо списков используй • и \\n","reasoning":"причина"}',
      '{"action":"failed","reason":"почему невозможно выполнить","reasoning":"причина"}',
      '',
      'ФОРМЫ, ПОИСК, ФИЛЬТРЫ:',
      '- Используй селекторы из блоков «КНОПКИ» и «ФИЛЬТРЫ/СОРТИРОВКА» в тексте страницы — они проверены в DOM.',
      '- Типовая цепочка поиска: fill_placeholder или fill_selector или клик по полю (click/coords) → type с clear:true → press_key Enter.',
      '- Календари/сложные виджеты: сначала клик открыть виджет, затем click_text по дате или fill_label.',
      '- После отправки формы дождись загрузки: wait или дождись смены контента на скриншоте.',
      '',
      'Правила:',
      '- Координаты x, y — в пикселях скриншота',
      '- Когда нашёл нужную информацию — сразу возвращай done с подробным структурированным результатом',
      '- Если страница не загрузилась — используй wait или navigate снова',
      '- Не повторяй одно и то же действие более 2 раз подряд',
      '',
      'ПРАВИЛА ДЛЯ ТОВАРНЫХ ЗАПРОСОВ:',
      '- Используй ТОЛЬКО реальные ссылки из раздела "РЕАЛЬНЫЕ ССЫЛКИ СО СТРАНИЦЫ" — НИКОГДА не придумывай URL',
      '- На странице WB ссылки на товары выглядят так: /catalog/ЧИСЛО/detail.aspx — они уже есть в списке ссылок выше',
      '- На странице Ozon ссылки на товары: /product/название-ЧИСЛО/ — они уже есть в списке ссылок выше',
      '- Когда в списке ссылок есть 3+ прямых ссылок на карточки товаров с ценами в тексте страницы — возвращай done',
      '- Если текущая страница — результаты поиска WB или Ozon с товарами и ценами — НЕ кликай дальше, сразу done',
      '- НЕ придумывай ссылки — если реальных ссылок на товары нет в списке, скролл вниз или scroll для подгрузки',
    ].filter(Boolean).join('\n');

    try {
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage({
          content: [
            { type: 'text', text: 'Скриншот текущей страницы браузера:' },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${currentResult.screenshot}`,
                detail: 'high',
              },
            },
          ],
        }),
      ], { timeout: 60000 });

      const content = typeof response.content === 'string' ? response.content.trim() : '';
      this.loggerService.debug(this.TAG, `Step ${stepNumber} LLM decision`, { response: content.substring(0, 300) });

      const parsed = this.parseJsonResponse<BrowserAction>(this.repairJson(content));
      if (!parsed?.action) {
        return { action: 'failed', reason: 'LLM не вернул валидное действие', reasoning: 'parse error' };
      }

      return parsed;
    } catch (error) {
      this.loggerService.error(this.TAG, `Step ${stepNumber} LLM error`, error);
      return { action: 'failed', reason: 'LLM недоступен или timeout', reasoning: 'LLM error' };
    }
  };

  private executeStep = async (page: Page, action: BrowserAction, previousResult: BrowseResult): Promise<BrowseResult> => {
    switch (action.action) {
    case 'navigate':
      return this.playwrightTool.browseInSession(page, {
        url: action.url,
        waitMs: 2000,
        autoScroll: false,
      });

    case 'click':
      return this.playwrightTool.clickAndExtract(page, [{ type: 'click_coords', x: action.x, y: action.y }], 3000);

    case 'click_text':
      return this.playwrightTool.clickAndExtract(page, [{ type: 'click_text', value: action.text }], 3000);

    case 'click_selector':
      return this.playwrightTool.clickAndExtract(page, [{ type: 'click_selector', selector: action.selector }], 3000);

    case 'type': {
      if (action.clear) {
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Backspace');
      }
      await page.keyboard.type(action.text, { delay: 60 });
      await page.waitForTimeout(500);
      return this.playwrightTool.clickAndExtract(page, [], 1000);
    }

    case 'fill_selector':
      return this.playwrightTool.clickAndExtract(page, [{ type: 'fill_selector', selector: action.selector, value: action.value }], 2000);

    case 'fill_placeholder':
      return this.playwrightTool.clickAndExtract(page, [{ type: 'fill_placeholder', placeholder: action.placeholder, value: action.value }], 2000);

    case 'fill_label':
      return this.playwrightTool.clickAndExtract(page, [{ type: 'fill_label', label: action.label, value: action.value }], 2000);

    case 'select_option':
      return this.playwrightTool.clickAndExtract(page, [{ type: 'select_option', selector: action.selector, value: action.value }], 3000);

    case 'set_checked':
      return this.playwrightTool.clickAndExtract(page, [{ type: 'set_checked', selector: action.selector, checked: action.checked }], 2000);

    case 'hover_selector':
      return this.playwrightTool.clickAndExtract(page, [{ type: 'hover', selector: action.selector }], 1500);

    case 'press_key': {
      const pressActions: PageAction[] = action.selector
        ? [{ type: 'press_key', key: action.key, selector: action.selector }]
        : [{ type: 'press_key', key: action.key }];
      return this.playwrightTool.clickAndExtract(page, pressActions, 2000);
    }

    case 'scroll':
      return this.playwrightTool.clickAndExtract(
        page,
        [action.direction === 'down' ? { type: 'scroll_px', pixels: action.pixels ?? 500 } : { type: 'scroll_top' }],
        1000,
      );

    case 'wait':
      await page.waitForTimeout(Math.min(action.milliseconds, 10000));
      return this.playwrightTool.clickAndExtract(page, [], 1000);

    default:
      return previousResult;
    }
  };

  /**
   * Восстанавливает JSON с незакавыченными ключами.
   * LLM иногда пишет y:598 вместо "y":598.
   */
  private repairJson = (text: string): string => {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return text;
    // Добавляем кавычки вокруг незакавыченных ключей: ,key: → ,"key":
    const repaired = match[0].replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
    return text.replace(/\{[\s\S]*\}/, repaired);
  };

  /**
   * Убирает HTML-теги, которые Telegram не поддерживает.
   * Разрешены: <b>, <i>, <u>, <s>, <a href>, <code>, <pre>.
   * Заменяем: <br> → \n, <li> → • ...\n, <ul>/<ol>/<p> → удаляем теги.
   */
  private sanitizeTelegramHtml = (html: string): string => {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<p[^>]*>/gi, '')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/?(ul|ol|h[1-6]|div|span|table|tr|td|th|thead|tbody|header|footer|section|article)[^>]*>/gi, '')
      .replace(/<strong[^>]*>/gi, '<b>')
      .replace(/<\/strong>/gi, '</b>')
      .replace(/<em[^>]*>/gi, '<i>')
      .replace(/<\/em>/gi, '</i>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  private logSearch = async (requestId: number, userId: number, query: string, sourceUrl: string): Promise<void> => {
    try {
      const searchRecord = new SearchHistoryEntity();
      searchRecord.request = { id: requestId } as RequestEntity;
      searchRecord.user = { id: userId } as UserEntity;
      searchRecord.queryText = query;
      searchRecord.searchEngine = 'browser_agent';
      searchRecord.agentName = this.AGENT_NAME;
      searchRecord.sourceUrl = sourceUrl;
      await searchRecord.save();
    } catch (error) {
      this.loggerService.warn(this.TAG, 'logSearch failed (non-critical)', error);
    }
  };
}
