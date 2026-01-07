import cron from 'node-cron';
import { AppConfig } from '../models/config';
import { searchConfluencePages, fetchConfluencePage } from '../integrations/confluence-client';
import { executePipeline } from '../pipeline/pipeline-orchestrator';
import { saveJob, updateJob } from '../storage/job-store';
import { readSchedulerState, saveSchedulerState } from '../storage/file-manager';
import { generateJobId } from '../utils/uuid-generator';
import { Job } from '../models/job';
import logger, { createContextLogger } from '../utils/logger';

export function initializeScheduledMode(config: AppConfig): cron.ScheduledTask | null {
  const contextLogger = createContextLogger({ step: 'scheduled-init' });

  if (!config.executionModes.scheduled.enabled) {
    logger.info('Scheduled mode disabled');
    return null;
  }

  logger.info('Initializing Scheduled mode', {
    cron_expression: config.executionModes.scheduled.cron_expression,
  });

  if (!cron.validate(config.executionModes.scheduled.cron_expression)) {
    contextLogger.fatal('Invalid cron expression', {
      cron_expression: config.executionModes.scheduled.cron_expression,
    });
    throw new Error('Invalid cron expression for scheduled mode');
  }

  const task = cron.schedule(config.executionModes.scheduled.cron_expression, async () => {
    await runScheduledTask(config);
  });

  logger.info('Scheduled mode initialized');

  return task;
}

async function runScheduledTask(config: AppConfig): Promise<void> {
  logger.info('Running scheduled task');

  try {
    const schedulerState = await readSchedulerState();
    const lastRun = schedulerState?.last_run ? new Date(schedulerState.last_run) : undefined;

    const pageIds = await searchConfluencePages(config.confluence, lastRun);

    logger.info('Scheduled task found pages', { page_count: pageIds.length });

    for (const pageId of pageIds) {
      await processScheduledPage(pageId, config);
    }

    await saveSchedulerState(new Date().toISOString());

    logger.info('Scheduled task completed', { pages_processed: pageIds.length });
  } catch (error) {
    logger.error('Scheduled task failed', {
      error: (error as Error).message,
    });
  }
}

async function processScheduledPage(pageId: string, config: AppConfig): Promise<void> {
  try {
    const specificationInput = await fetchConfluencePage(pageId);

    if (!specificationInput) {
      logger.error('Failed to fetch Confluence page in scheduled task', { page_id: pageId });
      return;
    }

    const jobId = generateJobId();

    const job: Job = {
      job_id: jobId,
      status: 'processing',
      input: specificationInput,
      created_at: new Date().toISOString(),
    };

    await saveJob(job);

    const results = await executePipeline(specificationInput, config.jira, jobId);

    await updateJob(jobId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      results,
    });

    logger.info('Scheduled page processed successfully', {
      job_id: jobId,
      page_id: pageId,
    });
  } catch (error) {
    logger.error('Failed to process scheduled page', {
      page_id: pageId,
      error: (error as Error).message,
    });
  }
}
