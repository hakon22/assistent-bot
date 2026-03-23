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

const MAX_ITERATIONS = 40;
const TIMEOUT_MS = 12 * 60 * 1000; // 12 минут
const REVIEW_SITES = 'otzovik.com, irecommend.ru, market.yandex.ru, dns-shop.ru, mvideo.ru, wildberries.ru, ozon.ru, drom.ru, 4pda.to';

/** Префикс служебных HumanMessage — если модель ответила без tool_calls, граф уходит в nudge. */
const TOOL_NUDGE_PREFIX = '[Система]';
const MAX_TOOL_NUDGES_PER_RUN = 8;

const getAiMessagePlainText = (message: AIMessage): string => {
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return (message.content as { type: string; text?: string; }[])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join(' ');
  }
  return '';
};

const countToolNudgesInMessages = (messages: (typeof MessagesAnnotation.State)['messages']): number =>
  messages.filter(
    (message) => message instanceof HumanMessage && typeof message.content === 'string' && message.content.startsWith(TOOL_NUDGE_PREFIX),
  ).length;

const looksLikeFinalProductComparisonAnswer = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed.length) return false;
  if (/<b>\s*вывод/i.test(trimmed)) return true;
  if (/<b>\s*сравнение/i.test(trimmed)) return true;
  if (trimmed.length >= 1200 && trimmed.includes('•') && trimmed.includes('<b>')) return true;
  if (/сравнение невозможно|не удалось\s+(собрать|найти|получить)\s+данн|отзывов\s+не\s+найден/i.test(trimmed) && trimmed.length < 900) {
    return true;
  }
  return false;
};

export interface ProductComparisonAgentInput {
  telegramId: string;
  userId: number;
  requestId: number;
  messageText: string;
  modelId?: string | null;
  onStatusUpdate?: (text: string) => Promise<void>;
}

@Singleton
export class ProductComparisonAgentService extends BaseAgentService {
  protected readonly TAG = 'ProductComparisonAgentService';

  protected readonly AGENT_NAME = 'product_comparison_agent';

  private readonly modelService = Container.get(ModelService);

  private readonly playwrightTool = Container.get(PlaywrightTool);

  private readonly yandexSearchTool = Container.get(YandexSearchTool);

  public process = async (input: ProductComparisonAgentInput): Promise<string> => {
    const { telegramId, userId, requestId, messageText, modelId, onStatusUpdate } = input;

    this.loggerService.info(this.TAG, 'Product comparison agent started', { requestId, messageText });

    const log = new WebResearchLogEntity();
    log.request = { id: requestId } as RequestEntity;
    log.user = { id: userId } as UserEntity;
    log.goal = messageText;
    log.agentName = this.AGENT_NAME;
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
      result = await Promise.race([this.runGraph(messageText, log, modelId, onStatusUpdate), timeout]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = errorMessage === 'Timeout';
      const isToolUnsupported = errorMessage.includes('tool use') || errorMessage.includes('tool_use');
      this.loggerService.error(this.TAG, isTimeout ? 'Agent timeout (12min)' : 'Agent loop failed:', error);
      if (isTimeout) {
        result = 'Сравнение заняло слишком много времени. Попробуйте уточнить запрос или уменьшить количество товаров.';
      } else if (isToolUnsupported) {
        result = 'Выбранная модель не поддерживает сравнение товаров. Переключитесь на другую модель через /model.';
      } else {
        result = 'Произошла ошибка при сравнении товаров. Попробуйте позже.';
      }
    }

    log.responseText = result;
    await log.save();

    await this.logSearch(requestId, userId, messageText);
    await this.saveHistory(telegramId, userId, requestId, messageText, result);

    this.loggerService.info(this.TAG, 'Product comparison agent completed', { requestId, iterations: log.iterations, pagesFetched: log.pagesFetched });

    return result;
  };

