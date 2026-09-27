import { Container, Singleton } from 'typescript-ioc';
import type { Request, Response } from 'express';

import { isAliceIncomingBody } from '@/alice/guards/alice-request.guard';
import { BaseService } from '@/services/app/base.service';
import { ErrorLogService } from '@/services/error/error-log.service';
import { AliceDialogService } from '@/services/alice/alice-dialog.service';
import { AliceResponseBuilderService } from '@/services/alice/alice-response-builder.service';
import type { AliceSkillModelEnum } from '@/alice/types/alice-skill-model';
import type { AliceResponseBody } from '@/alice/types/alice-response-body';

@Singleton
export class AliceWebhookService extends BaseService {
  private readonly TAG = 'AliceWebhookService';

  private readonly INVALID_REQUEST_TEXT = 'Некорректный запрос.';

  private readonly UNEXPECTED_ERROR_TEXT = 'Не получилось обработать запрос. Попробуйте ещё раз.';

  private readonly aliceDialogService = Container.get(AliceDialogService);

  private readonly aliceResponseBuilder = Container.get(AliceResponseBuilderService);

  private readonly errorLogService = Container.get(ErrorLogService);

  public handle = (skillModel: AliceSkillModelEnum) => async (
    req: Request<Record<string, never>, AliceResponseBody, unknown>,
    res: Response<AliceResponseBody>,
  ): Promise<void> => {
    try {
      if (!isAliceIncomingBody(req.body)) {
        this.loggerService.warn(this.TAG, 'Rejected invalid Alice body', { skillModel });
        res.json(this.aliceResponseBuilder.buildTextResponse({
          text: this.INVALID_REQUEST_TEXT,
          endSession: true,
        }));
        return;
      }

      const aliceResponse = await this.aliceDialogService.handle({
        body: req.body,
        skillModel,
      });

      res.json(aliceResponse);
    } catch (error) {
      this.loggerService.error(this.TAG, 'Alice webhook failed', error);

      try {
        await this.errorLogService.handle({
          error,
          serviceName: this.TAG,
          nodeName: 'handle',
          notifyUser: false,
        });
      } catch (logError) {
        this.loggerService.error(this.TAG, 'Failed to persist Alice error', logError);
      }

      res.json(this.aliceResponseBuilder.buildTextResponse({
        text: this.UNEXPECTED_ERROR_TEXT,
        endSession: false,
      }));
    }
  };
}
