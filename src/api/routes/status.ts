import { Router, Request, Response, NextFunction } from 'express';
import { getJob } from '../../storage/job-store';
import { ApiError } from '../middleware/error-handler';

const router = Router();

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
    });
  } catch (error) {
    next(error);
  }
});

export default router;
