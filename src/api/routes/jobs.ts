import { Router, Request, Response, NextFunction } from 'express';
import { listJobs, deleteJob, getJob, updateJob, createJob } from '../../storage/job-store';
import { ApiError } from '../middleware/error-handler';
import { generateJobId } from '../../utils/uuid-generator';
import logger from '../../utils/logger';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const { status, limit = '50', offset = '0', since } = req.query;

  try {
    const limitNum = parseInt(limit as string, 10);
    const offsetNum = parseInt(offset as string, 10);

    if (limitNum > 200) {
      throw new ApiError('Limit cannot exceed 200', 400);
    }

    const filters: any = {};
    if (status) {
      filters.status = status;
    }
    if (since) {
      filters.since = since as string;
    }

    const result = await listJobs(filters, {
      limit: limitNum,
      offset: offsetNum,
    });

    res.json({
      total: result.total,
      limit: limitNum,
      offset: offsetNum,
      jobs: result.jobs,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  const { jobId } = req.params;

  try {
    const job = await getJob(jobId);

    if (!job) {
      throw new ApiError(`Job not found: ${jobId}`, 404);
    }

    res.json({
      job_id: job.job_id,
      status: job.status,
      created_at: job.created_at,
      completed_at: job.completed_at,
      results: job.results,
      error: job.error,
      component_id: job.component_id,
      project_id: job.project_id,
      page_id: job.page_id,
      input: job.input,
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  const { jobId } = req.params;

  try {
    const job = await getJob(jobId);

    if (!job) {
      throw new ApiError(`Job not found: ${jobId}`, 404);
    }

    if (job.status === 'processing') {
      throw new ApiError('Cannot delete job in processing state', 400);
    }

    const deletedFiles = await deleteJob(jobId);

    res.json({
      message: 'Job deleted successfully',
      deleted_files: deletedFiles,
    });
  } catch (error) {
    next(error);
  }
});

// Cancel a processing job
router.post('/:jobId/cancel', async (req: Request, res: Response, next: NextFunction) => {
  const { jobId } = req.params;

  try {
    const job = await getJob(jobId);

    if (!job) {
      throw new ApiError(`Job not found: ${jobId}`, 404);
    }

    if (job.status !== 'processing') {
      throw new ApiError('Only processing jobs can be cancelled', 400);
    }

    await updateJob(jobId, {
      status: 'cancelled',
      completed_at: new Date().toISOString(),
      error: 'Job cancelled by user',
    });

    logger.info('Job cancelled', { job_id: jobId });

    res.json({
      message: 'Job cancelled',
      job_id: jobId,
    });
  } catch (error) {
    next(error);
  }
});

// Retry a failed/cancelled job by creating a new one with the same input
router.post('/:jobId/retry', async (req: Request, res: Response, next: NextFunction) => {
  const { jobId } = req.params;

  try {
    const originalJob = await getJob(jobId);

    if (!originalJob) {
      throw new ApiError(`Job not found: ${jobId}`, 404);
    }

    if (originalJob.status === 'processing') {
      throw new ApiError('Cannot retry a job that is still processing', 400);
    }

    const newJobId = generateJobId();
    const newJob = await createJob({
      job_id: newJobId,
      status: 'processing',
      input: originalJob.input,
      project_id: originalJob.project_id,
      component_id: originalJob.component_id,
      page_id: originalJob.page_id,
      document_id: originalJob.document_id,
    });

    logger.info('Job retry created', {
      original_job_id: jobId,
      new_job_id: newJobId,
    });

    res.status(202).json({
      message: 'Retry job created',
      original_job_id: jobId,
      new_job_id: newJob.job_id,
      status: 'processing',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
