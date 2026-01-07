import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { ConfluenceConfig, JiraConfig } from '../../models/config';
import { fetchConfluencePage } from '../../integrations/confluence-client';
import { executePipeline } from '../../pipeline/pipeline-orchestrator';
import { saveJob, updateJob } from '../../storage/job-store';
import { generateJobId } from '../../utils/uuid-generator';
import { Job } from '../../models/job';
import { ApiError } from '../middleware/error-handler';
import { webhookRateLimiter } from '../middleware/rate-limiter';
import logger from '../../utils/logger';

const router = Router();

export function createWebhookRoute(
  webhookSecret: string,
  confluenceConfig: ConfluenceConfig,
  jiraConfig: JiraConfig
): Router {
  router.post('/', webhookRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const signature = req.headers['x-hub-signature'] as string;

      if (!verifySignature(req.body, signature, webhookSecret)) {
        throw new ApiError('Invalid webhook signature', 401);
      }

      const { event, page } = req.body;

      if (!page || !page.space || !page.space.key) {
        throw new ApiError('Invalid webhook payload', 400);
      }

      const spaceKey = page.space.key;

      if (!confluenceConfig.monitored_spaces.includes(spaceKey)) {
        return res.status(200).json({ message: 'Webhook received' });
      }

      logger.info('Processing Confluence webhook', {
        event,
        page_id: page.id,
        space_key: spaceKey,
      });

      res.status(200).json({
        message: 'Webhook received',
        job_id: 'processing',
      });

      processWebhookAsync(page.id, jiraConfig);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function verifySignature(payload: any, signature: string | undefined, secret: string): boolean {
  if (!signature) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(JSON.stringify(payload)).digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

async function processWebhookAsync(pageId: string, jiraConfig: JiraConfig): Promise<void> {
  try {
    const specificationInput = await fetchConfluencePage(pageId);

    if (!specificationInput) {
      logger.error('Failed to fetch Confluence page from webhook', { page_id: pageId });
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

    const results = await executePipeline(specificationInput, jiraConfig, jobId);

    await updateJob(jobId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      results,
    });

    logger.info('Webhook job completed', { job_id: jobId, page_id: pageId });
  } catch (error) {
    logger.error('Webhook job failed', {
      page_id: pageId,
      error: (error as Error).message,
    });
  }
}

export default router;
