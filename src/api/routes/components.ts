import { Router, Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import {
  createComponent,
  getComponent,
  updateComponent,
  deleteComponent,
  listComponentsByProject,
  getComponentTests,
  saveComponentTests,
} from '../../storage/component-store';
import { getProject, addComponentToProject, removeComponentFromProject } from '../../storage/project-store';
import { getPage, listPagesByComponent } from '../../storage/page-store';
import { getJob, saveJob, updateJob, listJobs } from '../../storage/job-store';
import { deduplicateScenarios } from '../../pipeline/deduplicator';
import { generateModuleLevelTests } from '../../pipeline/module-test-generator';
import logger, { createContextLogger } from '../../utils/logger';
import { generateTestId } from '../../utils/uuid-generator';
import { ScenarioWithSource } from '../../models/batch-job';
import { Job, JobSummary } from '../../models/job';

const router = Router();

const createComponentSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
  description: Joi.string().max(1000).optional(),
});

const updateComponentSchema = Joi.object({
  name: Joi.string().min(1).max(200).optional(),
  description: Joi.string().max(1000).optional(),
});

const MAX_INTEGRATION_TESTS = 20;

// GET /api/projects/:projectId/components - List components in project
router.get('/project/:projectId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await getProject(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found', project_id: projectId });
      return;
    }

    const components = await listComponentsByProject(projectId);
    res.json({ total: components.length, components });
  } catch (error) {
    next(error);
  }
});

// POST /api/projects/:projectId/components - Create component in project
router.post('/project/:projectId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { projectId } = req.params;
    const { error, value } = createComponentSchema.validate(req.body);

    if (error) {
      res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => d.message),
      });
      return;
    }

    const project = await getProject(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found', project_id: projectId });
      return;
    }

    const component = await createComponent(projectId, value);
    await addComponentToProject(projectId, component.component_id);

    logger.info('Component created via API', {
      component_id: component.component_id,
      project_id: projectId,
    });

    res.status(201).json(component);
  } catch (error) {
    next(error);
  }
});

// GET /api/components/:id - Get component with pages
router.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const component = await getComponent(id);

    if (!component) {
      res.status(404).json({ error: 'Component not found', component_id: id });
      return;
    }

    // Get page summaries
    const pages = await listPagesByComponent(id);

    res.json({
      ...component,
      pages,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/components/:id - Update component
router.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { error, value } = updateComponentSchema.validate(req.body);

    if (error) {
      res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => d.message),
      });
      return;
    }

    const component = await updateComponent(id, value);
    res.json(component);
  } catch (error) {
    if ((error as Error).message.includes('not found')) {
      res.status(404).json({ error: (error as Error).message });
      return;
    }
    next(error);
  }
});

// DELETE /api/components/:id - Delete component (cascade)
router.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const component = await getComponent(id);
    if (!component) {
      res.status(404).json({ error: 'Component not found', component_id: id });
      return;
    }

    // Remove from project first
    await removeComponentFromProject(component.project_id, id);

    // Then delete component (cascade deletes pages)
    await deleteComponent(id);

    res.json({ message: 'Component deleted', component_id: id });
  } catch (error) {
    next(error);
  }
});

