import { Express } from 'express';
import { AppConfig } from '../models/config';
import { createExpressApp, startExpressServer } from '../api/server';
import logger from '../utils/logger';

export function initializeManualMode(config: AppConfig): Express | null {
  if (!config.executionModes.manual.enabled) {
    logger.info('Manual mode disabled');
    return null;
  }

  logger.info('Initializing Manual mode');

  const app = createExpressApp(config);

  const port = config.executionModes.manual.api_port || parseInt(process.env.PORT || '3000', 10);

  startExpressServer(app, port);

  logger.info('Manual mode initialized', { port });

  return app;
}
