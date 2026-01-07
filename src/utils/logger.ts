import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

const logLevel = process.env.LOG_LEVEL || 'info';
const isDevelopment = process.env.NODE_ENV === 'development';

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
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

const transports: winston.transport[] = [];

if (isDevelopment) {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
} else {
  transports.push(
    new winston.transports.Console({
      format: customFormat,
    })
  );
}

transports.push(
  new DailyRotateFile({
    filename: path.join('logs', 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles: '30d',
    format: customFormat,
  })
);

transports.push(
  new DailyRotateFile({
    filename: path.join('logs', 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles: '90d',
    level: 'error',
    format: customFormat,
  })
);

const logger = winston.createLogger({
  level: logLevel,
  transports,
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
  };
}
