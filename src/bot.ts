import 'dotenv/config';
import 'reflect-metadata';

import express from 'express';
import { Container } from 'typescript-ioc';

import { DatabaseService } from '@/db/database.service';
import { TelegramBotService } from '@/services/telegram/telegram-bot.service';
import { TelegramBotCommandService } from '@/services/telegram/telegram-bot-command.service';
import { RouterService } from '@/services/app/router.service';

class BotApplication {
  private readonly databaseService = Container.get(DatabaseService);

  private readonly telegramBotService = Container.get(TelegramBotService);

  private readonly telegramBotCommandService = Container.get(TelegramBotCommandService);

  private readonly routerService = Container.get(RouterService);

  private readonly app = express();

  private readonly port = Number(process.env.PORT ?? 3014);

  private readonly isProduction = process.env.NODE_ENV === 'production';

  private configureExpress = (): void => {
    this.app.use(express.json());

    this.routerService.set();
    this.app.use(this.routerService.get());
  };

  public async start(): Promise<void> {
    await this.databaseService.init();
    await this.telegramBotService.init();

    const bot = this.telegramBotService.getBot();

    this.telegramBotCommandService.register(bot);

    this.configureExpress();

    if (this.isProduction) {
      const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;

      if (!webhookUrl) {
        throw new Error('TELEGRAM_WEBHOOK_URL is not set for production webhook mode');
      }

      await bot.telegram.setWebhook(webhookUrl);
    } else {
      await bot.telegram.deleteWebhook();
      bot.launch().catch((e) => console.error('Bot launch failed:', e));
    }

    const server = this.app.listen(this.port, () => {
      console.log(`Assistent bot server is running on port ${this.port}`);
    });

    const shutdown = (signal: string) => {
      bot.stop(signal);
      server.close();
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  }
}

new BotApplication()
  .start()
  .catch((e: unknown) => {
    console.error(e);
  });
