import { Container, Singleton } from 'typescript-ioc';
import { chromium, type Browser, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { LoggerService } from '@/services/app/logger.service';

export interface BrowseResult {
  url: string;
  finalUrl?: string;
  title: string;
  content: string;
  /** Скриншот страницы в base64 JPEG */
  screenshot: string;
  /** Кнопки: текст + CSS-селектор для точного клика */
  buttons: { text: string; selector: string; }[];
  /** Ссылки на страницы/товары */
  links: { text: string; href: string; }[];
  /** Элементы пагинации */
  pagination: { text: string; href?: string; selector?: string; }[];
  /** Фильтры и сортировки */
  filters: { label: string; type: 'select' | 'checkbox' | 'radio' | 'button'; selector: string; options?: string[]; }[];
  /** Обнаружена ли капча */
  captchaDetected: boolean;
}

export type PageAction =
  | { type: 'click_text'; value: string }
  | { type: 'click_selector'; selector: string }
  | { type: 'click_coords'; x: number; y: number }
  | { type: 'fill_placeholder'; placeholder: string; value: string }
  | { type: 'fill_selector'; selector: string; value: string }
  | { type: 'select_option'; selector: string; value: string }
  | { type: 'hover'; selector: string }
  | { type: 'scroll_bottom' }
  | { type: 'scroll_top' }
  | { type: 'scroll_px'; px: number }
  | { type: 'wait'; ms: number };

export interface BrowseWithActionsInput {
  url: string;
  actions?: PageAction[];
  waitMs?: number;
  /** Прокрутить страницу до конца для загрузки lazy-контента (по умолчанию true) */
  autoScroll?: boolean;
}

@Singleton
export class PlaywrightTool {
  private readonly TAG = 'PlaywrightTool';

  private readonly loggerService = Container.get(LoggerService);

  private browser: Browser | null = null;

  private getBrowser = async (): Promise<Browser> => {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        headless: true,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-web-security',
          '--disable-site-isolation-trials',
          '--ignore-certificate-errors',
          '--window-size=1280,900',
        ],
      });
    }
    return this.browser;
  };

  public browseWithActions = async (input: BrowseWithActionsInput): Promise<BrowseResult> => {
    this.loggerService.info(this.TAG, `browse: ${input.url} actions=${input.actions?.length ?? 0}`);

    let context: Awaited<ReturnType<Browser['newContext']>> | null = null;
    let page: Page | null = null;

    try {
      const browser = await this.getBrowser();
      context = await browser.newContext({
        locale: 'ru-RU',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        extraHTTPHeaders: {
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        viewport: { width: 1280, height: 900 },
      });
      page = await context.newPage();

      // Расширенный stealth — имитируем реальный браузер
      await page.addInitScript(() => {
        // webdriver
        Object.defineProperty(navigator, 'webdriver', { get: () => false });

        // plugins — как в реальном Chrome
        const pluginData = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ];
        const fakePlugins = pluginData.map((p) => {
          const plugin = Object.create(Plugin.prototype);
          Object.defineProperty(plugin, 'name', { get: () => p.name });
          Object.defineProperty(plugin, 'filename', { get: () => p.filename });
          Object.defineProperty(plugin, 'description', { get: () => p.description });
          Object.defineProperty(plugin, 'length', { get: () => 0 });
          return plugin;
        });
        Object.defineProperty(navigator, 'plugins', {
          get: () => Object.assign(fakePlugins, { item: (i: number) => fakePlugins[i], namedItem: (n: string) => fakePlugins.find((p) => p.name === n) ?? null, length: fakePlugins.length }),
        });
        Object.defineProperty(navigator, 'mimeTypes', { get: () => ({ length: 0, item: () => null, namedItem: () => null }) });

        // languages
        Object.defineProperty(navigator, 'languages', { get: () => ['ru-RU', 'ru', 'en-US', 'en'] });
        Object.defineProperty(navigator, 'language', { get: () => 'ru-RU' });

        // platform
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

        // chrome runtime
        (window as any).chrome = {
          runtime: {
            id: undefined,
            connect: () => undefined,
            sendMessage: () => undefined,
            onMessage: { addListener: () => undefined },
          },
          loadTimes: () => ({}),
          csi: () => ({}),
        };

        // Canvas fingerprint noise
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(type?: string, quality?: any) {
          const ctx = this.getContext('2d');
          if (ctx) {
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            // Добавляем минимальный шум
            for (let i = 0; i < 10; i++) {
              imageData.data[i * 4] ^= 1;
            }
            ctx.putImageData(imageData, 0, 0);
          }
          return origToDataURL.call(this, type, quality);
        };

        // WebGL vendor spoof
        const origGetParam = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter: number) {
          if (parameter === 37445) return 'Intel Inc.';
          if (parameter === 37446) return 'Intel Iris OpenGL Engine';
          return origGetParam.call(this, parameter);
        };

        // Удаляем cdc_ маркеры Chrome DevTools
        Object.keys(window).filter((k) => k.startsWith('cdc_')).forEach((k) => {
          try { delete (window as any)[k]; } catch { /* ignore */ }
        });

        // Permissions API — как будто уведомления не запрошены
        if (navigator.permissions) {
          const origQuery = navigator.permissions.query.bind(navigator.permissions);
          navigator.permissions.query = (parameters: PermissionDescriptor) => {
            if (parameters.name === 'notifications') {
              return Promise.resolve({ state: 'prompt', name: 'notifications', onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false } as unknown as PermissionStatus);
            }
            return origQuery(parameters);
          };
        }
      });

      await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Ждём сетевого покоя
      try {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch { /* timeout ok */ }

      const waitMs = input.waitMs ?? 1500;
      if (waitMs > 0) {
        await page.waitForTimeout(Math.min(waitMs, 5000));
      }

      // Автоскролл для lazy-загрузки (по умолчанию включён)
      if (input.autoScroll !== false) {
        await this.autoScroll(page);
      }

      // Выполняем actions последовательно
      for (const action of input.actions ?? []) {
        await this.executeAction(page, action);
      }

      if ((input.actions?.length ?? 0) > 0) {
        try {
          await page.waitForLoadState('networkidle', { timeout: 3000 });
        } catch { /* ok */ }
        await page.waitForTimeout(1000);
      }

      await this.dismissCookieBanner(page);

      const result = await this.extractPageData(page, input.url);
      this.loggerService.info(this.TAG, `done: ${result.finalUrl} content=${result.content.length}ch filters=${result.filters.length} pagination=${result.pagination.length}`);
      return result;
    } catch (e) {
      this.loggerService.error(this.TAG, `browse failed [${input.url}]:`, e);
      throw e;
    } finally {
      await page?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
    }
  };

  /** Простой browse без actions */
  public browse = async (url: string, waitMs = 1500): Promise<BrowseResult> => {
    return this.browseWithActions({ url, waitMs });
  };

  /** Плавный скролл до конца страницы для lazy-загрузки */
  private autoScroll = async (page: Page): Promise<void> => {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let totalScrolled = 0;
        const step = 400;
        const maxScroll = 6000; // не скроллим бесконечно
        const timer = setInterval(() => {
          window.scrollBy(0, step);
          totalScrolled += step;
          if (totalScrolled >= maxScroll || totalScrolled >= document.body.scrollHeight) {
            clearInterval(timer);
            window.scrollTo(0, 0); // возвращаемся наверх
            resolve();
          }
        }, 120);
        setTimeout(() => { clearInterval(timer); resolve(); }, 4000);
      });
    });
  };

  private dismissCookieBanner = async (page: Page): Promise<void> => {
    const candidates = [
      'Согласен', 'Принять', 'Принять все', 'Принять всё', 'Принимаю',
      'Accept', 'Accept all', 'Accept All', 'Allow', 'Allow all',
      'OK', 'Ok', 'Ок', 'Ладно', 'Продолжить', 'Понятно',
      'Agree', 'I agree', 'Got it', 'Close',
    ];
    for (const text of candidates) {
      try {
        const el = page.getByRole('button', { name: text, exact: false }).first();
        if (await el.isVisible({ timeout: 300 })) {
          await el.click({ timeout: 1000 });
          await page.waitForTimeout(500);
          return;
        }
      } catch { /* не нашли — пробуем следующий */ }
    }
  };

  private executeAction = async (page: Page, action: PageAction): Promise<void> => {
    try {
      switch (action.type) {
      case 'click_coords': {
        await page.mouse.move(action.x, action.y);
        await page.waitForTimeout(200);
        await page.mouse.click(action.x, action.y);
        await page.waitForTimeout(800);
        try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch { /* ok */ }
        break;
      }
      case 'click_text': {
        const el = page.getByText(action.value, { exact: false }).first();
        await el.scrollIntoViewIfNeeded({ timeout: 3000 });
        await el.click({ timeout: 5000 });
        await page.waitForTimeout(800);
        try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch { /* ok */ }
        break;
      }
      case 'click_selector': {
        const el = page.locator(action.selector).first();
        await el.scrollIntoViewIfNeeded({ timeout: 3000 });
        await el.click({ timeout: 5000 });
        await page.waitForTimeout(800);
        try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch { /* ok */ }
        break;
      }
      case 'fill_placeholder': {
        const input = page.getByPlaceholder(action.placeholder, { exact: false }).first();
        await input.fill(action.value, { timeout: 5000 });
        await page.waitForTimeout(300);
        break;
      }
      case 'fill_selector': {
        await page.fill(action.selector, action.value, { timeout: 5000 });
        await page.waitForTimeout(300);
        break;
      }
      case 'select_option': {
        // Пробуем selectOption для <select>, иначе кликаем по тексту
        try {
          await page.selectOption(action.selector, { label: action.value }, { timeout: 3000 });
        } catch {
          await page.selectOption(action.selector, { value: action.value }, { timeout: 3000 });
        }
        await page.waitForTimeout(800);
        try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch { /* ok */ }
        break;
      }
      case 'hover': {
        const el = page.locator(action.selector).first();
        await el.scrollIntoViewIfNeeded({ timeout: 3000 });
        await el.hover({ timeout: 3000 });
        await page.waitForTimeout(500);
        break;
      }
      case 'scroll_bottom': {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(500);
        break;
      }
      case 'scroll_top': {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300);
        break;
      }
      case 'scroll_px': {
        await page.evaluate((px) => window.scrollBy(0, px), action.px);
        await page.waitForTimeout(300);
        break;
      }
      case 'wait': {
        await page.waitForTimeout(Math.min(action.ms, 10000));
        break;
      }
      }
    } catch {
      // Продолжаем даже если action не сработал
    }
  };

  private extractPageData = async (page: Page, originalUrl: string): Promise<BrowseResult> => {
    const finalUrl = page.url();
    const title = await page.title();

    // Скриншот до любых изменений DOM (иначе удаление style-тегов ломает стили)
    const screenshotBuf = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false });
    const screenshot = screenshotBuf.toString('base64');

    if (process.env.NODE_ENV !== 'production') {
      try {
        const screenshotsDir = path.join(process.cwd(), 'screenshots');
        fs.mkdirSync(screenshotsDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const safeName = (finalUrl ?? originalUrl).replace(/[^a-zA-Z0-9а-яА-Я]/g, '_').substring(0, 60);
        fs.writeFileSync(path.join(screenshotsDir, `${ts}_${safeName}.jpg`), screenshotBuf);
      } catch { /* non-critical */ }
    }

    // Основной контент
    const content = await page.evaluate(() => {
      const remove = document.querySelectorAll('nav, script, style, noscript, .ads, .advertisement, .cookie, footer, .footer, header');
      remove.forEach((el) => el.remove());
      const main = document.querySelector(
        'main, article, [role="main"], .content, #content, .main, ' +
        '.catalog, .catalog-section, .catalog-container, .products, .product-list, .product-grid, ' +
        '.items, .goods, .shop-list, #catalog, #products, .category-products, ' +
        '.page-content, .page__content, #page-content, .site-content',
      ) ?? document.body;
      return ((main as HTMLElement).innerText ?? main.textContent ?? '').replace(/\s+/g, ' ').trim().substring(0, 10000);
    });

    // Кнопки с CSS-селектором для точного повторного клика
    const buttons = await page.evaluate(() => {
      const result: { text: string; selector: string; }[] = [];
      const els = document.querySelectorAll('button, [role="button"], .btn, input[type="submit"], input[type="button"], a.button, a.btn');
      els.forEach((el, i) => {
        const text = ((el as HTMLElement).textContent ?? (el as HTMLInputElement).value ?? '').trim().replace(/\s+/g, ' ');
        if (!text || text.length > 120) return;
        // Строим простой selector
        let sel = el.tagName.toLowerCase();
        if (el.id) sel = `#${CSS.escape(el.id)}`;
        else if (el.className && typeof el.className === 'string') {
          const cls = el.className.trim().split(/\s+/)[0];
          if (cls) sel = `${el.tagName.toLowerCase()}.${CSS.escape(cls)}:nth-of-type(${i + 1})`;
        }
        result.push({ text, selector: sel });
      });
      return result.slice(0, 60);
    });

    // Ссылки
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map((anchor) => ({
          text: ((anchor as HTMLAnchorElement).textContent ?? '').trim().replace(/\s+/g, ' '),
          href: (anchor as HTMLAnchorElement).href,
        }))
        .filter((link) => link.text.length > 1 && link.text.length < 200 && link.href.startsWith('http') && !link.href.includes('javascript:'))
        .slice(0, 60);
    });

    // Пагинация — ищем типичные элементы
    const pagination = await page.evaluate(() => {
      const result: { text: string; href?: string; selector?: string; }[] = [];
      const paginationSelectors = [
        '.pagination a', '.pager a', '[class*="pagin"] a', '[class*="pager"] a',
        'nav[aria-label*="страниц"] a', 'nav[aria-label*="page"] a',
        'a[aria-label*="след"]', 'a[aria-label*="next"]',
        '.next a', '.prev a', 'a.next', 'a.prev',
        '[class*="next"]', '[class*="prev"]',
      ];
      const seen = new Set<string>();
      for (const sel of paginationSelectors) {
        document.querySelectorAll(sel).forEach((el) => {
          const a = el.tagName === 'A' ? el as HTMLAnchorElement : el.querySelector('a');
          const text = (el as HTMLElement).textContent?.trim().replace(/\s+/g, ' ') ?? '';
          const href = a?.href ?? '';
          if (!text || seen.has(text + href)) return;
          seen.add(text + href);
          result.push({ text, href: href || undefined });
        });
      }
      return result.slice(0, 20);
    });

    // Фильтры и сортировки
    const filters = await page.evaluate(() => {
      const result: { label: string; type: 'select' | 'checkbox' | 'radio' | 'button'; selector: string; options?: string[]; }[] = [];

      // <select> элементы (сортировка, категории)
      document.querySelectorAll('select').forEach((sel, i) => {
        const label = sel.getAttribute('aria-label')
          ?? sel.getAttribute('name')
          ?? sel.id
          ?? sel.closest('label')?.textContent?.trim()
          ?? `select-${i}`;
        const options = Array.from(sel.options).map((opt) => opt.text.trim()).filter(Boolean);
        const selector = sel.id ? `#${CSS.escape(sel.id)}` : `select:nth-of-type(${i + 1})`;
        result.push({ label: label.trim(), type: 'select', selector, options });
      });

      // Фильтры-чекбоксы
      document.querySelectorAll('input[type="checkbox"]').forEach((el, i) => {
        const label = document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()
          ?? el.closest('label')?.textContent?.trim()
          ?? el.getAttribute('name')
          ?? `checkbox-${i}`;
        if (!label || label.length > 100) return;
        const selector = el.id ? `#${CSS.escape(el.id)}` : `input[type="checkbox"]:nth-of-type(${i + 1})`;
        result.push({ label: label.trim(), type: 'checkbox', selector });
      });

      // Radio-фильтры
      document.querySelectorAll('input[type="radio"]').forEach((el, i) => {
        const label = document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()
          ?? el.closest('label')?.textContent?.trim()
          ?? el.getAttribute('name')
          ?? `radio-${i}`;
        if (!label || label.length > 100) return;
        const selector = el.id ? `#${CSS.escape(el.id)}` : `input[type="radio"]:nth-of-type(${i + 1})`;
        result.push({ label: label.trim(), type: 'radio', selector });
      });

      return result.slice(0, 40);
    });

    // Детектирование капчи
    const captchaDetected = await page.evaluate(() => {
      const html = document.documentElement.innerHTML.toLowerCase();
      const captchaSelectors = [
        'iframe[src*="recaptcha"]', 'iframe[src*="captcha"]',
        'iframe[src*="turnstile"]', 'iframe[src*="hcaptcha"]',
        '.g-recaptcha', '#captcha', '.captcha', '[class*="captcha"]',
        '[id*="captcha"]', 'yandex-captcha', '.smartcaptcha',
      ];
      const hasSelector = captchaSelectors.some((sel) => !!document.querySelector(sel));
      const hasText = [
        'captcha', 'recaptcha', 'hcaptcha',
        'i am not a robot', 'я не робот', 'подтвердите', 'verify you are human',
        'проверяем браузер', 'checking your browser', 'access denied',
        'cloudflare', 'cf-challenge', 'please wait', 'ddos-guard',
      ].some((t) => html.includes(t));
      return hasSelector || hasText;
    });

    return { url: originalUrl, finalUrl, title, content, screenshot, buttons, links, pagination, filters, captchaDetected };
  };

  public close = async (): Promise<void> => {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  };
}
