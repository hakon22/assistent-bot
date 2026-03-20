import { Container, Singleton } from 'typescript-ioc';
import { StateGraph, MessagesAnnotation, END } from '@langchain/langgraph';
import { SystemMessage, HumanMessage, ToolMessage, AIMessage } from '@langchain/core/messages';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

import { BaseAgentService } from '@/services/agents/base-agent.service';
import { ModelService } from '@/services/model/model.service';
import { PlaywrightTool, type PageAction } from '@/services/tools/playwright.tool';
import { YandexSearchTool } from '@/services/tools/yandex-search.tool';
import { RequestEntity } from '@/db/entities/request.entity';
import { WebResearchLogEntity } from '@/db/entities/web-research-log.entity';
import { SearchHistoryEntity } from '@/db/entities/search-history.entity';
import { UserEntity } from '@/db/entities/user.entity';

const MAX_ITERATIONS = 30;
const TIMEOUT_MS = 10 * 60 * 1000; // 10 минут
const PREFERRED_HOTELS = 'ostrovok.ru,101hotel.ru';

export interface ToursHotelsAgentInput {
  telegramId: string;
  userId: number;
  requestId: number;
  messageText: string;
  modelId?: string | null;
}

@Singleton
export class ToursHotelsAgentService extends BaseAgentService {
  protected readonly TAG = 'ToursHotelsAgentService';

  protected readonly AGENT_NAME = 'tours_hotels_agent';

  private readonly modelService = Container.get(ModelService);

  private readonly playwrightTool = Container.get(PlaywrightTool);

  private readonly yandexSearchTool = Container.get(YandexSearchTool);

  public process = async (input: ToursHotelsAgentInput): Promise<string> => {
    const { telegramId, userId, requestId, messageText, modelId } = input;

    const log = new WebResearchLogEntity();
    log.request = { id: requestId } as RequestEntity;
    log.user = { id: userId } as UserEntity;
    log.goal = messageText;
    log.iterations = 0;
    log.pagesFetched = 0;
    log.searchesDone = 0;
    log.results = [];
    await log.save();

    let result: string;
    try {
      const timeout = new Promise<string>((_resolve, reject) =>
        setTimeout(() => reject(new Error('Timeout')), TIMEOUT_MS),
      );
      result = await Promise.race([this.runGraph(messageText, log, modelId), timeout]);
    } catch (error) {
      const isTimeout = error instanceof Error && error.message === 'Timeout';
      this.loggerService.error(this.TAG, isTimeout ? 'Agent timeout (10min)' : 'Agent loop failed:', error);
      result = isTimeout
        ? 'Поиск занял слишком много времени. Попробуйте уточнить запрос.'
        : 'Произошла ошибка при поиске. Попробуйте позже.';
    }

    log.responseText = result;
    await log.save();

    await this.logSearch(requestId, userId, messageText);
    await this.saveHistory(telegramId, userId, requestId, messageText, result);

    return result;
  };

  private formatPageResult = (url: string, result: Awaited<ReturnType<PlaywrightTool['browse']>>): string => {
    if (result.captchaDetected) {
      return `⚠️ КАПЧА ОБНАРУЖЕНА на ${result.finalUrl ?? url}. Прямой доступ заблокирован. Используй search_web для поиска через Яндекс вместо прямого открытия этого сайта.`;
    }

    const parts: string[] = [
      `Страница: ${result.finalUrl ?? url}`,
      `Заголовок: ${result.title}`,
      '',
      result.content || '(контент не извлечён)',
    ];

    if (result.filters.length > 0) {
      parts.push('\n=== ФИЛЬТРЫ/СОРТИРОВКА ===');
      for (const filterItem of result.filters) {
        const filterOptionsText = filterItem.options?.length ? ` [${filterItem.options.slice(0, 6).join(' | ')}]` : '';
        parts.push(`• [${filterItem.type}] ${filterItem.label}${filterOptionsText} → selector: ${filterItem.selector}`);
      }
    }

    if (result.pagination.length > 0) {
      parts.push('\n=== ПАГИНАЦИЯ ===');
      for (const paginationItem of result.pagination) {
        parts.push(`• "${paginationItem.text}"${paginationItem.href ? ` → ${paginationItem.href}` : ''}${paginationItem.selector ? ` selector: ${paginationItem.selector}` : ''}`);
      }
    }

    if (result.buttons.length > 0) {
      parts.push('\n=== КНОПКИ ===');
      parts.push(result.buttons.map((button) => `• "${button.text}" selector: ${button.selector}`).join('\n'));
    }

    if (result.links.length > 0) {
      parts.push('\n=== ССЫЛКИ ===');
      parts.push(result.links.map((link) => `${link.text}: ${link.href}`).join('\n'));
    }

    return parts.join('\n').substring(0, 12000);
  };

