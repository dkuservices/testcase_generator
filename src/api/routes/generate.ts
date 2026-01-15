import { Router, Request, Response, NextFunction } from 'express';
import { SpecificationInput } from '../../models/specification-input';
import { Job } from '../../models/job';
import { JiraConfig } from '../../models/config';
import { executePipeline } from '../../pipeline/pipeline-orchestrator';
import { saveJob, updateJob } from '../../storage/job-store';
import { generateJobId } from '../../utils/uuid-generator';
import { validateGenerateRequest } from '../middleware/request-validator';
import { fetchConfluencePage } from '../../integrations/confluence-client';
import { extractPageIdFromUrl, isValidConfluenceUrl } from '../../utils/confluence-url-parser';
import logger from '../../utils/logger';

const router = Router();

export function createGenerateRoute(jiraConfig: JiraConfig): Router {
  router.post('/', validateGenerateRequest, async (req: Request, res: Response, next: NextFunction) => {
    const input: SpecificationInput = req.body;

    const jobId = generateJobId();

    const job: Job = {
      job_id: jobId,
      status: 'processing',
      input,
      created_at: new Date().toISOString(),
    };

    try {
      await saveJob(job);

      res.status(202).json({
        job_id: jobId,
        status: 'processing',
        message: 'Test scenario generation started',
        created_at: job.created_at,
      });

      processJobAsync(jobId, input, jiraConfig);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function processJobAsync(jobId: string, input: SpecificationInput, jiraConfig: JiraConfig): Promise<void> {
  try {
    logger.info('Starting async job processing', { job_id: jobId });

    // If input contains a link, fetch the Confluence page content
    let processedInput = input;
    if (input.link) {
      logger.info('Processing link-based input', { job_id: jobId, link: input.link });
      
      // Validate the Confluence URL
      if (!isValidConfluenceUrl(input.link)) {
        throw new Error(`Invalid Confluence URL: ${input.link}`);
      }
      
      // Extract page ID from the URL
      const pageId = extractPageIdFromUrl(input.link);
      if (!pageId) {
        throw new Error(`Could not extract page ID from URL: ${input.link}`);
      }
      
      // Fetch the Confluence page content
      const confluenceData = await fetchConfluencePage(pageId);
      if (!confluenceData) {
        throw new Error(`Failed to fetch Confluence page with ID: ${pageId}`);
      }
      
      // Use the fetched data as the processed input
      processedInput = confluenceData;
      
      logger.info('Successfully fetched Confluence page content', { 
        job_id: jobId, 
        page_id: pageId,
        title: confluenceData.title 
      });
    }

    const results = await executePipeline(processedInput, jiraConfig, jobId);

    await updateJob(jobId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      results,
    });

    logger.info('Job completed successfully', { job_id: jobId });
  } catch (error) {
    logger.error('Job failed', {
      job_id: jobId,
      error: (error as Error).message,
    });

    await updateJob(jobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: (error as Error).message,
    });
  }
}
