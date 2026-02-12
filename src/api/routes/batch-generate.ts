import { Router, Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { BatchJob, BatchJobOptions } from '../../models/batch-job';
import { JiraConfig } from '../../models/config';
import { generateTestId } from '../../utils/uuid-generator';
import { saveBatchJob } from '../../storage/batch-job-store';
import { executeBatchPipeline } from '../../pipeline/batch-orchestrator';
import logger from '../../utils/logger';

const router = Router();

const batchRequestSchema = Joi.object({
  links: Joi.array()
    .items(Joi.string().uri().required())
    .min(2)
    .max(parseInt(process.env.BATCH_MAX_PAGES_PER_BATCH || '20', 10))
    .required()
    .messages({
      'array.min': 'Batch requests must include at least 2 Confluence links',
      'array.max': `Batch requests cannot exceed ${process.env.BATCH_MAX_PAGES_PER_BATCH || 20} pages`,
    }),
  generate_page_level_tests: Joi.boolean().default(true),
  generate_module_level_tests: Joi.boolean().default(true),
});

export function createBatchGenerateRoute(jiraConfig: JiraConfig): Router {
  router.post(
    '/',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        // Validate request body
        const { error, value } = batchRequestSchema.validate(req.body);
        if (error) {
          res.status(400).json({
            error: 'Validation failed',
            details: error.details.map(d => d.message),
          });
          return;
        }

        const options: BatchJobOptions = value;

        // Validate at least one generation option is enabled
        if (!options.generate_page_level_tests && !options.generate_module_level_tests) {
          res.status(400).json({
            error: 'At least one generation option must be enabled',
          });
          return;
        }

        const batchJobId = generateTestId();

        const batchJob: BatchJob = {
          batch_job_id: batchJobId,
          status: 'processing',
          options,
          sub_jobs: [],
          created_at: new Date().toISOString(),
        };

        await saveBatchJob(batchJob);

        // Return 202 Accepted immediately
        res.status(202).json({
          batch_job_id: batchJobId,
          status: 'processing',
          message: 'Batch test scenario generation started',
          total_pages: options.links.length,
          created_at: batchJob.created_at,
        });

        // Process asynchronously
        processBatchJobAsync(batchJobId, options, jiraConfig);

      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

async function processBatchJobAsync(
  batchJobId: string,
  options: BatchJobOptions,
  jiraConfig: JiraConfig
): Promise<void> {
  try {
    logger.info('Starting async batch job processing', { batch_job_id: batchJobId });
    await executeBatchPipeline(batchJobId, options, jiraConfig);
    logger.info('Batch job completed successfully', { batch_job_id: batchJobId });
  } catch (error) {
    logger.error('Batch job failed', {
      batch_job_id: batchJobId,
      error: (error as Error).message,
    });
  }
}
