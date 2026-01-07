import { Router, Request, Response, NextFunction } from 'express';
import { getJob, updateJob } from '../../storage/job-store';
import { GeneratedTestScenario } from '../../models/test-scenario';
import { JiraConfig } from '../../models/config';
import { formatForJira } from '../../pipeline/jira-formatter';
import { ApiError } from '../middleware/error-handler';
import { validateValidationOverride } from '../middleware/request-validator';

const router = Router();

export function createValidateRoute(jiraConfig: JiraConfig): Router {
  router.post('/:jobId', validateValidationOverride, async (req: Request, res: Response, next: NextFunction) => {
    const { jobId } = req.params;
    const { test_id, validation_status, validation_notes } = req.body;

    try {
      const job = await getJob(jobId);

      if (!job) {
        throw new ApiError(`Job not found: ${jobId}`, 404);
      }

      if (!job.results?.scenarios) {
        throw new ApiError('Job has no scenarios', 400);
      }

      const scenario = job.results.scenarios.find(s => s.test_id === test_id);

      if (!scenario) {
        throw new ApiError(`Test scenario not found: ${test_id}`, 404);
      }

      scenario.validation_status = validation_status;
      if (validation_notes) {
        scenario.validation_notes = validation_notes;
      }

      const validatedCount = job.results.scenarios.filter(s => s.validation_status === 'validated').length;
      const needsReviewCount = job.results.scenarios.filter(s => s.validation_status === 'needs_review').length;

      job.results.validated_scenarios = validatedCount;
      job.results.needs_review_scenarios = needsReviewCount;

      await updateJob(jobId, { results: job.results });

      if (validation_status === 'validated') {
        const confluencePageId = job.input.confluence_page_id || 'manual-input';
        await formatForJira([scenario], jiraConfig, confluencePageId, jobId);
      }

      res.json({
        message: 'Validation status updated',
        test_id,
        new_status: validation_status,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
