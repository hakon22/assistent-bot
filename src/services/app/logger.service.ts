import { Singleton } from 'typescript-ioc';
import winston from 'winston';
import moment from 'moment-timezone';
import DailyRotateFile from 'winston-daily-rotate-file';

@Singleton
export class LoggerService {
  private readonly logDir = '/srv/logs';

  private readonly appName = process.env.APP_NAME ?? 'assistent-bot';

  private colorizer = winston.format.colorize();

  private readonly levels = {
    critical: 0,
    error: 1,
    warn: 2,
    info: 3,
    verbose: 4,
    debug: 5,
  };

  private readonly colors = {
    critical: 'red',
    error: 'brightRed',
    warn: 'brightRed',
    info: 'brightGreen',
    debug: 'grey',
    verbose: 'green',
  };

  private logger: winston.Logger;

  private transports: winston.transport[];

  constructor() {
    this.colorizer.addColors(this.colors);
    this.transports = process.env.DB === 'LOCAL' || process.env.CRON || process.env.NODE_ENV !== 'production'
      ? [new winston.transports.Console()]
      : [
        new DailyRotateFile({
          dirname: this.logDir,
          filename: `${this.appName}-%DATE%.log`,
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '14d',
          level: 'debug',
        }),
        new DailyRotateFile({
          dirname: this.logDir,
          filename: `${this.appName}-error-%DATE%.log`,
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '14d',
          level: 'error',
        }),
      ];

    this.logger = winston.createLogger({
      level: 'debug',
      levels: this.levels,
      format: winston.format.combine(
        winston.format.timestamp({
          format: () => moment().tz('Europe/Moscow').format(),
        }),
        winston.format.printf(
          (info) => {
            const metadata = `${process.pid} ${info.timestamp} ${info.level}: ${info.module ? `[${info.module}]` : ''}`;
            if (process.env.NODE_ENV === 'production') {
              return `${metadata}${(info.message as string)[0] === '[' ? info.message : ` ${typeof info.message === 'object' ? JSON.stringify(info.message) : info.message}`} ${info.stack ? JSON.stringify(info.stack) : ''}`;
            }
            switch (info.level) {
            case 'critical':
            case 'error':
            case 'debug':
              return this.colorizer.colorize(info.level, `${metadata}${(info.message as string)[0] === '[' ? info.message : ` ${typeof info.message === 'object' ? JSON.stringify(info.message) : info.message}`} ${info.stack ? JSON.stringify(info.stack) : ''}`);
            default:
              return `${this.colorizer.colorize(info.level, metadata)}${(info.message as string)[0] === '[' ? info.message : ` ${typeof info.message === 'object' ? JSON.stringify(info.message) : info.message}`}`;
            }
          },
        ),
      ),
      transports: this.transports,
    });
  }

  private getMeta = (context: any): { module: string; } => ({
    module: context,
  });

  private getArgs = (args: any[], error?: boolean) => {
    const result: any[] = [];

    args.forEach((arg) => {
      if (!arg) {
        return false;
      }
      if (arg && !(typeof arg === 'object') && !Array.isArray(arg)) {
        result.push(arg);
      } else if (arg instanceof Error) {
        result.push(arg?.stack ? arg.stack : arg);
      } else {
        result.push((error ? JSON.stringify(arg, null, 2) : JSON.stringify(arg)));
      }
    });
    return result.join(' ');
  };

  private log = (level: 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly', context: string, args: any[], error?: boolean) => {
    const text = this.getArgs(args, error);
    this.logger.log(level, text, this.getMeta(context));
  };

  public info = (message: any, ...args: any[]) => this.log('info', message, args);

  public debug = (message: any, ...args: any[]) => this.log('debug', message, args);

  public warn = (message: any, ...args: any[]) => this.log('warn', message, args);

  public error = (message: any, ...args: any[]) => {
    if (args && args[0]?.type === 'PRECONDITION FAILED') {
      return;
    }
    if (message && (typeof message === 'string')) {
      this.log('error', message, args, true);
    } else if (message?.type !== 'PRECONDITION FAILED') {
      args.push(message);
      this.log('error', '', args, true);
    }
  };
}
