import { Router, Request, Response, NextFunction } from 'express';
import { listJobs, deleteJob, getJob } from '../../storage/job-store';
import { ApiError } from '../middleware/error-handler';

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

export default router;
