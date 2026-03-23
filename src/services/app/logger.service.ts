import { Singleton } from 'typescript-ioc';
import winston from 'winston';
import moment from 'moment-timezone';
import DailyRotateFile from 'winston-daily-rotate-file';

@Singleton
export class LoggerService {
  private readonly logDir = process.env.NODE_ENV === 'production' ? '/srv/logs' : './logs';

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
    const fileTransports = [
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

    this.transports = process.env.DB === 'LOCAL' || process.env.CRON || process.env.NODE_ENV !== 'production'
      ? [new winston.transports.Console(), ...fileTransports]
      : [
        ...fileTransports,
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

  private buildLogMetadata = (context: string): { module: string; } => ({
    module: context,
  });

  private buildLogMessage = (args: unknown[], isError?: boolean) => {
    const result: string[] = [];

    args.forEach((logArgument) => {
      if (!logArgument) {
        return false;
      }
      if (logArgument && !(typeof logArgument === 'object') && !Array.isArray(logArgument)) {
        result.push(String(logArgument));
      } else if (logArgument instanceof Error) {
        result.push(logArgument?.stack ? logArgument.stack : String(logArgument));
      } else {
        result.push((isError ? JSON.stringify(logArgument, null, 2) : JSON.stringify(logArgument)));
      }
    });
    return result.join(' ');
  };

  private log = (level: 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly', context: string, args: unknown[], isError?: boolean) => {
    const text = this.buildLogMessage(args, isError);
    this.logger.log(level, text, this.buildLogMetadata(context));
  };

  public info = (message: unknown, ...args: unknown[]) => this.log('info', String(message), args);

  public debug = (message: unknown, ...args: unknown[]) => this.log('debug', String(message), args);

  public warn = (message: unknown, ...args: unknown[]) => this.log('warn', String(message), args);

  public error = (message: unknown, ...args: unknown[]) => {
    const firstArg = args[0] as { type?: string; } | undefined;
    if (firstArg?.type === 'PRECONDITION FAILED') {
      return;
    }
    const typedMessage = message as { type?: string; } | string | undefined;
    if (message && (typeof message === 'string')) {
      this.log('error', message, args, true);
    } else if ((typedMessage as { type?: string; })?.type !== 'PRECONDITION FAILED') {
      args.push(message);
      this.log('error', '', args, true);
    }
  };
}
