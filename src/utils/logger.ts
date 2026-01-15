import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';
import util from 'util';

const rawLogLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const levelMap: Record<string, string> = {
  trace: 'silly',
  silly: 'silly',
  debug: 'debug',
  verbose: 'verbose',
  info: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  fatal: 'error',
};
const mappedLogLevel = levelMap[rawLogLevel];
const logLevel = mappedLogLevel || 'info';

if (!mappedLogLevel) {
  console.warn(`Unknown LOG_LEVEL="${rawLogLevel}", defaulting to "${logLevel}".`);
}

const logsDir = path.join(process.cwd(), 'logs');
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (error) {
  console.warn('Failed to ensure logs directory exists:', (error as Error).message);
}

const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaKeys = Object.keys(meta);
    const metaSuffix =
      metaKeys.length > 0
        ? ` ${util.inspect(meta, { depth: 6, colors: false, breakLength: 120 })}`
        : '';
    return `${timestamp} [${level}]: ${message}${metaSuffix}`;
  })
);

const transports: winston.transport[] = [];

// Always add console transport for both development and production
// Use colorized format for development, JSON format for production
transports.push(
  new winston.transports.Console({
    format: consoleFormat,
  })
);

transports.push(
  new DailyRotateFile({
    filename: path.join(logsDir, 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles: '30d',
    format: customFormat,
  })
);

transports.push(
  new DailyRotateFile({
    filename: path.join(logsDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles: '90d',
    level: 'error',
    format: customFormat,
  })
);

const logger = winston.createLogger({
  level: logLevel,
  transports,
  exitOnError: false,
  exceptionHandlers: [
    new winston.transports.Console({ format: consoleFormat }),
    new DailyRotateFile({
      filename: path.join(logsDir, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '90d',
      format: customFormat,
    }),
  ],
  rejectionHandlers: [
    new winston.transports.Console({ format: consoleFormat }),
    new DailyRotateFile({
      filename: path.join(logsDir, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '90d',
      format: customFormat,
    }),
  ],
});

export default logger;

export interface LogContext {
  job_id?: string;
  confluence_page_id?: string;
  parent_jira_issue_id?: string;
  step?: string;
  duration_ms?: number;
  [key: string]: any;
}

export function createContextLogger(context: LogContext) {
  return {
    trace: (message: string, meta?: any) => logger.log('silly', message, { ...context, ...meta }),
    debug: (message: string, meta?: any) => logger.debug(message, { ...context, ...meta }),
    info: (message: string, meta?: any) => logger.info(message, { ...context, ...meta }),
    warn: (message: string, meta?: any) => logger.warn(message, { ...context, ...meta }),
    error: (message: string, meta?: any) => logger.error(message, { ...context, ...meta }),
    fatal: (message: string, meta?: any) => logger.log('error', message, { ...context, ...meta, fatal: true }),
    log: (level: string, message: string, meta?: any) => logger.log(level, message, { ...context, ...meta }),
  };
}
