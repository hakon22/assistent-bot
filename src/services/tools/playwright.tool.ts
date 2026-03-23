import { Container, Singleton } from 'typescript-ioc';
import { chromium as rebrowserChromium } from 'rebrowser-playwright';
import { createCursor } from 'ghost-cursor';
import type { Browser, Page, BrowserContext } from 'rebrowser-playwright';
import * as fs from 'fs';
import * as path from 'path';
import { isNil } from 'lodash-es';

import { LoggerService } from '@/services/app/logger.service';
import { CaptchaSolverTool, type CaptchaType } from '@/services/tools/captcha-solver.tool';

// rebrowser-playwright патчит CDP-протокол скрывая автоматизацию на сетевом уровне
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
  | { type: 'fill_label'; label: string; value: string }
  | { type: 'select_option'; selector: string; value: string }
  | { type: 'set_checked'; selector: string; checked: boolean }
  | { type: 'hover'; selector: string }
  | { type: 'scroll_bottom' }
  | { type: 'scroll_top' }
  | { type: 'scroll_px'; pixels: number }
  | { type: 'press_key'; key: string; selector?: string }
  | { type: 'wait'; milliseconds: number };

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

  private readonly captchaSolverTool = Container.get(CaptchaSolverTool);

  private browser: Browser | null = null;

  public getBrowser = async (): Promise<Browser> => {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await rebrowserChromium.launch({
        headless: true,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-extensions',
          '--disable-default-apps',
          '--disable-session-crashed-bubble',
          '--enable-webgl',
          '--use-gl=swiftshader',
          '--enable-accelerated-2d-canvas',
          '--lang=ru-RU',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
      });
    }
    return this.browser;
  };

  public browseWithActions = async (input: BrowseWithActionsInput): Promise<BrowseResult> => {
    this.loggerService.info(this.TAG, `browse: ${input.url} actions=${input.actions?.length ?? 0}`);

    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      const browser = await this.getBrowser();
      context = await this.createContext(browser);
      page = await context.newPage();

      const cdpSession = await context.newCDPSession(page);
      await cdpSession.send('Network.clearBrowserCookies');
      await cdpSession.send('Network.clearBrowserCache');
      await cdpSession.detach();

      await this.applyStealthScripts(page);
      await this.navigateAndWait(page, input);

      const result = await this.extractPageData(page, input.url);
      this.loggerService.info(this.TAG, `done: ${result.finalUrl} content=${result.content.length}ch filters=${result.filters.length} pagination=${result.pagination.length}`);
      return result;
    } catch (error) {
      this.loggerService.error(this.TAG, `browse failed [${input.url}]:`, error);
      throw error;
    } finally {
      await page?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
    }
  };

  /** Простой browse без actions */
  public browse = async (url: string, waitMs = 1500): Promise<BrowseResult> => {
    return this.browseWithActions({ url, waitMs });
  };

  /**
   * Создаёт персистентную сессию браузера (контекст + страница).
   * Используется визуальными агентами для переиспользования cookies между шагами —
   * сайт не видит "нового пользователя" на каждом шаге и не ставит повторные JS-challenge.
   * Вызывающий код обязан закрыть сессию через closeSession() после завершения.
   */
  public createSession = async (): Promise<{ context: BrowserContext; page: Page; }> => {
    const browser = await this.getBrowser();
    const context = await this.createContext(browser);
    const page = await context.newPage();
    await this.applyStealthScripts(page);
    return { context, page };
  };

  /** Закрывает сессию, созданную через createSession() */
  public closeSession = async ({ context, page }: { context: BrowserContext; page: Page; }): Promise<void> => {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  };

  /**
   * Выполняет действия на ТЕКУЩЕЙ странице без перенавигации и возвращает данные.
   * Используется когда страница уже загружена и нужно только кликнуть/подождать.
   */
  public clickAndExtract = async (page: Page, actions: PageAction[], waitMs = 3000): Promise<BrowseResult> => {
    const currentUrl = page.url();
    this.loggerService.info(this.TAG, `clickAndExtract: ${actions.length} actions on ${currentUrl}`);

    for (const action of actions) {
      await this.executeAction(page, action);
    }

    try {
      await page.waitForLoadState('networkidle', { timeout: waitMs });
    } catch { /* ok */ }

    await this.dismissCookieBanner(page);

    return this.extractPageData(page, currentUrl);
  };

  /**
   * Навигация и извлечение данных в рамках существующей сессии.
   * В отличие от browseWithActions, не создаёт новый контекст —
   * cookies и сессионное состояние сохраняются между вызовами.
   */
  public browseInSession = async (page: Page, input: BrowseWithActionsInput): Promise<BrowseResult> => {
    this.loggerService.info(this.TAG, `browseInSession: ${input.url} actions=${input.actions?.length ?? 0}`);
    await this.navigateAndWait(page, input);
    const result = await this.extractPageData(page, input.url);
    this.loggerService.info(this.TAG, `browseInSession done: ${result.finalUrl} content=${result.content.length}ch`);
    return result;
  };

  public close = async (): Promise<void> => {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  };

  /** Создаёт браузерный контекст с полными настройками (UA, геолокация, прокси) */
  private createContext = async (browser: Browser): Promise<BrowserContext> => {
    const viewport = this.randomViewport();
    return browser.newContext({
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow',
      colorScheme: 'light',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
      },
      viewport,
      geolocation: { latitude: 55.7558, longitude: 37.6176 },
      permissions: ['geolocation'],
    });
  };

  /** Применяет расширенные stealth-скрипты для имитации реального браузера */
  private applyStealthScripts = async (page: Page): Promise<void> => {
    await page.addInitScript(() => {
      // webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => false });

      // plugins — как в реальном Chrome
      const pluginData = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ];
      const fakePlugins = pluginData.map((pluginInfo) => {
        const plugin = Object.create(Plugin.prototype);
        Object.defineProperty(plugin, 'name', { get: () => pluginInfo.name });
        Object.defineProperty(plugin, 'filename', { get: () => pluginInfo.filename });
        Object.defineProperty(plugin, 'description', { get: () => pluginInfo.description });
        Object.defineProperty(plugin, 'length', { get: () => 0 });
        return plugin;
      });
      Object.defineProperty(navigator, 'plugins', {
        get: () => Object.assign(fakePlugins, { item: (pluginIndex: number) => fakePlugins[pluginIndex], namedItem: (pluginName: string) => fakePlugins.find((plugin) => plugin.name === pluginName) ?? null, length: fakePlugins.length }),
      });

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
      HTMLCanvasElement.prototype.toDataURL = function(type?: string, quality?: number) {
        const canvasContext = this.getContext('2d');
        if (canvasContext) {
          const imageData = canvasContext.getImageData(0, 0, this.width, this.height);
          for (let pixelIndex = 0; pixelIndex < 10; pixelIndex++) {
            imageData.data[pixelIndex * 4] ^= 1;
          }
          canvasContext.putImageData(imageData, 0, 0);
        }
        return origToDataURL.call(this, type, quality);
      };

      // WebGL vendor spoof (WebGL1 + WebGL2)
      const origGetParam = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter: number) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return origGetParam.call(this, parameter);
      };
      if (typeof WebGL2RenderingContext !== 'undefined') {
        const origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function(parameter: number) {
          if (parameter === 37445) return 'Intel Inc.';
          if (parameter === 37446) return 'Intel Iris OpenGL Engine';
          return origGetParam2.call(this, parameter);
        };
      }

      // AudioContext fingerprint noise
      if (typeof AudioBuffer !== 'undefined') {
        const origGetChannelData = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function(channel: number) {
          const array = origGetChannelData.call(this, channel);
          for (let audioIndex = 0; audioIndex < array.length; audioIndex += 100) {
            array[audioIndex] += Math.random() * 0.0000001;
          }
          return array;
        };
      }

      // WebRTC — блокируем утечку реального IP через ICE кандидаты
      if (typeof RTCPeerConnection !== 'undefined') {
        const OrigRTC = RTCPeerConnection;
        (window as any).RTCPeerConnection = function(config: any) {
          if (config?.iceServers) {
            config.iceTransportPolicy = 'relay';
          }
          return new OrigRTC(config);
        };
        Object.assign((window as any).RTCPeerConnection, OrigRTC);
      }

      // getImageData noise
      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function(sx: number, sy: number, sw: number, sh: number, settings?: ImageDataSettings) {
        const imageData = origGetImageData.call(this, sx, sy, sw, sh, settings as any);
        for (let pixelIndex = 0; pixelIndex < imageData.data.length; pixelIndex += 100) {
          imageData.data[pixelIndex] ^= 1;
        }
        return imageData;
      };

      // mimeTypes — PDF поддержка как в реальном Chrome
      Object.defineProperty(navigator, 'mimeTypes', {
        get: () => {
          const mimes: any = [{ type: 'application/pdf', suffixes: 'pdf', description: '', enabledPlugin: null }];
          mimes.item = (mimeIndex: number) => mimes[mimeIndex];
          mimes.namedItem = (mimeType: string) => mimes.find((mime: any) => mime.type === mimeType) ?? null;
          return mimes;
        },
      });

      // Удаляем cdc_ маркеры Chrome DevTools
      Object.keys(window).filter((windowKey) => windowKey.startsWith('cdc_')).forEach((windowKey) => {
        try { delete (window as any)[windowKey]; } catch { /* ignore */ }
      });

      // Permissions API
      if (navigator.permissions) {
        const origQuery = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = (parameters: PermissionDescriptor) => {
          if (parameters.name === 'notifications') {
            return Promise.resolve({ state: 'prompt', name: 'notifications', onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false } as unknown as PermissionStatus);
          }
          return origQuery(parameters);
        };
      }

      // outerWidth/outerHeight — в headless равны 0, что мгновенно выдаёт бота
      Object.defineProperty(window, 'outerWidth', { get: () => 1280 });
      Object.defineProperty(window, 'outerHeight', { get: () => 900 });
      Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 });
      Object.defineProperty(window, 'screenX', { get: () => 0 });
      Object.defineProperty(window, 'screenY', { get: () => 0 });

      // screen — реалистичный монитор 1920x1080
      Object.defineProperty(screen, 'width', { get: () => 1920 });
      Object.defineProperty(screen, 'height', { get: () => 1080 });
      Object.defineProperty(screen, 'availWidth', { get: () => 1920 });
      Object.defineProperty(screen, 'availHeight', { get: () => 1040 });
      Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
      Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });

      // navigator.connection
      Object.defineProperty(navigator, 'connection', {
        get: () => ({ rtt: 50, downlink: 10, effectiveType: '4g', saveData: false, onchange: null }),
      });

      // navigator.userAgentData — Client Hints API
      Object.defineProperty(navigator, 'userAgentData', {
        get: () => ({
          brands: [
            { brand: 'Google Chrome', version: '131' },
            { brand: 'Chromium', version: '131' },
            { brand: 'Not_A Brand', version: '24' },
          ],
          mobile: false,
          platform: 'Windows',
          getHighEntropyValues: () => Promise.resolve({
            architecture: 'x86',
            bitness: '64',
            brands: [
              { brand: 'Google Chrome', version: '131' },
              { brand: 'Chromium', version: '131' },
              { brand: 'Not_A Brand', version: '24' },
            ],
            fullVersionList: [
              { brand: 'Google Chrome', version: '131.0.6778.205' },
              { brand: 'Chromium', version: '131.0.6778.205' },
              { brand: 'Not_A Brand', version: '24.0.0.0' },
            ],
            mobile: false,
            model: '',
            platform: 'Windows',
            platformVersion: '10.0.0',
            uaFullVersion: '131.0.6778.205',
          }),
        }),
      });

      Object.defineProperty(navigator, 'appVersion', {
        get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      });
      Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
      Object.defineProperty(navigator, 'vendorSub', { get: () => '' });
      Object.defineProperty(navigator, 'productSub', { get: () => '20030107' });
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
    });
  };

  /**
   * Навигация по URL с полным циклом ожидания: domcontentloaded → networkidle →
   * JS-challenge → WB rate limit → mouse simulation → autoScroll → второй networkidle →
   * captcha → actions.
   */
  private navigateAndWait = async (page: Page, input: BrowseWithActionsInput): Promise<void> => {
    await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch { /* timeout ok */ }

    await this.waitForJsChallenge(page);
    await this.waitForWildberriesRateLimit(page);

    const waitMs = input.waitMs ?? 1500;
    if (waitMs > 0) {
      await this.simulateIdleMouseMovements(page, Math.min(waitMs, 5000));
    }

    if (input.autoScroll !== false) {
      await this.autoScroll(page);
    }

    // Ждём повторного сетевого покоя — JS-фреймворки (WB, Ozon) делают
    // асинхронные API-запросы за данными уже после первого networkidle.
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch { /* ok */ }

    await this.waitForHotelSpaContent(page, input.url);
    await this.solveCaptchaIfNeeded(page);

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
  };

  /** Плавный скролл до конца страницы для lazy-загрузки */
  private autoScroll = async (page: Page): Promise<void> => {
    try {
      await page.evaluate(`(() => {
        return new Promise(function (resolve) {
          var totalScrolled = 0;
          var step = 400;
          var maxScroll = 6000;
          var timer = setInterval(function () {
            window.scrollBy(0, step);
            totalScrolled += step;
            if (totalScrolled >= maxScroll || totalScrolled >= document.body.scrollHeight) {
              clearInterval(timer);
              window.scrollTo(0, 0);
              resolve(undefined);
            }
          }, 120);
          setTimeout(function () { clearInterval(timer); resolve(undefined); }, 4000);
        });
      })()`);
    } catch { /* страница перешла на другой URL во время скролла */ }
  };

  private dismissCookieBanner = async (page: Page): Promise<void> => {
    const candidates = [
      'Согласен', 'Принять', 'Принять все', 'Принять всё', 'Принимаю',
      'Accept', 'Accept all', 'Accept All', 'Allow', 'Allow all',
      'OK', 'Ok', 'Ок', 'Ладно', 'Продолжить', 'Понятно', 'Окей',
      'Agree', 'I agree', 'Got it', 'Close',
    ];
    for (const text of candidates) {
      // Пробуем кнопку (role=button)
      try {
        const button = page.getByRole('button', { name: text, exact: false }).first();
        if (await button.isVisible({ timeout: 200 })) {
          await button.click({ timeout: 1000 });
          await page.waitForTimeout(500);
          return;
        }
      } catch { /* ok */ }
      // Пробуем ссылку или любой элемент с таким текстом (напр. <a> на WB)
      try {
        const element = page.getByText(text, { exact: true }).first();
        if (await element.isVisible({ timeout: 200 })) {
          await element.click({ timeout: 1000 });
          await page.waitForTimeout(500);
          return;
        }
      } catch { /* ok */ }
    }
  };

  private executeAction = async (page: Page, action: PageAction): Promise<void> => {
    try {
      switch (action.type) {
      case 'click_coords': {
        const cursor = createCursor(page);
        await cursor.moveTo({ x: action.x, y: action.y });
        await page.mouse.click(action.x, action.y);
        await page.waitForTimeout(600 + Math.random() * 400);
        try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch { /* ok */ }
        break;
      }
      case 'click_text': {
        const element = page.getByText(action.value, { exact: false }).first();
        await element.scrollIntoViewIfNeeded({ timeout: 3000 });
        const cursor = createCursor(page);
        await cursor.click(element as any);
        await page.waitForTimeout(600 + Math.random() * 400);
        try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch { /* ok */ }
        break;
      }
      case 'click_selector': {
        const element = page.locator(action.selector).first();
        await element.scrollIntoViewIfNeeded({ timeout: 3000 });
        const cursor = createCursor(page);
        await cursor.click(element as any);
        await page.waitForTimeout(600 + Math.random() * 400);
        try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch { /* ok */ }
        break;
      }
      case 'fill_placeholder': {
        const inputElement = page.getByPlaceholder(action.placeholder, { exact: false }).first();
        await inputElement.fill(action.value, { timeout: 5000 });
        await page.waitForTimeout(300);
        break;
      }
      case 'fill_selector': {
        await page.fill(action.selector, action.value, { timeout: 5000 });
        await page.waitForTimeout(300);
        break;
      }
      case 'fill_label': {
        const labeledInput = page.getByLabel(action.label, { exact: false }).first();
        await labeledInput.fill(action.value, { timeout: 5000 });
        await page.waitForTimeout(300);
        break;
      }
      case 'set_checked': {
        await page.locator(action.selector).first().setChecked(action.checked, { timeout: 3000 });
        await page.waitForTimeout(400);
        try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch { /* ok */ }
        break;
      }
      case 'select_option': {
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
        const element = page.locator(action.selector).first();
        await element.scrollIntoViewIfNeeded({ timeout: 3000 });
        await element.hover({ timeout: 3000 });
        await page.waitForTimeout(500);
        break;
      }
      case 'scroll_bottom': {
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        await page.waitForTimeout(500);
        break;
      }
      case 'scroll_top': {
        await page.evaluate('window.scrollTo(0, 0)');
        await page.waitForTimeout(300);
        break;
      }
      case 'scroll_px': {
        const pixels = Math.round(Number(action.pixels));
        await page.evaluate(`window.scrollBy(0, ${Number.isFinite(pixels) ? pixels : 0})`);
        await page.waitForTimeout(300);
        break;
      }
      case 'press_key': {
        if (action.selector) {
          await page.locator(action.selector).first().press(action.key, { timeout: 3000 });
        } else {
          await page.keyboard.press(action.key);
        }
        await page.waitForTimeout(500);
        try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch { /* ok */ }
        break;
      }
      case 'wait': {
        await page.waitForTimeout(Math.min(action.milliseconds, 10000));
        break;
      }
      }
    } catch { /* продолжаем даже если action не сработал */ }
  };

  private extractPageData = async (page: Page, originalUrl: string): Promise<BrowseResult> => {
    const finalUrl = page.url();
    const title = await page.title();

    const screenshotBuf = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false });
    const screenshot = screenshotBuf.toString('base64');

    if (process.env.NODE_ENV !== 'production') {
      try {
        const screenshotsDir = path.join(process.cwd(), 'screenshots');
        fs.mkdirSync(screenshotsDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeName = (finalUrl ?? originalUrl).replace(/[^a-zA-Z0-9а-яА-Я]/g, '_').substring(0, 60);
        fs.writeFileSync(path.join(screenshotsDir, `${timestamp}_${safeName}.jpg`), screenshotBuf);
      } catch { /* non-critical */ }
    }

    // Строковые скрипты: иначе tsx/tsc могут вставить __name() в сериализуемое тело — в браузере его нет (ReferenceError).
    const content = await page.evaluate(`(() => {
      var elementsToRemove = document.querySelectorAll('nav, script, style, noscript, .ads, .advertisement, .cookie, footer, .footer, header');
      elementsToRemove.forEach(function (removableElement) { removableElement.remove(); });
      var mainElement = document.querySelector(
        'main, article, [role="main"], .content, #content, .main, ' +
        '.catalog, .catalog-section, .catalog-container, .products, .product-list, .product-grid, ' +
        '.items, .goods, .shop-list, #catalog, #products, .category-products, ' +
        '.page-content, .page__content, #page-content, .site-content',
      ) || document.body;
      var innerText = mainElement.innerText || mainElement.textContent || '';
      return innerText.replace(/\\s+/g, ' ').trim().substring(0, 10000);
    })()`) as string;

    const buttons = await page.evaluate(`(() => {
      var result = [];
      var buttonElements = document.querySelectorAll('button, [role="button"], .btn, input[type="submit"], input[type="button"], a.button, a.btn');
      buttonElements.forEach(function (buttonElement, buttonIndex) {
        var text = (buttonElement.textContent || buttonElement.value || '').trim().replace(/\\s+/g, ' ');
        if (!text || text.length > 120) return;
        var selector = buttonElement.tagName.toLowerCase();
        if (buttonElement.id) selector = '#' + CSS.escape(buttonElement.id);
        else if (buttonElement.className && typeof buttonElement.className === 'string') {
          var firstCssClass = buttonElement.className.trim().split(/\\s+/)[0];
          if (firstCssClass) selector = buttonElement.tagName.toLowerCase() + '.' + CSS.escape(firstCssClass) + ':nth-of-type(' + (buttonIndex + 1) + ')';
        }
        result.push({ text: text, selector: selector });
      });
      return result.slice(0, 60);
    })()`) as { text: string; selector: string; }[];

    const currentPageUrl = page.url();
    const isMarketplacePage = currentPageUrl.includes('wildberries.ru') || currentPageUrl.includes('ozon.ru');

    // На WB/Ozon дожидаемся рендера карточек товаров (Vue/React lazy render)
    if (isMarketplacePage) {
      try {
        await page.waitForSelector(
          'a[href*="/catalog/"][href*="/detail"], a[href*="/product/"]',
          { timeout: 5000 },
        );
      } catch { /* если нет — продолжаем с тем что есть */ }
    }

    const links = await page.evaluate(
      `(() => {
        var isMarketplace = ${JSON.stringify(isMarketplacePage)};
        if (isMarketplace) {
          var productLinks = Array.from(document.querySelectorAll(
            'a[href*="/catalog/"][href*="/detail"], a[href*="wildberries.ru/catalog/"], a[href*="ozon.ru/product/"], a[href*="/product/"]',
          )).map(function (anchor) {
            return {
              text: (anchor.textContent || '').trim().replace(/\\s+/g, ' '),
              href: anchor.href,
            };
          }).filter(function (link) {
            return link.text.length > 1 && link.text.length < 200 && link.href.startsWith('http') && link.href.indexOf('javascript:') === -1;
          }).slice(0, 40);
          var seenHrefs = new Set(productLinks.map(function (link) { return link.href; }));
          var navigationLinks = Array.from(document.querySelectorAll('a[href]')).map(function (anchor) {
            return {
              text: (anchor.textContent || '').trim().replace(/\\s+/g, ' '),
              href: anchor.href,
            };
          }).filter(function (link) {
            return link.text.length > 1 && link.text.length < 200 && link.href.startsWith('http') && link.href.indexOf('javascript:') === -1 && !seenHrefs.has(link.href);
          }).slice(0, 20);
          return productLinks.concat(navigationLinks);
        }
        return Array.from(document.querySelectorAll('a[href]')).map(function (anchor) {
          return {
            text: (anchor.textContent || '').trim().replace(/\\s+/g, ' '),
            href: anchor.href,
          };
        }).filter(function (link) {
          return link.text.length > 1 && link.text.length < 200 && link.href.startsWith('http') && link.href.indexOf('javascript:') === -1;
        }).slice(0, 60);
      })()`,
    ) as { text: string; href: string; }[];

    const pagination = await page.evaluate(`(() => {
      var result = [];
      var paginationSelectors = [
        '.pagination a', '.pager a', '[class*="pagin"] a', '[class*="pager"] a',
        'nav[aria-label*="страниц"] a', 'nav[aria-label*="page"] a',
        'a[aria-label*="след"]', 'a[aria-label*="next"]',
        '.next a', '.prev a', 'a.next', 'a.prev',
        '[class*="next"]', '[class*="prev"]',
      ];
      var seen = new Set();
      for (var psi = 0; psi < paginationSelectors.length; psi++) {
        var paginationSelector = paginationSelectors[psi];
        document.querySelectorAll(paginationSelector).forEach(function (paginationElement) {
          var anchorElement = paginationElement.tagName === 'A' ? paginationElement : paginationElement.querySelector('a');
          var text = ((paginationElement.textContent || '').trim().replace(/\\s+/g, ' ')) || '';
          var href = anchorElement && anchorElement.href ? anchorElement.href : '';
          if (!text || seen.has(text + href)) return;
          seen.add(text + href);
          result.push({ text: text, href: href || undefined });
        });
      }
      return result.slice(0, 20);
    })()`) as { text: string; href?: string; selector?: string; }[];

    const filters = await page.evaluate(`(() => {
      var result = [];
      document.querySelectorAll('select').forEach(function (selectElement, selectIndex) {
        var closestLabel = selectElement.closest('label');
        var label = selectElement.getAttribute('aria-label') ||
          selectElement.getAttribute('name') ||
          selectElement.id ||
          (closestLabel && closestLabel.textContent ? closestLabel.textContent.trim() : '') ||
          ('select-' + selectIndex);
        var options = Array.from(selectElement.options).map(function (option) { return option.text.trim(); }).filter(Boolean);
        var selector = selectElement.id ? ('#' + CSS.escape(selectElement.id)) : ('select:nth-of-type(' + (selectIndex + 1) + ')');
        result.push({ label: label.trim(), type: 'select', selector: selector, options: options });
      });
      document.querySelectorAll('input[type="checkbox"]').forEach(function (checkboxElement, checkboxIndex) {
        var forLabel = document.querySelector('label[for="' + checkboxElement.id + '"]');
        var closestCb = checkboxElement.closest('label');
        var label = (forLabel && forLabel.textContent ? forLabel.textContent.trim() : '') ||
          (closestCb && closestCb.textContent ? closestCb.textContent.trim() : '') ||
          checkboxElement.getAttribute('name') ||
          ('checkbox-' + checkboxIndex);
        if (!label || label.length > 100) return;
        var selector = checkboxElement.id ? ('#' + CSS.escape(checkboxElement.id)) : ('input[type="checkbox"]:nth-of-type(' + (checkboxIndex + 1) + ')');
        result.push({ label: label.trim(), type: 'checkbox', selector: selector });
      });
      document.querySelectorAll('input[type="radio"]').forEach(function (radioElement, radioIndex) {
        var forLabelR = document.querySelector('label[for="' + radioElement.id + '"]');
        var closestR = radioElement.closest('label');
        var labelR = (forLabelR && forLabelR.textContent ? forLabelR.textContent.trim() : '') ||
          (closestR && closestR.textContent ? closestR.textContent.trim() : '') ||
          radioElement.getAttribute('name') ||
          ('radio-' + radioIndex);
        if (!labelR || labelR.length > 100) return;
        var selectorR = radioElement.id ? ('#' + CSS.escape(radioElement.id)) : ('input[type="radio"]:nth-of-type(' + (radioIndex + 1) + ')');
        result.push({ label: labelR.trim(), type: 'radio', selector: selectorR });
      });
      return result.slice(0, 40);
    })()`) as { label: string; type: 'select' | 'checkbox' | 'radio' | 'button'; selector: string; options?: string[]; }[];

    const pageUrl = page.url();
    const isShowcaptchaUrl = pageUrl.includes('showcaptcha') || pageUrl.includes('captcha.yandex');
    const captchaDetected = isShowcaptchaUrl || await page.evaluate(`(() => {
      var html = document.documentElement.innerHTML.toLowerCase();
      var captchaSelectors = [
        'iframe[src*="recaptcha"]', 'iframe[src*="captcha"]',
        'iframe[src*="turnstile"]', 'iframe[src*="hcaptcha"]',
        'iframe[src*="smartcaptcha"]',
        '.g-recaptcha', '#captcha', '.captcha', '[class*="captcha"]',
        '[id*="captcha"]', 'yandex-captcha', '.smartcaptcha',
      ];
      var hasSelector = captchaSelectors.some(function (sel) { return !!document.querySelector(sel); });
      var hasText = [
        'captcha', 'recaptcha', 'hcaptcha',
        'i am not a robot', 'я не робот', 'подтвердите', 'verify you are human',
        'проверяем браузер', 'checking your browser', 'access denied',
        'cloudflare', 'cf-challenge', 'please wait', 'ddos-guard',
      ].some(function (t) { return html.indexOf(t) !== -1; });
      return hasSelector || hasText;
    })()`);

    return { url: originalUrl, finalUrl, title, content, screenshot, buttons, links, pagination, filters, captchaDetected };
  };

  /** Случайные движения мыши во время ожидания — имитируют живого пользователя */
  private simulateIdleMouseMovements = async (page: Page, durationMs: number): Promise<void> => {
    try {
      const cursor = createCursor(page);
      const endTime = Date.now() + durationMs;
      const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

      while (Date.now() < endTime) {
        const targetX = 100 + Math.random() * (viewport.width - 200);
        const targetY = 100 + Math.random() * (viewport.height - 200);
        await cursor.moveTo({ x: Math.round(targetX), y: Math.round(targetY) });
        await page.waitForTimeout(300 + Math.random() * 700);
      }
    } catch { /* ignore if page navigated */ }
  };

  private randomViewport = (): { width: number; height: number; } => {
    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1536, height: 864 },
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
    ];
    return viewports[Math.floor(Math.random() * viewports.length)];
  };

  private extractSiteKeyFromPage = async (page: Page): Promise<string> => {
    // Ждём появления виджета SmartCaptcha — он грузится динамически через JS
    try {
      await page.waitForSelector(
        '[data-sitekey], iframe[src*="smartcaptcha"], iframe[src*="captcha.yandex"], .smart-captcha',
        { timeout: 8000 },
      );
    } catch { /* не нашли за 8 сек, пробуем всё равно */ }

    return page.evaluate(() => {
      // Вариант 1: iframe с sitekey в src
      const smartFrame = document.querySelector<HTMLIFrameElement>(
        'iframe[src*="smartcaptcha"], iframe[src*="captcha.yandex"]',
      );
      if (smartFrame?.src) {
        try {
          const key = new URL(smartFrame.src).searchParams.get('sitekey');
          if (key) return key;
        } catch { /* ignore */ }
      }
      // Вариант 2: data-sitekey на любом элементе
      const withSiteKey = document.querySelector<HTMLElement>('[data-sitekey]');
      if (withSiteKey) {
        const key = withSiteKey.getAttribute('data-sitekey');
        if (key) return key;
      }
      // Вариант 3: sitekey в тексте inline-скриптов
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const match = script.textContent?.match(/['"]{0,1}sitekey['"]{0,1}\s*[:=]\s*['"]([\w-]{10,})['"]/);
        if (match?.[1]) return match[1];
      }
      // Вариант 4: sitekey в src любого скрипта
      for (const scriptEl of Array.from(document.querySelectorAll('script[src]'))) {
        const src = scriptEl.getAttribute('src') ?? '';
        if (src.includes('sitekey=')) {
          try {
            const key = new URL(src, location.href).searchParams.get('sitekey');
            if (key) return key;
          } catch { /* ignore */ }
        }
      }
      // Вариант 5: regex по всему HTML страницы
      const html = document.documentElement.innerHTML;
      const htmlMatch = html.match(/['"]{0,1}sitekey['"]{0,1}\s*[:=]\s*['"]([\w-]{10,})['"]/);
      if (htmlMatch?.[1]) return htmlMatch[1];
      return '';
    });
  };

  private detectCaptchaOnPage = async (page: Page): Promise<{ type: CaptchaType; siteKey: string; } | null> => {
    const pageUrl = page.url();

    // Yandex SmartCaptcha: detect by URL pattern first (sso.passport.yandex.ru/showcaptcha)
    if (pageUrl.includes('showcaptcha') || pageUrl.includes('captcha.yandex')) {
      const siteKey = await this.extractSiteKeyFromPage(page);
      this.loggerService.debug(this.TAG, 'Yandex SmartCaptcha URL detected', { pageUrl, siteKeyFound: !!siteKey });
      return { type: 'yandex_smart_captcha' as const, siteKey };
    }

    return page.evaluate(() => {
      const recaptchaFrame = document.querySelector('iframe[src*="recaptcha"]');
      const recaptchaDiv = document.querySelector('.g-recaptcha');
      const recaptchaElement = recaptchaDiv ?? recaptchaFrame;

      if (recaptchaElement) {
        const siteKey = recaptchaElement.getAttribute('data-sitekey')
          ?? (() => {
            try {
              return new URL(recaptchaElement.getAttribute('src') ?? '').searchParams.get('k') ?? '';
            } catch {
              return '';
            }
          })();
        if (siteKey) {
          return { type: 'recaptcha_v2' as const, siteKey };
        }
      }

      const smartCaptchaFrame = document.querySelector<HTMLIFrameElement>(
        'iframe[src*="smartcaptcha"], iframe[src*="captcha.yandex"]',
      );
      if (smartCaptchaFrame?.src) {
        try {
          const siteKey = new URL(smartCaptchaFrame.src).searchParams.get('sitekey') ?? '';
          if (siteKey) return { type: 'yandex_smart_captcha' as const, siteKey };
        } catch { /* ignore */ }
      }

      const smartCaptchaElement = document.querySelector<HTMLElement>(
        '.smartcaptcha, yandex-captcha, [class*="smartcaptcha"], [id*="smartcaptcha"], [data-sitekey]',
      );
      if (smartCaptchaElement) {
        const siteKey = smartCaptchaElement.getAttribute('data-sitekey') ?? smartCaptchaElement.getAttribute('sitekey') ?? '';
        if (siteKey) {
          return { type: 'yandex_smart_captcha' as const, siteKey };
        }
      }

      return null;
    });
  };

  public solveCaptchaIfNeeded = async (page: Page): Promise<void> => {
    let captchaDetails: Awaited<ReturnType<typeof this.detectCaptchaOnPage>>;
    try {
      captchaDetails = await this.detectCaptchaOnPage(page);
    } catch {
      return;
    }

    if (isNil(captchaDetails)) {
      return;
    }

    const { type, siteKey } = captchaDetails;
    const pageUrl = page.url();
    this.loggerService.info(this.TAG, `Captcha detected: type=${type}`, { pageUrl, siteKey: siteKey.substring(0, 20) });

    // Ждём чтобы iframe с капчей успел загрузиться
    await page.waitForTimeout(2000);

    if (!this.captchaSolverTool.isConfigured()) {
      this.loggerService.warn(this.TAG, `Captcha detected (${type}) but CAPTCHA_SOLVER_API_KEY not configured — attempting visual click fallback`);
      await this.attemptVisualCaptchaClick(page);
      return;
    }

    if (!siteKey) {
      this.loggerService.warn(this.TAG, `Captcha detected (${type}) but sitekey not found — attempting visual click fallback`);
      await this.attemptVisualCaptchaClick(page);
      return;
    }

    try {
      const solveResult = type === 'yandex_smart_captcha'
        ? await this.captchaSolverTool.solveYandexSmartCaptcha(siteKey, pageUrl)
        : await this.captchaSolverTool.solveRecaptchaV2(siteKey, pageUrl);

      await page.evaluate((token) => {
        // Yandex SmartCaptcha: inject smart-token and submit form
        try {
          const hiddenInput = document.querySelector<HTMLInputElement>(
            'input[name="smart-token"], input[name="captcha-token"], input[name="spravka"]',
          );
          if (hiddenInput) {
            hiddenInput.value = token;
            const form = hiddenInput.closest('form');
            if (form) {
              form.submit();
              return;
            }
          }
        } catch { /* ignore */ }

        // Yandex SmartCaptcha: via window callback
        try {
          const smartCaptchaElement = document.querySelector('[data-callback]');
          const callbackName = smartCaptchaElement?.getAttribute('data-callback');
          if (callbackName && typeof (window as any)[callbackName] === 'function') {
            (window as any)[callbackName](token);
            return;
          }
        } catch { /* ignore */ }

        // Yandex SmartCaptcha: via window.smartCaptcha API
        try {
          if (typeof (window as any).smartCaptcha?.setToken === 'function') {
            (window as any).smartCaptcha.setToken(token);
            return;
          }
        } catch { /* ignore */ }

        // Standard reCAPTCHA injection fallback
        try {
          const textArea = document.getElementById('g-recaptcha-response') as HTMLTextAreaElement | null;
          if (textArea) {
            textArea.style.display = 'block';
            textArea.value = token;
          }
          // eslint-disable-next-line no-underscore-dangle
          const grecaptchaClients = (window as any).___grecaptcha_cfg?.clients ?? {};
          Object.values(grecaptchaClients).forEach((client: any) => {
            if (typeof client?.callback === 'function') client.callback(token);
          });
        } catch { /* ignore */ }
      }, solveResult.token);

      await page.waitForTimeout(2000);
      try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch { /* ok */ }

      this.loggerService.info(this.TAG, 'Captcha solved and injected', { pageUrl });
    } catch (error) {
      this.loggerService.error(this.TAG, `Captcha solving failed for ${pageUrl}:`, error);
    }
  };

  private attemptVisualCaptchaClick = async (page: Page): Promise<void> => {
    const checkboxSelectors = [
      '.CheckboxCaptcha-Anchor',
      '.DesktopWebkit_CheckboxCaptcha-Anchor',
      '[class*="CheckboxCaptcha-Anchor"]',
      '[class*="CheckboxCaptcha"]',
      'button[class*="captcha"]',
      'input[type="checkbox"]',
    ];

    // Сначала ищем в главном документе
    for (const selector of checkboxSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          this.loggerService.info(this.TAG, `Visual captcha click: found in main frame: ${selector}`);
          await element.scrollIntoViewIfNeeded();
          await element.click({ delay: 120 });
          await page.waitForTimeout(4000);
          return;
        }
      } catch { /* ignore */ }
    }

    // Ищем во всех iframe (CheckboxCaptcha на passport.yandex.ru — внутри iframe)
    const frames = page.frames();
    this.loggerService.debug(this.TAG, `Visual captcha click: scanning ${frames.length} frames`);

    for (const frame of frames) {
      const frameUrl = frame.url();
      if (!frameUrl || frameUrl === 'about:blank') continue;
      this.loggerService.debug(this.TAG, `Visual captcha click: checking frame ${frameUrl.substring(0, 80)}`);

      for (const selector of checkboxSelectors) {
        try {
          const element = await frame.$(selector);
          if (element) {
            this.loggerService.info(this.TAG, `Visual captcha click: found in frame ${frameUrl.substring(0, 60)}: ${selector}`);
            await element.scrollIntoViewIfNeeded();
            await element.click({ delay: 120 });
            await page.waitForTimeout(4000);
            return;
          }
        } catch { /* ignore */ }
      }
    }

    // Логируем HTML для диагностики структуры
    try {
      const html = await page.evaluate(() => document.documentElement.innerHTML.substring(0, 3000));
      this.loggerService.debug(this.TAG, 'Visual captcha click: no selector found, page HTML snippet', { html });
    } catch { /* ignore */ }

    this.loggerService.warn(this.TAG, 'Visual captcha click: no checkbox found in any frame');
  };

  private waitForWildberriesRateLimit = async (page: Page): Promise<void> => {
    const MAX_RATE_LIMIT_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
      const rateLimitInfo = await page.evaluate(() => {
        const html = document.documentElement.innerHTML;
        const isRateLimitPage = html.includes('captcha-support@rwb.ru')
          && html.includes('Подозрительная активность');
        if (!isRateLimitPage) {
          return null;
        }
        const timerMatch = html.match(/Новая попытка через\s*(\d{1,2}):(\d{2})/);
        const seconds = timerMatch
          ? parseInt(timerMatch[1], 10) * 60 + parseInt(timerMatch[2], 10)
          : 70;
        return { seconds };
      });

      if (isNil(rateLimitInfo)) return;

      if (attempt === MAX_RATE_LIMIT_RETRIES) {
        throw new Error(`WB rate limit: IP заблокирован после ${MAX_RATE_LIMIT_RETRIES} попыток`);
      }

      const waitSeconds = rateLimitInfo.seconds + 5;
      this.loggerService.warn(this.TAG, `WB rate limit detected (attempt ${attempt}/${MAX_RATE_LIMIT_RETRIES}), waiting ${waitSeconds}s...`);
      await page.waitForTimeout(waitSeconds * 1000);

      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      } catch { /* ok */ }

      this.loggerService.info(this.TAG, `WB rate limit retry ${attempt} done, URL: ${page.url()}`);
    }
  };

  private waitForJsChallenge = async (page: Page): Promise<void> => {
    let isChallenge: boolean;
    try {
      isChallenge = await page.evaluate(() => {
        const html = document.documentElement.innerHTML.toLowerCase();
        return (
          html.includes('ddos-guard') ||
          html.includes('cf-challenge') ||
          html.includes('cloudflare') ||
          html.includes('проверяем браузер') ||
          html.includes('checking your browser') ||
          html.includes('please wait') ||
          (document.title.toLowerCase().includes('just a moment') && document.title !== '')
        );
      });
    } catch {
      return;
    }

    if (!isChallenge) {
      return;
    }

    this.loggerService.info(this.TAG, `JS-challenge detected on ${page.url()}, waiting for it to pass...`);
    try {
      await page.waitForFunction(
        () => {
          const html = document.documentElement.innerHTML.toLowerCase();
          return (
            !html.includes('проверяем браузер') &&
            !html.includes('checking your browser') &&
            !html.includes('please wait') &&
            !html.includes('ddos-guard') &&
            !html.includes('cf-challenge') &&
            !(document.title.toLowerCase().includes('just a moment') && document.title !== '')
          );
        },
        { timeout: 30000 },
      );
      try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch { /* ok */ }
      await page.waitForTimeout(3000);
      this.loggerService.info(this.TAG, `JS-challenge passed, landed on ${page.url()}`);
    } catch {
      this.loggerService.warn(this.TAG, `JS-challenge wait timed out for ${page.url()}`);
    }
  };

  /**
   * Ожидает рендера контента на React/SPA сайтах бронирования отелей.
   * Аналог WB/Ozon marketplace-ожидания — networkidle срабатывает раньше,
   * чем React успевает отрисовать карточки отелей.
   */
  private waitForHotelSpaContent = async (page: Page, url: string): Promise<void> => {
    const isHotelSite = url.includes('ostrovok.ru') || url.includes('101hotel.ru') || url.includes('tvil.ru') || url.includes('sutochno.ru');
    if (!isHotelSite) {
      return;
    }

    // Страницы-списки (city-level) и страницы конкретных отелей требуют разных селекторов
    const listPageSelectors = [
      '[data-selenium="hotel-card"]',
      '[class*="HotelCard"]',
      '[class*="hotel-card"]',
      '[class*="hotelCard"]',
      '[class*="zencard"]',
      '[class*="PropertyCard"]',
      '[class*="hotel-item"]',
    ].join(', ');

    // Для страниц конкретного отеля — ждём заголовок или номера
    const detailPageSelectors = [
      'h1',
      '[class*="RoomCard"]',
      '[class*="room-card"]',
      '[class*="roomCard"]',
      '[class*="HotelInfo"]',
      '[class*="BookingCard"]',
      '[data-selenium="room"]',
    ].join(', ');

    // Определяем тип страницы по глубине URL-пути
    const urlPath = (() => { try { return new URL(url).pathname; } catch { return url; } })();
    const pathSegments = urlPath.split('/').filter(Boolean);
    // Страница конкретного отеля: /hotel/russia/{город}/{слаг}/  — 4+ сегмента
    const isDetailPage = pathSegments.length >= 4;

    const selectors = isDetailPage
      ? `${detailPageSelectors}, ${listPageSelectors}`
      : listPageSelectors;

    try {
      await page.waitForSelector(selectors, { timeout: 12000 });
      this.loggerService.info(this.TAG, `Hotel SPA content rendered on ${page.url()}`);
    } catch {
      // Если ничего не появилось — даём ещё 3 сек и продолжаем с тем что есть
      this.loggerService.warn(this.TAG, `Hotel SPA content wait timed out for ${url}, continuing`);
      await page.waitForTimeout(3000);
    }
  };
}