// GET /api/components/:id/tests - Get component-level tests
router.get('/:id/tests', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const component = await getComponent(id);
    if (!component) {
      res.status(404).json({ error: 'Component not found', component_id: id });
      return;
    }

    const scenarios = await getComponentTests(id);
    res.json({
      component_id: id,
      total: scenarios.length,
      scenarios,
      generated_at: component.component_tests?.generated_at,
      batch_job_id: component.component_tests?.batch_job_id,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/components/:id/tests/:testId - Update a component-level test scenario
router.patch('/:id/tests/:testId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, testId } = req.params;
    const updates = req.body || {};

    const component = await getComponent(id);
    if (!component) {
      res.status(404).json({ error: 'Component not found', component_id: id });
      return;
    }

    const scenarios = await getComponentTests(id);
    const scenario = scenarios.find(s => s.test_id === testId);
    if (!scenario) {
      res.status(404).json({ error: 'Scenario not found', test_id: testId });
      return;
    }

    // Apply updates
    const allowedTestTypes = ['functional', 'regression', 'smoke'];
    const allowedClassifications = ['happy_path', 'negative', 'edge_case'];
    const allowedPriorities = ['critical', 'high', 'medium', 'low'];
    const allowedAutomation = ['ready_for_automation', 'automation_not_needed'];

    if (updates.test_name !== undefined) {
      scenario.test_name = String(updates.test_name).trim();
    }
    if (updates.test_type !== undefined && allowedTestTypes.includes(updates.test_type)) {
      scenario.test_type = updates.test_type;
    }
    if (updates.scenario_classification !== undefined && allowedClassifications.includes(updates.scenario_classification)) {
      scenario.scenario_classification = updates.scenario_classification;
    }
    if (updates.priority !== undefined && allowedPriorities.includes(updates.priority)) {
      scenario.priority = updates.priority;
    }
    if (updates.automation_status !== undefined && allowedAutomation.includes(updates.automation_status)) {
      scenario.automation_status = updates.automation_status;
    }
    if (updates.description !== undefined) {
      scenario.description = String(updates.description).trim();
    }
    if (updates.test_repository_folder !== undefined) {
      scenario.test_repository_folder = String(updates.test_repository_folder).trim();
    }
    if (updates.validation_notes !== undefined) {
      scenario.validation_notes = String(updates.validation_notes).trim();
    }
    if (updates.preconditions !== undefined && Array.isArray(updates.preconditions)) {
      scenario.preconditions = updates.preconditions.map((p: string) => String(p).trim()).filter(Boolean);
    }
    if (updates.test_steps !== undefined && Array.isArray(updates.test_steps)) {
      scenario.test_steps = updates.test_steps.map((step: any, idx: number) => ({
        step_number: step.step_number ?? idx + 1,
        action: String(step.action || '').trim(),
        input: String(step.input || '').trim(),
        expected_result: String(step.expected_result || '').trim(),
      }));
    }

    // Save updated scenarios
    await saveComponentTests(id, scenarios, component.component_tests?.batch_job_id || generateTestId());

    logger.info('Component scenario updated', {
      component_id: id,
      test_id: testId,
    });

    res.json({ message: 'Scenario updated', test_id: testId });
  } catch (error) {
    next(error);
  }
});

// POST /api/components/:id/tests/:testId/validate - Update validation status
router.post('/:id/tests/:testId/validate', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, testId } = req.params;
    const { validation_status, validation_notes } = req.body;

    const component = await getComponent(id);
    if (!component) {
      res.status(404).json({ error: 'Component not found', component_id: id });
      return;
    }

    const scenarios = await getComponentTests(id);
    const scenario = scenarios.find(s => s.test_id === testId);
    if (!scenario) {
      res.status(404).json({ error: 'Scenario not found', test_id: testId });
      return;
    }

    const allowedStatuses = ['validated', 'needs_review', 'dismissed'];
    if (!allowedStatuses.includes(validation_status)) {
      res.status(400).json({ error: 'Invalid validation_status', allowed: allowedStatuses });
      return;
    }

    scenario.validation_status = validation_status;
    if (validation_notes) {
      scenario.validation_notes = String(validation_notes).trim();
    }

    await saveComponentTests(id, scenarios, component.component_tests?.batch_job_id || generateTestId());

    logger.info('Component scenario validation updated', {
      component_id: id,
      test_id: testId,
      validation_status,
    });

    res.json({ message: 'Validation updated', test_id: testId, validation_status });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/components/:id/tests - Delete all component-level test scenarios
router.delete('/:id/tests', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const component = await getComponent(id);
    if (!component) {
      res.status(404).json({ error: 'Component not found', component_id: id });
      return;
    }

    const scenarios = await getComponentTests(id);
    const deletedCount = scenarios.length;

    if (deletedCount === 0) {
      res.json({ message: 'No tests to delete', component_id: id, deleted_count: 0 });
      return;
    }

    // Clear all scenarios
    await saveComponentTests(id, [], component.component_tests?.batch_job_id || generateTestId());

    logger.info('All component scenarios deleted', {
      component_id: id,
      deleted_count: deletedCount,
    });

    res.json({ message: 'All scenarios deleted', component_id: id, deleted_count: deletedCount });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/components/:id/tests/:testId - Delete a component-level test scenario
router.delete('/:id/tests/:testId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, testId } = req.params;

    const component = await getComponent(id);
    if (!component) {
      res.status(404).json({ error: 'Component not found', component_id: id });
      return;
    }

    const scenarios = await getComponentTests(id);
    const scenarioIndex = scenarios.findIndex(s => s.test_id === testId);
    if (scenarioIndex === -1) {
      res.status(404).json({ error: 'Scenario not found', test_id: testId });
      return;
    }

    scenarios.splice(scenarioIndex, 1);

    await saveComponentTests(id, scenarios, component.component_tests?.batch_job_id || generateTestId());

    logger.info('Component scenario deleted', {
      component_id: id,
      test_id: testId,
    });

    res.json({ message: 'Scenario deleted', test_id: testId });
  } catch (error) {
    next(error);
  }
});

// GET /api/components/:id/jobs - Get job history for component
router.get('/:id/jobs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const component = await getComponent(id);
    if (!component) {
      res.status(404).json({ error: 'Component not found', component_id: id });
      return;
    }

    // Get all jobs
    const { jobs: allJobs } = await listJobs();

    // Read full job data to filter by component_id
    const jobsForComponent: JobSummary[] = [];
    for (const jobSummary of allJobs) {
      const fullJob = await getJob(jobSummary.job_id);
      if (fullJob && fullJob.component_id === id) {
        jobsForComponent.push(jobSummary);
      }
    }

    // Sort by created_at descending
    jobsForComponent.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Limit to last 20 jobs
    const limitedJobs = jobsForComponent.slice(0, 20);

    res.json({ total: limitedJobs.length, jobs: limitedJobs });
  } catch (error) {
    next(error);
  }
});

