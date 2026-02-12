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
import exportRoutes from './routes/export';
import { createBatchGenerateRoute } from './routes/batch-generate';
import batchStatusRoutes from './routes/batch-status';
import projectsRoutes from './routes/projects';
import componentsRoutes from './routes/components';
import { createPagesRoute } from './routes/pages';
import hierarchyRoutes from './routes/hierarchy';
import chatRoutes from './routes/chat';
import { createDocumentsRoute } from './routes/documents';
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
    res.redirect('/projects');
  });
  app.get('/projects', (_req, res) => {
    res.sendFile(path.join(publicDir, 'projects.html'));
  });
  app.get('/project/:id', (_req, res) => {
    res.sendFile(path.join(publicDir, 'project.html'));
  });
  app.get('/component/:id', (_req, res) => {
    res.sendFile(path.join(publicDir, 'component.html'));
  });
  app.get('/page/:id', (_req, res) => {
    res.sendFile(path.join(publicDir, 'page.html'));
  });
  app.get('/generate', (_req, res) => {
    res.sendFile(path.join(publicDir, 'generate.html'));
  });
  app.get('/review', (_req, res) => {
    res.sendFile(path.join(publicDir, 'review.html'));
  });
  app.get('/jobs', (_req, res) => {
    res.sendFile(path.join(publicDir, 'jobs.html'));
  });
  app.get('/documents', (_req, res) => {
    res.sendFile(path.join(publicDir, 'documents.html'));
  });
  app.get('/document/:id', (_req, res) => {
    res.sendFile(path.join(publicDir, 'document.html'));
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
  app.use('/api/export', exportRoutes);
  app.use('/api/batch/generate', createBatchGenerateRoute(config.jira));
  app.use('/api/batch/status', batchStatusRoutes);

  // Hierarchy routes
  app.use('/api/projects', projectsRoutes);
  app.use('/api/components', componentsRoutes);
  app.use('/api/pages', createPagesRoute(config.jira));
  app.use('/api/hierarchy', hierarchyRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/documents', createDocumentsRoute(config.jira));

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
