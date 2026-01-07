import { AppConfig } from '../models/config';
import logger, { createContextLogger } from '../utils/logger';

export function initializeEventDrivenMode(config: AppConfig): boolean {
  const contextLogger = createContextLogger({ step: 'event-driven-init' });

  if (!config.executionModes.event_driven.enabled) {
    logger.info('Event-driven mode disabled');
    return false;
  }

  logger.info('Initializing Event-driven mode', {
    webhook_secret_configured: !!config.executionModes.event_driven.webhook_secret,
  });

  if (!config.executionModes.event_driven.webhook_secret) {
    contextLogger.fatal('Event-driven mode enabled but webhook_secret not configured');
    throw new Error('webhook_secret is required for event-driven mode');
  }

  logger.info('Event-driven mode initialized (webhook endpoint will be registered in manual mode)');

  return true;
}
