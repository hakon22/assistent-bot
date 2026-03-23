import { Singleton } from 'typescript-ioc';
import axios from 'axios';
import { isNil } from 'lodash-es';

import { BaseService } from '@/services/app/base.service';

export type CaptchaType = 'recaptcha_v2' | 'yandex_smart_captcha';

export interface CaptchaSolveResult {
  token: string;
}

interface CaptchaApiResponse {
  status: number;
  request: string;
}

@Singleton
export class CaptchaSolverTool extends BaseService {
  private readonly TAG = 'CaptchaSolverTool';

  private readonly DEFAULT_HOST = 'https://rucaptcha.com';

  private readonly POLL_INTERVAL_MS = 5000;

  private readonly MAX_POLL_ATTEMPTS = 24; // 2 минуты максимум

  private readonly apiKey = process.env.CAPTCHA_SOLVER_API_KEY;

  private readonly host = process.env.CAPTCHA_SOLVER_HOST ?? this.DEFAULT_HOST;

  public isConfigured = (): boolean => !isNil(this.apiKey);

  public solveRecaptchaV2 = async (siteKey: string, pageUrl: string): Promise<CaptchaSolveResult> => {
    this.loggerService.info(this.TAG, 'Solving reCAPTCHA v2', { pageUrl });
    const captchaId = await this.submitRecaptchaV2(siteKey, pageUrl);
    const token = await this.pollResult(captchaId);
    this.loggerService.info(this.TAG, 'reCAPTCHA v2 solved', { pageUrl });
    return { token };
  };

  public solveYandexSmartCaptcha = async (siteKey: string, pageUrl: string): Promise<CaptchaSolveResult> => {
    this.loggerService.info(this.TAG, 'Solving Yandex SmartCaptcha', { pageUrl });
    const captchaId = await this.submitYandexSmartCaptcha(siteKey, pageUrl);
    const token = await this.pollResult(captchaId);
    this.loggerService.info(this.TAG, 'Yandex SmartCaptcha solved', { pageUrl });
    return { token };
  };

  private submitRecaptchaV2 = async (siteKey: string, pageUrl: string): Promise<string> => {
    const { data } = await axios.post<CaptchaApiResponse>(
      `${this.host}/in.php`,
      null,
      {
        params: {
          key: this.apiKey,
          method: 'userrecaptcha',
          googlekey: siteKey,
          pageurl: pageUrl,
          json: 1,
        },
        timeout: 30000,
      },
    );
    if (data.status !== 1) {
      throw new Error(`Captcha submit failed: ${data.request}`);
    }
    return data.request;
  };

  private submitYandexSmartCaptcha = async (siteKey: string, pageUrl: string): Promise<string> => {
    const { data } = await axios.post<CaptchaApiResponse>(
      `${this.host}/in.php`,
      null,
      {
        params: {
          key: this.apiKey,
          method: 'yandex',
          sitekey: siteKey,
          pageurl: pageUrl,
          json: 1,
        },
        timeout: 30000,
      },
    );
    if (data.status !== 1) {
      throw new Error(`Captcha submit failed: ${data.request}`);
    }
    return data.request;
  };

  private pollResult = async (captchaId: string): Promise<string> => {
    for (let attempt = 0; attempt < this.MAX_POLL_ATTEMPTS; attempt++) {
      await this.sleep(this.POLL_INTERVAL_MS);

      const { data } = await axios.get<CaptchaApiResponse>(
        `${this.host}/res.php`,
        {
          params: {
            key: this.apiKey,
            action: 'get',
            id: captchaId,
            json: 1,
          },
          timeout: 15000,
        },
      );

      if (data.request === 'CAPCHA_NOT_READY') {
        continue;
      }

      if (data.status !== 1) {
        throw new Error(`Captcha polling failed: ${data.request}`);
      }

      return data.request;
    }
    throw new Error(`Captcha polling timeout after ${this.MAX_POLL_ATTEMPTS} attempts`);
  };

  private sleep = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));
}