  private runGraph = async (goal: string, log: WebResearchLogEntity, modelId?: string | null): Promise<string> => {
    // Скриншот последней открытой страницы — передаётся в toolsNode как изображение
    let latestScreenshot: string | null = null;

    const browsePageTool = new DynamicStructuredTool({
      name: 'browse_page',
      description: 'Открыть страницу и/или выполнить действия на ней (клики, скролл, фильтры, пагинация). Возвращает контент, кнопки с селекторами, фильтры и пагинацию.',
      schema: z.object({
        url: z.string().describe('URL страницы'),
        auto_scroll: z.boolean().optional().describe('Прокрутить страницу для lazy-загрузки (по умолчанию true)'),
        actions: z.array(z.object({
          type: z.enum([
            'click_text',       // кликнуть по тексту → нужен: text
            'click_selector',   // кликнуть по CSS-селектору → нужен: selector
            'click_coords',     // кликнуть по координатам на скриншоте → нужны: x, y
            'fill_placeholder', // заполнить поле по placeholder → нужны: placeholder, value
            'fill_selector',    // заполнить поле по CSS-селектору → нужны: selector, value
            'select_option',    // выбрать опцию в <select> → нужны: selector, value
            'hover',            // навести курсор → нужен: selector
            'scroll_bottom',    // прокрутить вниз
            'scroll_top',       // прокрутить вверх
            'scroll_px',        // прокрутить на px пикселей → нужен: px
            'wait',             // подождать ms миллисекунд → нужен: ms
          ]),
          text: z.string().optional().describe('Для click_text: текст кнопки или ссылки'),
          selector: z.string().optional().describe('Для click_selector / fill_selector / select_option / hover: CSS-селектор'),
          placeholder: z.string().optional().describe('Для fill_placeholder: текст placeholder поля'),
          value: z.string().optional().describe('Для fill_* и select_option: вводимое значение или текст опции'),
          x: z.number().optional().describe('Для click_coords: координата X на скриншоте'),
          y: z.number().optional().describe('Для click_coords: координата Y на скриншоте'),
          px: z.number().optional().describe('Для scroll_px: количество пикселей'),
          ms: z.number().optional().describe('Для wait: миллисекунды'),
        })).optional().describe('Действия после загрузки страницы'),
      }),
      func: async ({ url, auto_scroll, actions }) => {
        try {
          log.pagesFetched += 1;
          log.iterations += 1;
          await log.save();

          // Нормализуем плоские action-объекты в типизированные PageAction
          const pageActions: PageAction[] = (actions ?? []).map((rawAction) => {
            switch (rawAction.type) {
            case 'click_text': return { type: 'click_text', value: rawAction.text ?? rawAction.value ?? '' };
            case 'click_selector': return { type: 'click_selector', selector: rawAction.selector ?? '' };
            case 'click_coords': return { type: 'click_coords', x: rawAction.x ?? 0, y: rawAction.y ?? 0 };
            case 'fill_placeholder': return { type: 'fill_placeholder', placeholder: rawAction.placeholder ?? rawAction.text ?? '', value: rawAction.value ?? '' };
            case 'fill_selector': return { type: 'fill_selector', selector: rawAction.selector ?? '', value: rawAction.value ?? '' };
            case 'select_option': return { type: 'select_option', selector: rawAction.selector ?? '', value: rawAction.value ?? '' };
            case 'hover': return { type: 'hover', selector: rawAction.selector ?? '' };
            case 'scroll_bottom': return { type: 'scroll_bottom' };
            case 'scroll_top': return { type: 'scroll_top' };
            case 'scroll_px': return { type: 'scroll_px', px: rawAction.px ?? 500 };
            case 'wait': return { type: 'wait', ms: rawAction.ms ?? 1000 };
            default: return { type: 'scroll_bottom' };
            }
          });

          const result = await this.playwrightTool.browseWithActions({
            url,
            actions: pageActions,
            autoScroll: auto_scroll !== false,
          });

          latestScreenshot = result.screenshot;
          return this.formatPageResult(url, result);
        } catch (error) {
          return `Ошибка при открытии страницы ${url}: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    });

    const searchWebTool = new DynamicStructuredTool({
      name: 'search_web',
      description: 'Поиск через Яндекс. Используй когда нужно найти сайт или прямой доступ не работает.',
      schema: z.object({
        query: z.string().describe('Поисковый запрос'),
      }),
      func: async ({ query }) => {
        try {
          log.searchesDone += 1;
          log.iterations += 1;
          await log.save();

          // Yandex Search API (с кэшированием)
          const apiResults = await this.yandexSearchTool.search(query, 10).catch(() => []);
          if (apiResults.length > 0) {
            const lines = apiResults.map((searchResult) => `${searchResult.title}\n${searchResult.url}\n${searchResult.snippet}`).join('\n\n');
            return `Результаты поиска по запросу «${query}»:\n\n${lines}`;
          }

          return `Поиск по запросу «${query}» не дал результатов. Попробуй открыть целевой сайт напрямую через browse_page.`;
        } catch (error) {
          return `Ошибка поиска: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    });

    const tools: StructuredToolInterface[] = [browsePageTool, searchWebTool];

    const systemPrompt = [
      'Ты визуальный веб-агент. После каждого вызова browse_page ты получаешь СКРИНШОТ страницы — смотри на него и принимай решения как человек.',
      `Текущая дата: ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
      '',
      '## ФОРМАТ ОТВЕТА',
      'Итоговый ответ пиши в формате HTML для Telegram. Только эти теги:',
      '  <b>жирный</b>  — для названий товаров, цен, заголовков',
      '  <a href="URL">текст</a>  — для ссылок (НЕ используй markdown [текст](url))',
      '  <i>курсив</i>  — для второстепенной информации',
      'Не используй: ** ... ** , [ ]( ) , # заголовки, --- разделители.',
      '',
      '## ГЛАВНАЯ ЦЕЛЬ',
      'Найти ПРЯМЫЕ ссылки на конкретные товары/отели/услуги.',
      'Ссылка на страницу поиска или каталога — НЕ является результатом.',
      '',
      '## ЧТО СЧИТАЕТСЯ ПРАВИЛЬНОЙ ССЫЛКОЙ',
      '✅ ПРАВИЛЬНО — прямая ссылка на конкретный отель/товар:',
      '   https://ostrovok.ru/hotel/russia/gelendzhik/mid9141845/hotel_oscar_gelendzhik/',
      '   https://amchokers.ru/product/kristalnyj-ruchej',
      '❌ НЕПРАВИЛЬНО — страница поиска, каталога, общего раздела:',
      '   https://ostrovok.ru/hotel/russia/gelendzhik/?dates=05.04.2026',
      '   https://amchokers.ru/catalog/',
      '',
      '## ПРАВИЛА',
      '1. URL — ТОЛЬКО из результатов browse_page или search_web в этом диалоге. НИКОГДА не придумывай URL из памяти или тренировочных данных.',
      '   Ты не знаешь реальных URL товаров на mvideo.ru, wildberries.ru и других сайтах — не угадывай.',
      '   Если URL не появился в секции ССЫЛКИ одного из вызовов инструментов — его НЕ СУЩЕСТВУЕТ для тебя.',
      '2. Если прямое открытие сайта вернуло ошибку, пустой контент или скриншот содержит "Проверяем браузер" / "Подтвердите, что вы не робот" / "Access Denied" — сайт заблокировал бота. НЕ пробуй открывать его снова. Сразу используй search_web.',
      '3. Если ответ содержит "КАПЧА ОБНАРУЖЕНА" — не пробуй открывать тот же сайт снова. Используй search_web.',
      '5. Cookie-баннеры ("Согласен", "Принять", "Accept") закрываются автоматически. Если баннер всё ещё виден на скриншоте — игнорируй его и работай с контентом под ним. НЕ пытайся кликнуть по нему повторно.',
      '4. ФИНИШ ТОЛЬКО когда: у каждого найденного отеля/товара есть прямая ссылка, взятая из инструментов.',
      '   ПЕРЕД ОТВЕТОМ: пройдись по каждой ссылке — видел ли ты её в секции ССЫЛКИ browse_page/search_web? Нет → не включай.',
      '',
      '## КАК РАБОТАТЬ СО СКРИНШОТОМ',
      'После каждого browse_page ты видишь скриншот страницы (1280×900px).',
      'Смотри на скриншот и определяй:',
      '- Где находятся кнопки, фильтры, поля ввода',
      '- Есть ли сортировка по цене',
      '- Какие товары/отели видны и их цены',
      '- Есть ли пагинация',
      '',
      'Как кликать по элементам на скриншоте:',
      '- По тексту: actions=[{type:"click_text", text:"Сортировка"}]',
      '- По координатам: actions=[{type:"click_coords", x:350, y:220}] — x,y в пикселях от левого верхнего угла',
      '- Координаты берёшь из скриншота: оцени где находится кнопка/ссылка визуально',
      '',
      '## КАК ЛИСТАТЬ СТРАНИЦЫ',
      'Если на скриншоте видна кнопка "Следующая" / "→" / номера страниц:',
      '- Кликни по ней: actions=[{type:"click_text", text:"Следующая"}]',
      '- Или по координатам если текст не работает: actions=[{type:"click_coords", x:..., y:...}]',
      'Если в секции ПАГИНАЦИЯ есть href — открой его: browse_page(url=href).',
      '',
      '## КАК ПРИМЕНЯТЬ ФИЛЬТРЫ',
      'ОБЯЗАТЕЛЬНО применяй фильтры/сортировку ДО сбора результатов.',
      'Смотри на скриншот — ищи панель фильтров, сортировку, чекбоксы.',
      'Для выпадающего <select>: actions=[{type:"select_option", selector:"...", value:"По цене"}]',
      'Для кнопки: actions=[{type:"click_text", text:"По возрастанию цены"}]',
      'Для клика по видимому элементу: actions=[{type:"click_coords", x:..., y:...}]',
      '',
      '## СТРАТЕГИЯ (строго соблюдать порядок)',
      '1. Открой сайт → посмотри скриншот → примени фильтры/сортировку по цене.',
      '2. Смотри список результатов — в секции ССЫЛКИ найди href конкретных товаров/отелей (содержат название или ID объекта в URL).',
      '3. КЛИКНИ по каждому интересному отелю/товару (или открой его href) → получи прямой URL его страницы.',
      '4. Только когда у каждого результата есть прямая ссылка — верни итоговый ответ.',
      '',
      `Предпочитаемые сайты отелей: ${PREFERRED_HOTELS}`,
      `Лимит шагов: ${MAX_ITERATIONS}`,
    ].join('\n');

    const model = this.modelService.getChatModel(0.3, modelId).bindTools(tools);

    const agentNode = async (state: typeof MessagesAnnotation.State) => {
      const response = await model.invoke(state.messages);
      return { messages: [response] };
    };

    const shouldContinue = (state: typeof MessagesAnnotation.State) => {
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage instanceof AIMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length) {
        return 'tools';
      }
      return END;
    };

    const toolsNode = async (state: typeof MessagesAnnotation.State) => {
      const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
      const outMessages: (ToolMessage | HumanMessage)[] = [];

      for (const toolCall of lastMessage.tool_calls ?? []) {
        const registeredTool = tools.find((candidateTool) => candidateTool.name === toolCall.name);

        if (!registeredTool) {
          outMessages.push(new ToolMessage({ content: `Инструмент ${toolCall.name} не найден.`, tool_call_id: toolCall.id ?? '' }));
          continue;
        }

        const textResult = String(await registeredTool.invoke(toolCall.args));
        const screenshot = toolCall.name === 'browse_page' ? latestScreenshot : null;
        latestScreenshot = null;

        // ToolMessage содержит только текст (image_url в role:tool не поддерживается OpenAI-форматом)
        outMessages.push(new ToolMessage({ content: textResult, tool_call_id: toolCall.id ?? '' }));

        if (screenshot) {
          // Скриншот передаём отдельным HumanMessage — только так vision-модели его видят
          outMessages.push(new HumanMessage({
            content: [
              { type: 'text', text: 'Скриншот страницы после выполнения browse_page:' },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshot}` } },
            ] as any,
          }));
        }
      }

      return { messages: outMessages };
    };

    const graph = new StateGraph(MessagesAnnotation)
      .addNode('agent', agentNode)
      .addNode('tools', toolsNode)
      .addEdge('__start__', 'agent')
      .addConditionalEdges('agent', shouldContinue, { tools: 'tools', [END]: END })
      .addEdge('tools', 'agent')
      .compile();

    const finalState = await graph.invoke(
      {
        messages: [
          new SystemMessage(systemPrompt),
          new HumanMessage(goal),
        ],
      },
      { recursionLimit: MAX_ITERATIONS * 2 + 5 },
    );

    const lastMessage = finalState.messages[finalState.messages.length - 1];
    const content = lastMessage?.content;

    const stripThinking = (text: string): string =>
      text
        .replace(/^[\s\S]*?<\/think(?:ing)?>/i, '')      // <think>...</think> или <thinking>...</thinking>
        .replace(/^\s*<think(?:ing)?>\s*/i, '')           // незакрытый <think> в начале
        .replace(/^\s*(thought|thinking)\s*[\n:]/i, '')  // "thought\n" / "thinking:"
        .replace(/^[\u0080-\u00FF\u0400-\u04FF\s]{0,8}(thought|thinking)\s*[\n:]/i, '') // мусор + thought
        .replace(/^[\u0080-\u00FF]{1,6}/, '')            // 1-6 байт Latin Extended без слова
        .replace(/(\*\s*(Wait|Let['']s go|Step|Action|Thought|Note)\s*\*\s*[:：]?[^\n]*\n?)+/gi, '') // *Wait*: ... *Let's go*
        .trim();

    interface ContentTextBlock {
      type: string;
      text?: string;
    }

    if (typeof content === 'string') {
      return stripThinking(content) || 'Поиск завершён.';
    }
    if (Array.isArray(content)) {
      const textBlock = (content as ContentTextBlock[]).find((block) => block.type === 'text');
      return stripThinking(textBlock?.text ?? '') || 'Поиск завершён.';
    }

    return `Достигнут лимит ${MAX_ITERATIONS} шагов. Поиск не завершён. Попробуйте уточнить запрос.`;
  };

  private logSearch = async (requestId: number, userId: number, query: string): Promise<void> => {
    try {
      const searchRecord = new SearchHistoryEntity();
      searchRecord.request = { id: requestId } as RequestEntity;
      searchRecord.user = { id: userId } as UserEntity;
      searchRecord.queryText = query;
      searchRecord.searchEngine = 'web';
      searchRecord.agentName = 'tours_hotels_agent';
      await searchRecord.save();
    } catch { /* non-critical */ }
  };

}
