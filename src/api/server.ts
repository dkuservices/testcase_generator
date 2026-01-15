import express, { Express } from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import { AppConfig } from '../models/config';
import { createGenerateRoute } from './routes/generate';
import statusRoutes from './routes/status';
import jobsRoutes from './routes/jobs';
import { createValidateRoute } from './routes/validate';
import { createWebhookRoute } from './routes/webhook';
import { createHealthRoute } from './routes/health';
import reviewRoutes from './routes/review';
import { errorHandler } from './middleware/error-handler';
import logger from '../utils/logger';

export function createExpressApp(config: AppConfig): Express {
  const app = express();

  app.use(helmet());

  if (config.executionModes.manual.cors?.enabled) {
    app.use(
      cors({
        origin: config.executionModes.manual.cors.origins,
        credentials: true,
      })
    );
  }

  app.use(express.json());
  const publicDir = path.join(process.cwd(), 'public');
  app.use('/ui', express.static(publicDir));
  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'generate.html'));
  });
  app.get('/generate', (_req, res) => {
    res.sendFile(path.join(publicDir, 'generate.html'));
  });
  app.get('/review', (_req, res) => {
    res.sendFile(path.join(publicDir, 'review.html'));
  });

  app.use((req, _res, next) => {
    logger.info('API request', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    next();
  });

  app.use('/api/generate', createGenerateRoute(config.jira));
  app.use('/api/status', statusRoutes);
  app.use('/api/jobs', jobsRoutes);
  app.use('/api/validate', createValidateRoute(config.jira));
  app.use('/api/review', reviewRoutes);

  if (config.executionModes.event_driven.enabled) {
    app.use(
      '/api/webhook/confluence',
      createWebhookRoute(config.executionModes.event_driven.webhook_secret, config.confluence, config.jira)
    );
  }

  app.use('/api/health', createHealthRoute(config.executionModes));

  app.use(errorHandler);

  logger.info('Express app initialized', {
    cors_enabled: config.executionModes.manual.cors?.enabled,
    webhook_enabled: config.executionModes.event_driven.enabled,
  });

  return app;
}

export function startExpressServer(app: Express, port: number): void {
  const server = app.listen(port, '0.0.0.0', () => {
    logger.info(`Express server started on port ${port}`);
  });
  
  server.on('error', (error: any) => {
    logger.error('Express server error', { error: error.message, port });
  });
}
