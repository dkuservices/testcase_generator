import path from 'path';
import { Router, Request, Response, NextFunction } from 'express';
import { readJSON, listFiles, writeJSON, fileExists } from '../../storage/json-storage';
import { Job } from '../../models/job';
import { ApiError } from '../middleware/error-handler';
import { generateUUID } from '../../utils/uuid-generator';
import logger from '../../utils/logger';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const statusFilter = (req.query.status as string) || 'needs_review';
  const includeDismissed = statusFilter === 'all';
  const dismissedOnly = statusFilter === 'dismissed';

  try {
    const jobsDir = path.join(process.cwd(), 'data', 'jobs');
    if (!(await fileExists(jobsDir))) {
      res.json({ total: 0, scenarios: [] });
      return;
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
            job_status: job.status,
            source_title: job.input.title,
            source_link: job.input.link,
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

// DELETE all needs_review scenarios (for testing purposes)
router.delete('/clean', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const jobsDir = path.join(process.cwd(), 'data', 'jobs');
    if (!(await fileExists(jobsDir))) {
      res.json({ message: 'No jobs found', cleaned: 0 });
      return;
    }

    const files = await listFiles(jobsDir, '.json');
    let cleanedCount = 0;
    let modifiedJobs = 0;

    for (const file of files) {
      const jobPath = path.join(jobsDir, file);
      let job: Job;
      try {
        job = await readJSON<Job>(jobPath);
      } catch (error) {
        logger.warn('Failed to read job for cleaning', {
          file,
          error: (error as Error).message,
        });
        continue;
      }

      if (!job.results?.scenarios) {
        continue;
      }

      const originalCount = job.results.scenarios.length;
      // Filter out needs_review scenarios
      job.results.scenarios = job.results.scenarios.filter(
        s => s.validation_status !== 'needs_review'
      );

      const removedFromJob = originalCount - job.results.scenarios.length;
      if (removedFromJob > 0) {
        // Update counts
        job.results.needs_review_scenarios = job.results.scenarios.filter(
          s => s.validation_status === 'needs_review'
        ).length;
        job.results.validated_scenarios = job.results.scenarios.filter(
          s => s.validation_status === 'validated'
        ).length;
        job.results.total_scenarios = job.results.scenarios.length;

        await writeJSON(jobPath, job);
        cleanedCount += removedFromJob;
        modifiedJobs++;
      }
    }

    logger.info('Cleaned needs_review scenarios', {
      cleaned_count: cleanedCount,
      modified_jobs: modifiedJobs,
    });

    res.json({
      message: 'Cleaned all needs_review scenarios',
      cleaned: cleanedCount,
      jobs_modified: modifiedJobs,
    });
  } catch (error) {
    next(error);
  }
});

// Bulk accept/dismiss scenarios
router.post('/bulk', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { action, test_ids } = req.body || {};

  if (!action || !['accept', 'dismiss'].includes(action)) {
    res.status(400).json({ error: 'Invalid action. Must be "accept" or "dismiss".' });
    return;
  }

  if (!Array.isArray(test_ids) || test_ids.length === 0) {
    res.status(400).json({ error: 'test_ids must be a non-empty array of {job_id, test_id}.' });
    return;
  }

  const newStatus = action === 'accept' ? 'validated' : 'dismissed';

  try {
    const jobsDir = path.join(process.cwd(), 'data', 'jobs');

    // Group by job_id to minimize file reads
    const grouped = new Map<string, string[]>();
    for (const item of test_ids) {
      if (!item.job_id || !item.test_id) continue;
      const list = grouped.get(item.job_id) || [];
      list.push(item.test_id);
      grouped.set(item.job_id, list);
    }

    let updated = 0;
    let failed = 0;

    for (const [jobId, testIds] of grouped) {
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      if (!(await fileExists(jobPath))) {
        failed += testIds.length;
        continue;
      }

      let job: Job;
      try {
        job = await readJSON<Job>(jobPath);
      } catch {
        failed += testIds.length;
        continue;
      }

      if (!job.results?.scenarios) {
        failed += testIds.length;
        continue;
      }

      let jobModified = false;
      for (const testId of testIds) {
        const scenario = job.results.scenarios.find(s => s.test_id === testId);
        if (scenario) {
          scenario.validation_status = newStatus;
          if (action === 'dismiss') {
            scenario.validation_notes = (scenario.validation_notes || '') +
              (scenario.validation_notes ? '; ' : '') + 'Bulk dismissed via review UI';
          }
          updated++;
          jobModified = true;
        } else {
          failed++;
        }
      }

      if (jobModified) {
        // Recalculate counts
        job.results.validated_scenarios = job.results.scenarios.filter(
          s => s.validation_status === 'validated'
        ).length;
        job.results.needs_review_scenarios = job.results.scenarios.filter(
          s => s.validation_status === 'needs_review'
        ).length;
        job.results.total_scenarios = job.results.scenarios.length;
        await writeJSON(jobPath, job);
      }
    }

    logger.info('Bulk review action', { action, updated, failed });

    res.json({ updated, failed });
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
    if (updates.description !== undefined) {
      scenario.description = String(updates.description).trim();
    }
    if (updates.preconditions !== undefined) {
      if (Array.isArray(updates.preconditions)) {
        scenario.preconditions = updates.preconditions.map((item: string) => String(item).trim()).filter(Boolean);
      } else if (typeof updates.preconditions === 'string') {
        scenario.preconditions = updates.preconditions.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
      } else {
        throw new ApiError('Invalid preconditions value', 400);
      }
    }
    if (updates.test_steps !== undefined) {
      if (Array.isArray(updates.test_steps)) {
        // Handle array of TestStep objects
        scenario.test_steps = updates.test_steps.map((step: any, idx: number) => ({
          step_number: step.step_number ?? idx + 1,
          action: String(step.action || '').trim(),
          input: String(step.input || '').trim(),
          expected_result: String(step.expected_result || '').trim(),
        }));
      } else {
        throw new ApiError('Invalid test_steps value - must be array of step objects', 400);
      }
    }
    if (updates.automation_status !== undefined) {
      const allowedStatuses = ['ready_for_automation', 'automation_not_needed'];
      if (!allowedStatuses.includes(updates.automation_status)) {
        throw new ApiError('Invalid automation_status value', 400);
      }
      scenario.automation_status = updates.automation_status;
    }
    if (updates.test_repository_folder !== undefined) {
      scenario.test_repository_folder = String(updates.test_repository_folder).trim();
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

// Add a comment to a specific scenario
router.post('/:jobId/:testId/comments', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { jobId, testId } = req.params;
  const { author, content } = req.body || {};

  if (!author || typeof author !== 'string' || !author.trim()) {
    res.status(400).json({ error: 'author is required' });
    return;
  }

  if (!content || typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  if (content.length > 2000) {
    res.status(400).json({ error: 'content must not exceed 2000 characters' });
    return;
  }

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

    if (!scenario.comments) {
      scenario.comments = [];
    }

    const comment = {
      id: generateUUID(),
      author: author.trim(),
      content: content.trim(),
      created_at: new Date().toISOString(),
    };

    scenario.comments.push(comment);
    await writeJSON(jobPath, job);

    logger.info('Comment added to scenario', {
      job_id: jobId,
      test_id: testId,
      comment_id: comment.id,
    });

    res.status(201).json(comment);
  } catch (error) {
    next(error);
  }
});

export default router;
