import dotenv from 'dotenv';
import path from 'path';
import { readJSON } from './storage/json-storage';
import { AppConfig } from './models/config';
import { initializeManualMode } from './modes/manual';
import { initializeScheduledMode } from './modes/scheduled';
import { initializeEventDrivenMode } from './modes/event-driven';
import { initializeCostTracking } from './monitoring/cost-tracker';
import { initializeMetricsCollection } from './monitoring/metrics-collector';
import logger from './utils/logger';

dotenv.config();

async function main(): Promise<void> {
  logger.info('Starting AI Orchestrator Module 4.1');

  try {
    const config = await loadConfigurations();

    await validateConfigurations(config);

    const modes: string[] = [];

    if (config.executionModes.scheduled.enabled) {
      initializeScheduledMode(config);
      modes.push('scheduled');
    }

    if (config.executionModes.event_driven.enabled) {
      initializeEventDrivenMode(config);
      modes.push('event-driven');
    }

    if (config.executionModes.manual.enabled) {
      initializeManualMode(config);
      modes.push('manual');
    }

    initializeCostTracking(config.pricing);

    initializeMetricsCollection();

    logger.info('Service started successfully', {
      version: '1.0.0',
      modes: modes.join(', '),
      node_env: process.env.NODE_ENV,
    });

    process.on('SIGTERM', () => gracefulShutdown());
    process.on('SIGINT', () => gracefulShutdown());
  } catch (error) {
    logger.fatal('Fatal error during startup', {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    process.exit(1);
  }
}

async function loadConfigurations(): Promise<AppConfig> {
  logger.info('Loading configurations');

  const configDir = path.join(process.cwd(), 'config');

  const executionModes = await readJSON<any>(path.join(configDir, 'execution-modes.json'));
  const confluence = await readJSON<any>(path.join(configDir, 'confluence.json'));
  const jira = await readJSON<any>(path.join(configDir, 'jira.json'));
  const pricing = await readJSON<any>(path.join(configDir, 'pricing.json'));

  const config: AppConfig = {
    executionModes,
    confluence,
    jira,
    pricing,
  };

  logger.info('Configurations loaded successfully');

  return config;
}

async function validateConfigurations(config: AppConfig): Promise<void> {
  logger.info('Validating configurations');

  if (config.executionModes.manual.enabled || config.executionModes.event_driven.enabled) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
  }

  if (config.executionModes.scheduled.enabled || config.executionModes.event_driven.enabled) {
    if (!process.env.CONFLUENCE_BASE_URL || !process.env.CONFLUENCE_EMAIL || !process.env.CONFLUENCE_API_TOKEN) {
      throw new Error('Confluence credentials are required for scheduled or event-driven mode');
    }
  }

  if (!config.jira.project_key) {
    logger.warn('Jira project key not configured in config/jira.json');
  }

  const enabledModes = [
    config.executionModes.manual.enabled,
    config.executionModes.scheduled.enabled,
    config.executionModes.event_driven.enabled,
  ];

  if (!enabledModes.some(enabled => enabled)) {
    throw new Error('At least one execution mode must be enabled');
  }

  logger.info('Configurations validated successfully');
}

function gracefulShutdown(): void {
  logger.info('Received shutdown signal, shutting down gracefully');

  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error during startup:', error);
  process.exit(1);
});
