import { Router, Request, Response, NextFunction } from 'express';
import { getBatchJob } from '../../storage/batch-job-store';
import { getJobsBulk } from '../../storage/job-store';

const router = Router();

router.get('/:batchJobId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { batchJobId } = req.params;

  try {
    const batchJob = await getBatchJob(batchJobId);

    if (!batchJob) {
      res.status(404).json({
        error: 'Batch job not found',
        batch_job_id: batchJobId,
      });
      return;
    }

    // Get status of all sub-jobs in one bulk read
    const jobsMap = await getJobsBulk(batchJob.sub_jobs);
    const subJobStatuses = batchJob.sub_jobs.map(jobId => {
      const job = jobsMap.get(jobId);
      return {
        job_id: jobId,
        status: job?.status || 'unknown',
        link: job?.input.link || '',
        results: job?.results ? {
          total_scenarios: job.results.total_scenarios,
          validated_scenarios: job.results.validated_scenarios,
          needs_review_scenarios: job.results.needs_review_scenarios,
        } : null,
      };
    });

    const completedCount = subJobStatuses.filter(s => s.status === 'completed').length;
    const failedCount = subJobStatuses.filter(s => s.status === 'failed').length;

    res.json({
      batch_job_id: batchJob.batch_job_id,
      status: batchJob.status,
      created_at: batchJob.created_at,
      completed_at: batchJob.completed_at,
      options: batchJob.options,
      progress: {
        total_pages: batchJob.options.links.length,
        completed: completedCount,
        failed: failedCount,
        in_progress: batchJob.options.links.length - completedCount - failedCount,
      },
      sub_jobs: subJobStatuses,
      aggregation_results: batchJob.aggregation_results,
      error: batchJob.error,
    });

  } catch (error) {
    next(error);
  }
});

export default router;