  private extractAgentThought = (response: AIMessage): string => {
    let raw = '';
    if (typeof response.content === 'string') {
      raw = response.content;
    } else if (Array.isArray(response.content)) {
      raw = (response.content as { type: string; text?: string; }[])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join(' ');
    }
    return raw
      .replace(/<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi, '')
      .replace(/<think(?:ing)?[\s\S]*/gi, '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 10) ?? '';
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

    if (result.filters.length) {
      parts.push('\n=== ФИЛЬТРЫ/СОРТИРОВКА ===');
      for (const filterItem of result.filters) {
        const filterOptionsText = filterItem.options?.length ? ` [${filterItem.options.slice(0, 6).join(' | ')}]` : '';
        parts.push(`• [${filterItem.type}] ${filterItem.label}${filterOptionsText} → selector: ${filterItem.selector}`);
      }
    }

    if (result.pagination.length) {
      parts.push('\n=== ПАГИНАЦИЯ ===');
      for (const paginationItem of result.pagination) {
        parts.push(`• "${paginationItem.text}"${paginationItem.href ? ` → ${paginationItem.href}` : ''}${paginationItem.selector ? ` selector: ${paginationItem.selector}` : ''}`);
      }
    }

    if (result.buttons.length) {
      parts.push('\n=== КНОПКИ ===');
      parts.push(result.buttons.map((button) => `• "${button.text}" selector: ${button.selector}`).join('\n'));
    }

    if (result.links.length) {
      parts.push('\n=== ССЫЛКИ ===');
      parts.push(result.links.map((link) => `${link.text}: ${link.href}`).join('\n'));
    }

    parts.push(
      '\n=== ФОРМЫ И ВВОД (действия browse_page.actions) ===',
      'Поля: fill_placeholder (как написано в placeholder на странице), fill_selector (#id из ФИЛЬТРОВ/разметки), fill_label (подпись рядом с полем).',
      'Списки: select_option. Флажки: set_checked. После ввода часто press_key Enter (с selector поля или без).',
      'Клики: click_selector по селекторам из КНОПОК и ФИЛЬТРОВ; открытые календари — click_text по числу или цепочка fill + Enter.',
    );

    return parts.join('\n').substring(0, 12000);
  };

  private runGraph = async (goal: string, log: WebResearchLogEntity, modelId?: string | null, onStatusUpdate?: (text: string) => Promise<void>): Promise<string> => {
    let latestScreenshot: string | null = null;

    // Персистентная сессия — cookies и JS-состояние сохраняются между вызовами browse_page
    const session = await this.playwrightTool.createSession();

    const browsePageTool = new DynamicStructuredTool({
      name: 'browse_page',
      description: 'Открыть страницу и выполнить цепочку действий в браузере: клики, заполнение форм, select/checkbox, клавиши, скролл. Возвращает контент, кнопки, фильтры с селекторами, пагинацию и скриншот.',
      schema: z.object({
        url: z.string().describe('URL страницы'),
        auto_scroll: z.boolean().optional().describe('Прокрутить страницу для lazy-загрузки (по умолчанию true)'),
        actions: z.array(z.object({
          type: z.enum([
            'click_text',
            'click_selector',
            'click_coords',
            'fill_placeholder',
            'fill_selector',
            'fill_label',
            'select_option',
            'set_checked',
            'hover',
            'press_key',
            'scroll_bottom',
            'scroll_top',
            'scroll_px',
            'wait',
          ]),
          text: z.string().optional().describe('Для click_text: текст кнопки или ссылки'),
          selector: z.string().optional().describe('Для click_selector, fill_selector, select_option, hover, press_key, set_checked: CSS-селектор'),
          placeholder: z.string().optional().describe('Для fill_placeholder: текст placeholder поля'),
          label: z.string().optional().describe('Для fill_label: подпись поля (как видит пользователь)'),
          value: z.string().optional().describe('Для fill_*, select_option: значение'),
          key: z.string().optional().describe('Для press_key: Enter, Tab, Escape, Backspace и т.д.'),
          checked: z.boolean().optional().describe('Для set_checked: true/false'),
          x: z.number().optional().describe('Для click_coords: координата X'),
          y: z.number().optional().describe('Для click_coords: координата Y'),
          pixels: z.number().optional().describe('Для scroll_px: количество пикселей'),
          milliseconds: z.number().optional().describe('Для wait: миллисекунды'),
        })).optional().describe('Цепочка действий после загрузки URL (выполняются по порядку)'),
      }),
      func: async ({ url, auto_scroll, actions }) => {
        try {
          log.pagesFetched += 1;
          log.iterations += 1;
          await log.save();

          const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();
          await onStatusUpdate?.(`Читаю: ${hostname}`).catch(() => undefined);

          const pageActions: PageAction[] = (actions ?? []).map((rawAction) => {
            switch (rawAction.type) {
            case 'click_text': return { type: 'click_text', value: rawAction.text ?? rawAction.value ?? '' };
            case 'click_selector': return { type: 'click_selector', selector: rawAction.selector ?? '' };
            case 'click_coords': return { type: 'click_coords', x: rawAction.x ?? 0, y: rawAction.y ?? 0 };
            case 'fill_placeholder': return { type: 'fill_placeholder', placeholder: rawAction.placeholder ?? rawAction.text ?? '', value: rawAction.value ?? '' };
            case 'fill_selector': return { type: 'fill_selector', selector: rawAction.selector ?? '', value: rawAction.value ?? '' };
            case 'fill_label': return { type: 'fill_label', label: rawAction.label ?? '', value: rawAction.value ?? '' };
            case 'select_option': return { type: 'select_option', selector: rawAction.selector ?? '', value: rawAction.value ?? '' };
            case 'set_checked': return { type: 'set_checked', selector: rawAction.selector ?? '', checked: rawAction.checked ?? true };
            case 'hover': return { type: 'hover', selector: rawAction.selector ?? '' };
            case 'press_key': return { type: 'press_key', key: rawAction.key ?? 'Enter', selector: rawAction.selector };
            case 'scroll_bottom': return { type: 'scroll_bottom' };
            case 'scroll_top': return { type: 'scroll_top' };
            case 'scroll_px': return { type: 'scroll_px', pixels: rawAction.pixels ?? 500 };
            case 'wait': return { type: 'wait', milliseconds: rawAction.milliseconds ?? 1000 };
            default: return { type: 'scroll_bottom' };
            }
          });

          const result = await this.playwrightTool.browseInSession(session.page, {
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
      description: 'Поиск через Яндекс. Используй для нахождения страниц с отзывами на конкретный товар.',
      schema: z.object({
        query: z.string().describe('Поисковый запрос'),
      }),
      func: async ({ query }) => {
        try {
          log.searchesDone += 1;
          log.iterations += 1;
          await log.save();

          await onStatusUpdate?.(`Ищу: ${query.substring(0, 80)}`).catch(() => undefined);

          const apiResults = await this.yandexSearchTool.search(query, 10).catch(() => []);
          if (apiResults.length) {
            const lines = apiResults.map((searchResult) => `${searchResult.title}\n${searchResult.url}\n${searchResult.snippet}`).join('\n\n');
            return `Результаты поиска по запросу «${query}»:\n\n${lines}`;
          }

          return `Поиск по запросу «${query}» не дал результатов. Попробуй изменить запрос или открыть сайт напрямую через browse_page.`;
        } catch (error) {
          return `Ошибка поиска: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    });

    const tools: StructuredToolInterface[] = [browsePageTool, searchWebTool];

    const systemPrompt = [
      'Ты — агент сравнения товаров.',
      this.buildAgentCurrentDatePromptBlock(),
      'Твоя задача: сравнить несколько товаров на основе РЕАЛЬНЫХ отзывов из интернета.',
      '',
      '## ИНСТРУМЕНТЫ',
      '',
      '### browse_page — реальный браузер Chromium',
      'Использует прокси и обход антибот-защит. В одном вызове: открыть URL и выполнить цепочку actions (клики, заполнение полей, select, чекбоксы, press_key, скролл).',
      'Возвращает текст страницы, ФИЛЬТРЫ с готовыми CSS-селекторами, кнопки, ссылки и скриншот.',
      'После каждого вызова анализируй скриншот и секции ФИЛЬТРЫ/КНОПКИ — опирайся на селекторы оттуда, не придумывай.',
      '',
      '### search_web — поиск через Яндекс',
      'Применяй для нахождения страниц с отзывами на конкретный товар.',
      '',
      '## ПРАВИЛО №1 — НЕ ПРИДУМЫВАЙ URL',
      'Допустимые URL — ТОЛЬКО из этих источников:',
      '  • секция ССЫЛКИ из browse_page',
      '  • поле url из search_web',
      'Ты НЕ знаешь реальных адресов страниц отзывов. Не конструируй пути, не угадывай.',
      'Перед включением ссылки в ответ задай себе: "Из какого именно ответа инструмента я взял этот URL?"',
      'Не можешь ответить точно → ссылку удалить.',
      '',
      '## СТРАТЕГИЯ СРАВНЕНИЯ',
      '',
      'Шаг 1: Выдели список товаров для сравнения из запроса пользователя.',
      'Шаг 2: Обработай каждый товар ПОСЛЕДОВАТЕЛЬНО — сначала полностью исследуй первый, потом второй.',
      '',
      'Для КАЖДОГО товара:',
      '  1. search_web("[название товара] отзывы") → получи список страниц с отзывами.',
      '  2. browse_page(лучший URL из приоритетных сайтов) → извлеки реальные плюсы, минусы, цитаты.',
      '  3. Прокрути вниз если отзывов мало на первом экране (scroll_bottom).',
      '  4. Если отзывов < 5 или страница недоступна → search_web("[товар] обзор недостатки плюсы") → ещё browse_page.',
      '  5. Повтори шаги 1–4 для следующего товара.',
      '',
      'Шаг 3: После сбора данных по всем товарам → сформируй итоговый сравнительный ответ.',
      '',
      '## ПРИОРИТЕТНЫЕ САЙТЫ ДЛЯ ОТЗЫВОВ',
      `${REVIEW_SITES}`,
      'Предпочитай эти сайты при выборе URL для browse_page.',
      'Яндекс.Маркет (market.yandex.ru) — ценен: оценки, блоки "Достоинства"/"Недостатки", тысячи отзывов.',
      'Отзовик (otzovik.com) и iRecommend (irecommend.ru) — развёрнутые пользовательские отзывы с секциями "Плюсы"/"Минусы".',
      'DNS (dns-shop.ru) и М.Видео (mvideo.ru) — для техники: верифицированные покупатели.',
      'Drom.ru — для автотоваров (шины, аккумуляторы, масла).',
      '4PDA (4pda.to) — для гаджетов: обсуждения и реальный опыт.',
      '',
      '## КАК ЧИТАТЬ СТРАНИЦУ ОТЗЫВОВ',
      '• На Яндекс.Маркет: ищи блоки "Достоинства" / "Недостатки" в каждом отзыве.',
      '• На Отзовик / iRecommend: ищи секции "Плюсы" и "Минусы".',
      '• Если отзывов мало — прокрути вниз через action scroll_bottom.',
      '• Если страница требует авторизации или показывает капчу — перейди к следующему сайту из search_web.',
      '',
      '## ЧТО ИЗВЛЕКАТЬ ПО КАЖДОМУ ТОВАРУ',
      '- Общая оценка (если есть числовая или звёздочная)',
      '- Топ-3 достоинства (которые встречаются в нескольких отзывах)',
      '- Топ-3 недостатка (которые встречаются в нескольких отзывах)',
      '- 1–2 характерные цитаты реальных пользователей (1–2 предложения)',
      '- Текущая цена или ценовой диапазон — ОБЯЗАТЕЛЬНО. Ищи на страницах отзывов или в поисковой выдаче.',
      '  Если на странице нет цены — выполни search_web("[товар] цена купить") и возьми из первого результата.',
      '',
      '## ВАЖНО',
      '- Используй ТОЛЬКО реальные данные из посещённых страниц. Не придумывай мнения.',
      '- Если на странице нет явных плюсов/минусов — выдели их из текста отзывов самостоятельно.',
      `- Лимит шагов: ${MAX_ITERATIONS}.`,
      '',
      '## ФОРМАТ ОТВЕТА',
      'HTML для Telegram. Только теги: <b>жирный</b>, <i>курсив</i>, <a href="URL">текст</a>.',
      'Не использовать: ** **, [ ]( ), # заголовки, --- разделители, <ul>, <li>, <br>.',
      'Используй • и символ новой строки вместо HTML-списков.',
      '',
      'Структура:',
      '<b>Сравнение: [Товар А] vs [Товар Б]</b>',
      '',
      '<b>[Товар А]</b> <i>(оценка X/5 · Источник)</i> — от [цена] ₽',
      '<b>Плюсы:</b>',
      '• [плюс из реальных отзывов]',
      '• ...',
      '<b>Минусы:</b>',
      '• [минус из реальных отзывов]',
      '<i>"цитата реального покупателя" — реальный покупатель</i>',
      '',
      '[повторить блок для каждого товара]',
      '',
      '<b>Вывод:</b>',
      '[Конкретная рекомендация: кому какой товар подходит лучше и почему]',
      '',
      'Источники: <a href="URL1">Яндекс.Маркет</a>, <a href="URL2">Отзовик</a>',
    ].join('\n');

    const model = this.modelService.getChatModel(0.3, modelId).bindTools(tools);

    const agentNode = async (state: typeof MessagesAnnotation.State) => {
      const response = await model.invoke(state.messages);
      if (onStatusUpdate && Array.isArray(response.tool_calls) && response.tool_calls.length) {
        const thought = this.extractAgentThought(response);
        if (thought) {
          await onStatusUpdate(thought.substring(0, 120)).catch(() => undefined);
        }
      }
      return { messages: [response] };
    };

    const nudgeNode = async () => ({
      messages: [
        new HumanMessage(
          `${TOOL_NUDGE_PREFIX} Ты вернул только текст без вызова инструмента. Пока сравнение не завершено — в ответе обязательно должен быть tool call ` +
            '(browse_page или search_web). Не описывай намерение («применю фильтр») — сразу вызывай инструмент. Финальный HTML пользователю — только когда есть блок «Вывод» и все товары обработаны.',
        ),
      ],
    });

    const shouldContinue = (state: typeof MessagesAnnotation.State) => {
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage instanceof AIMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length) {
        return 'tools';
      }
      if (!(lastMessage instanceof AIMessage)) {
        return END;
      }
      const finalText = getAiMessagePlainText(lastMessage);
      if (looksLikeFinalProductComparisonAnswer(finalText)) {
        return END;
      }
      if (countToolNudgesInMessages(state.messages) >= MAX_TOOL_NUDGES_PER_RUN) {
        return END;
      }
      return 'nudge';
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

        outMessages.push(new ToolMessage({ content: textResult, tool_call_id: toolCall.id ?? '' }));

        if (screenshot) {
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
      .addNode('nudge', nudgeNode)
      .addEdge('__start__', 'agent')
      .addConditionalEdges('agent', shouldContinue, { tools: 'tools', nudge: 'nudge', [END]: END })
      .addEdge('tools', 'agent')
      .addEdge('nudge', 'agent')
      .compile();

    const stripThinking = (text: string): string =>
      text
        .replace(/^[\s\S]*?<\/think(?:ing)?>/i, '')      // <think>...</think> или <thinking>...</thinking>
        .replace(/^\s*<think(?:ing)?>\s*/i, '')           // незакрытый <think> в начале
        .replace(/^\s*(thought|thinking)\s*[\n:]/i, '')  // "thought\n" / "thinking:"
        .replace(/^[\u0080-\u00FF\u0400-\u04FF\s]{0,8}(thought|thinking)\s*[\n:]/i, '')
        .replace(/^[\u0080-\u00FF]{1,6}/, '')            // мусорные байты Latin Extended
        .replace(/(\*\s*(Wait|Let['']s go|Step|Action|Thought|Note)\s*\*\s*[:：]?[^\n]*\n?)+/gi, '')
        .replace(/^[\s,]*(?:null|undefined|true|false)\s*\}?\s*/i, '') // JSON-артефакты: `, null}` после </think>
        .replace(/^\s*\}\s*\n*/g, '')                    // одиночная закрывающая скобка в начале
        .trim();

    interface ContentTextBlock {
      type: string;
      text?: string;
    }

    try {
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

      if (typeof content === 'string') {
        return stripThinking(content) || 'Сравнение завершено.';
      }
      if (Array.isArray(content)) {
        const textBlock = (content as ContentTextBlock[]).find((block) => block.type === 'text');
        return stripThinking(textBlock?.text ?? '') || 'Сравнение завершено.';
      }

      return `Достигнут лимит ${MAX_ITERATIONS} шагов. Сравнение не завершено. Попробуйте уточнить запрос.`;
    } finally {
      await this.playwrightTool.closeSession(session);
    }
  };

  private logSearch = async (requestId: number, userId: number, query: string): Promise<void> => {
    try {
      const searchRecord = new SearchHistoryEntity();
      searchRecord.request = { id: requestId } as RequestEntity;
      searchRecord.user = { id: userId } as UserEntity;
      searchRecord.queryText = query;
      searchRecord.searchEngine = 'web';
      searchRecord.agentName = this.AGENT_NAME;
      await searchRecord.save();
    } catch (error) {
      this.loggerService.warn(this.TAG, 'logSearch failed (non-critical)', error);
    }
  };
}
