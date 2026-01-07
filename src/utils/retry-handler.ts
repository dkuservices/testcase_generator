import logger from './logger';

export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  exponentialBackoff?: boolean;
  onRetry?: (attempt: number, error: Error) => void;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxAttempts, delayMs, exponentialBackoff = true, onRetry } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxAttempts) {
        break;
      }

      const delay = exponentialBackoff
        ? delayMs * Math.pow(2, attempt - 1)
        : delayMs;

      logger.warn(`Retry attempt ${attempt}/${maxAttempts} after ${delay}ms`, {
        error: lastError.message,
      });

      if (onRetry) {
        onRetry(attempt, lastError);
      }

      await sleep(delay);
    }
  }

  throw lastError || new Error('Retry failed with unknown error');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isRateLimitError(error: any): boolean {
  return error?.status === 429 || error?.statusCode === 429 || error?.code === 'rate_limit_exceeded';
}

export function isRetryableError(error: any): boolean {
  const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
  const statusCode = error?.status || error?.statusCode;

  if (statusCode && retryableStatusCodes.includes(statusCode)) {
    return true;
  }

  const retryableCodes = ['ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED'];
  if (error?.code && retryableCodes.includes(error.code)) {
    return true;
  }

  return false;
}
