import path from 'path';
import { Router, Request, Response, NextFunction } from 'express';
import { readJSON, listFiles, writeJSON, fileExists } from '../../storage/json-storage';
import { Job } from '../../models/job';
import { ApiError } from '../middleware/error-handler';
import logger from '../../utils/logger';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const statusFilter = (req.query.status as string) || 'needs_review';
  const includeDismissed = statusFilter === 'all';
  const dismissedOnly = statusFilter === 'dismissed';

  try {
    const jobsDir = path.join(process.cwd(), 'data', 'jobs');
    if (!(await fileExists(jobsDir))) {
      return res.json({ total: 0, scenarios: [] });
    }
    const files = await listFiles(jobsDir, '.json');
    const scenarios: any[] = [];

    for (const file of files) {
      const jobPath = path.join(jobsDir, file);
      let job: Job;
      try {
        job = await readJSON<Job>(jobPath);
      } catch (error) {
        logger.warn('Failed to read job for review list', {
          file,
          error: (error as Error).message,
        });
        continue;
      }

      if (!job.results?.scenarios) {
        continue;
      }

      for (const scenario of job.results.scenarios) {
        if (
          (scenario.validation_status === 'needs_review' && !dismissedOnly) ||
          (scenario.validation_status === 'dismissed' && (includeDismissed || dismissedOnly))
        ) {
          scenarios.push({
            job_id: job.job_id,
            job_created_at: job.created_at,
            job_completed_at: job.completed_at,
            confluence_page_id: job.input.confluence_page_id || scenario.traceability?.source_confluence_page_id,
            parent_jira_issue_id: job.input.metadata?.parent_jira_issue_id || scenario.parent_jira_issue_id,
            scenario,
          });
        }
      }
    }

    scenarios.sort((a, b) => new Date(b.job_created_at).getTime() - new Date(a.job_created_at).getTime());

    res.json({
      total: scenarios.length,
      scenarios,
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/:jobId/:testId', async (req: Request, res: Response, next: NextFunction) => {
  const { jobId, testId } = req.params;
  const updates = req.body || {};

  try {
    const jobsDir = path.join(process.cwd(), 'data', 'jobs');
    const jobPath = path.join(jobsDir, `${jobId}.json`);
    if (!(await fileExists(jobPath))) {
      throw new ApiError(`Job not found: ${jobId}`, 404);
    }

    const job = await readJSON<Job>(jobPath);

    if (!job.results?.scenarios) {
      throw new ApiError('Job has no scenarios', 400);
    }

    const scenario = job.results.scenarios.find(s => s.test_id === testId);
    if (!scenario) {
      throw new ApiError(`Test scenario not found: ${testId}`, 404);
    }

    const allowedTestTypes = ['functional', 'regression', 'smoke'];
    const allowedClassifications = ['happy_path', 'negative', 'edge_case'];
    const allowedPriorities = ['critical', 'high', 'medium', 'low'];

    if (updates.test_name !== undefined) {
      scenario.test_name = String(updates.test_name).trim();
    }
    if (updates.test_type !== undefined) {
      if (!allowedTestTypes.includes(updates.test_type)) {
        throw new ApiError('Invalid test_type value', 400);
      }
      scenario.test_type = updates.test_type;
    }
    if (updates.scenario_classification !== undefined) {
      if (!allowedClassifications.includes(updates.scenario_classification)) {
        throw new ApiError('Invalid scenario_classification value', 400);
      }
      scenario.scenario_classification = updates.scenario_classification;
    }
    if (updates.preconditions !== undefined) {
      scenario.preconditions = String(updates.preconditions).trim();
    }
    if (updates.test_steps !== undefined) {
      if (Array.isArray(updates.test_steps)) {
        scenario.test_steps = updates.test_steps.map((step: any) => String(step).trim()).filter(Boolean);
      } else if (typeof updates.test_steps === 'string') {
        scenario.test_steps = updates.test_steps.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      } else {
        throw new ApiError('Invalid test_steps value', 400);
      }
    }
    if (updates.expected_result !== undefined) {
      scenario.expected_result = String(updates.expected_result).trim();
    }
    if (updates.priority !== undefined) {
      if (!allowedPriorities.includes(updates.priority)) {
        throw new ApiError('Invalid priority value', 400);
      }
      scenario.priority = updates.priority;
    }
    if (updates.validation_notes !== undefined) {
      scenario.validation_notes = String(updates.validation_notes).trim();
    }

    await writeJSON(jobPath, job);

    res.json({
      message: 'Scenario updated',
      test_id: testId,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