// POST /api/components/:id/generate - Generate integration tests
router.post('/:id/generate', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const component = await getComponent(id);
    if (!component) {
      res.status(404).json({ error: 'Component not found', component_id: id });
      return;
    }

    // Get all pages in this component
    const pages = await listPagesByComponent(id);

    if (pages.length === 0) {
      res.status(400).json({
        error: 'Component has no pages',
        message: 'Add pages to the component before generating integration tests',
      });
      return;
    }

    const maxTests = parseMaxTests(req.body?.max_tests);
    const jobId = generateTestId();

    // Create job entry for tracking
    const job: Job = {
      job_id: jobId,
      status: 'processing',
      input: {
        title: `Integration tests for ${component.name}`,
        description: `Generating integration tests for component ${component.name} with ${pages.length} pages`,
        metadata: {
          system_type: 'web',
          feature_priority: 'medium',
          parent_jira_issue_id: '',
        },
      },
      created_at: new Date().toISOString(),
      component_id: id,
      project_id: component.project_id,
    };

    await saveJob(job);

    res.status(202).json({
      message: 'Integration test generation started',
      component_id: id,
      page_count: pages.length,
      job_id: jobId,
      max_tests: maxTests,
    });

    processComponentIntegrationAsync(id, jobId, maxTests);
  } catch (error) {
    next(error);
  }
});

export default router;

async function processComponentIntegrationAsync(
  componentId: string,
  jobId: string,
  maxScenarios?: number
): Promise<void> {
  const contextLogger = createContextLogger({
    step: 'component-integration',
    component_id: componentId,
    job_id: jobId,
    max_scenarios: maxScenarios,
  });

  try {
    const component = await getComponent(componentId);
    if (!component) {
      throw new Error(`Component not found: ${componentId}`);
    }

    const pages = await listPagesByComponent(componentId);
    const scenarioSources: ScenarioWithSource[] = [];

    for (const pageSummary of pages) {
      const page = await getPage(pageSummary.page_id);
      if (!page?.latest_job_id) {
        continue;
      }

      const job = await getJob(page.latest_job_id);
      const scenarios = job?.results?.scenarios || [];

      if (scenarios.length === 0) {
        continue;
      }

      const sourcePage = page.confluence_link || page.confluence_page_id || page.page_id;
      for (const scenario of scenarios) {
        scenarioSources.push({
          scenario,
          source_page_id: sourcePage,
          source_job_id: page.latest_job_id,
          source_page_name: page.name,
        });
      }
    }

    if (scenarioSources.length === 0) {
      contextLogger.warn('No page-level scenarios available for integration generation', {
        component_id: componentId,
      });

      // Update job as completed with 0 scenarios
      await updateJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        results: {
          total_scenarios: 0,
          validated_scenarios: 0,
          needs_review_scenarios: 0,
          scenarios: [],
        },
      });
      return;
    }

    contextLogger.info('Collected page-level scenarios for integration generation', {
      component_id: componentId,
      scenario_count: scenarioSources.length,
    });

    const { uniqueScenarios } = await deduplicateScenarios(
      scenarioSources,
      jobId,
      contextLogger
    );

    const moduleScenarios = await generateModuleLevelTests(
      uniqueScenarios,
      null,
      jobId,
      contextLogger,
      maxScenarios
    );

    if (moduleScenarios.length === 0) {
      contextLogger.warn('No integration scenarios generated', {
        component_id: componentId,
      });

      // Update job as completed with 0 scenarios
      await updateJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        results: {
          total_scenarios: 0,
          validated_scenarios: 0,
          needs_review_scenarios: 0,
          scenarios: [],
        },
      });
      return;
    }

    await saveComponentTests(componentId, moduleScenarios, jobId);

    // Update job as completed
    const validatedCount = moduleScenarios.filter(s => s.validation_status === 'validated').length;
    const needsReviewCount = moduleScenarios.filter(s => s.validation_status === 'needs_review').length;

    await updateJob(jobId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      results: {
        total_scenarios: moduleScenarios.length,
        validated_scenarios: validatedCount,
        needs_review_scenarios: needsReviewCount,
        scenarios: moduleScenarios,
      },
    });

    contextLogger.info('Component integration tests saved', {
      component_id: componentId,
      scenario_count: moduleScenarios.length,
    });
  } catch (error) {
    contextLogger.error('Component integration generation failed', {
      component_id: componentId,
      error: (error as Error).message,
    });

    // Update job as failed
    try {
      await updateJob(jobId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: (error as Error).message,
      });
    } catch (updateError) {
      contextLogger.error('Failed to update job status', {
        job_id: jobId,
        error: (updateError as Error).message,
      });
    }
  }
}

function parseMaxTests(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const parsed = typeof value === 'number'
    ? Math.floor(value)
    : parseInt(String(value), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.min(parsed, MAX_INTEGRATION_TESTS);
}
