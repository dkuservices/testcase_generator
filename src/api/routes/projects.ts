import { Router, Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import multer from 'multer';
import fs from 'fs/promises';
import {
  createProject,
  getProject,
  updateProject,
  deleteProject,
  listProjects,
  getProjectTests,
  saveProjectTests,
  saveProjectContext,
  deleteProjectContext,
  saveProjectManualFile,
} from '../../storage/project-store';
import { ProjectContext } from '../../models/project';
import { getComponent, listComponentsByProject } from '../../storage/component-store';
import { getPage, listPagesByComponent } from '../../storage/page-store';
import { getJob, saveJob, updateJob, listJobs } from '../../storage/job-store';
import { getDocument } from '../../storage/document-store';
import { deduplicateScenarios } from '../../pipeline/deduplicator';
import { generateProjectLevelTests, ComponentGroup } from '../../pipeline/project-test-generator';
import logger, { createContextLogger } from '../../utils/logger';
import { generateTestId } from '../../utils/uuid-generator';
import { ScenarioWithSource } from '../../models/batch-job';
import { Job, JobSummary } from '../../models/job';
import { getRelevantChunksForChangeRequests, buildContextFromChunks } from '../../pipeline/relevance-scorer';
import { parseDocument as parseContextDocument, isValidFileType as isValidContextFileType, getFileSizeMB } from '../../utils/document-parser';
import { chunkDocument, shouldChunkDocument } from '../../utils/document-chunker';
import { saveChunkedDocument, getChunksSummary } from '../../storage/chunk-store';
import chunkingConfig from '../../../config/chunking.json';

const router = Router();

const contextUpload = multer({
  dest: 'data/temp_uploads/',
  limits: {
    fileSize: chunkingConfig.upload_limit_mb * 1024 * 1024,
  },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (isValidContextFileType(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only docx, pdf, and txt files are allowed.'));
    }
  },
});

const createProjectSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
  description: Joi.string().max(1000).optional(),
  metadata: Joi.object({
    jira_project_key: Joi.string().optional(),
    system_type: Joi.string().valid('web', 'api', 'mobile').optional(),
  }).optional(),
});

const updateProjectSchema = Joi.object({
  name: Joi.string().min(1).max(200).optional(),
  description: Joi.string().max(1000).optional(),
  metadata: Joi.object({
    jira_project_key: Joi.string().optional(),
    system_type: Joi.string().valid('web', 'api', 'mobile').optional(),
  }).optional(),
});

const MAX_PROJECT_TESTS = 20;

// GET /api/projects - List all projects
router.get('/', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await listProjects();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /api/projects - Create a new project
router.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { error, value } = createProjectSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => d.message),
      });
      return;
    }

    const project = await createProject(value);
    logger.info('Project created via API', { project_id: project.project_id });

    res.status(201).json(project);
  } catch (error) {
    next(error);
  }
});

// GET /api/projects/:id - Get project with components
router.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const project = await getProject(id);

    if (!project) {
      res.status(404).json({ error: 'Project not found', project_id: id });
      return;
    }

    // Get component summaries
    const components = await listComponentsByProject(id);

    res.json({
      ...project,
      components,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/projects/:id - Update project
router.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { error, value } = updateProjectSchema.validate(req.body);

    if (error) {
      res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => d.message),
      });
      return;
    }

    const project = await updateProject(id, value);
    res.json(project);
  } catch (error) {
    if ((error as Error).message.includes('not found')) {
      res.status(404).json({ error: (error as Error).message });
      return;
    }
    next(error);
  }
});

// DELETE /api/projects/:id - Delete project (cascade)
router.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    await deleteProject(id);
    res.json({ message: 'Project deleted', project_id: id });
  } catch (error) {
    if ((error as Error).message.includes('not found')) {
      res.status(404).json({ error: (error as Error).message });
      return;
    }
    next(error);
  }
});

// ── Project-Level Cross-Module Tests ──────────────────────────────────

// GET /api/projects/:id/tests - Get project-level cross-module tests
router.get('/:id/tests', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const project = await getProject(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found', project_id: id });
      return;
    }

    const scenarios = await getProjectTests(id);
    res.json({
      project_id: id,
      total: scenarios.length,
      scenarios,
      generated_at: project.project_tests?.generated_at,
      batch_job_id: project.project_tests?.batch_job_id,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/projects/:id/generate - Generate cross-module tests (async)
router.post('/:id/generate', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const project = await getProject(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found', project_id: id });
      return;
    }

    const components = await listComponentsByProject(id);
    if (components.length === 0) {
      res.status(400).json({
        error: 'Project has no components',
        message: 'Add components with pages before generating cross-module tests',
      });
      return;
    }

    const maxTests = parseMaxTests(req.body?.max_tests);
    const jobId = generateTestId();

    const job: Job = {
      job_id: jobId,
      status: 'processing',
      input: {
        title: `Cross-module tests for ${project.name}`,
        description: `Generating cross-module tests for project ${project.name} with ${components.length} components`,
        metadata: {
          system_type: 'web',
          feature_priority: 'medium',
          parent_jira_issue_id: '',
        },
      },
      created_at: new Date().toISOString(),
      project_id: id,
    };

    await saveJob(job);

    res.status(202).json({
      message: 'Cross-module test generation started',
      project_id: id,
      component_count: components.length,
      job_id: jobId,
      max_tests: maxTests,
    });

    processProjectCrossModuleAsync(id, jobId, maxTests);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/projects/:id/tests/:testId - Update a project-level test scenario
router.patch('/:id/tests/:testId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, testId } = req.params;
    const updates = req.body || {};

    const project = await getProject(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found', project_id: id });
      return;
    }

    const scenarios = await getProjectTests(id);
    const scenario = scenarios.find(s => s.test_id === testId);
    if (!scenario) {
      res.status(404).json({ error: 'Scenario not found', test_id: testId });
      return;
    }

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

    await saveProjectTests(id, scenarios, project.project_tests?.batch_job_id || generateTestId());

    logger.info('Project scenario updated', { project_id: id, test_id: testId });
    res.json({ message: 'Scenario updated', test_id: testId });
  } catch (error) {
    next(error);
  }
});

// POST /api/projects/:id/tests/:testId/validate - Update validation status
router.post('/:id/tests/:testId/validate', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, testId } = req.params;
    const { validation_status, validation_notes } = req.body;

    const project = await getProject(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found', project_id: id });
      return;
    }

    const scenarios = await getProjectTests(id);
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

    await saveProjectTests(id, scenarios, project.project_tests?.batch_job_id || generateTestId());

    logger.info('Project scenario validation updated', { project_id: id, test_id: testId, validation_status });
    res.json({ message: 'Validation updated', test_id: testId, validation_status });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/projects/:id/tests - Delete all project-level tests
router.delete('/:id/tests', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const project = await getProject(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found', project_id: id });
      return;
    }

    const scenarios = await getProjectTests(id);
    const deletedCount = scenarios.length;

    if (deletedCount === 0) {
      res.json({ message: 'No tests to delete', project_id: id, deleted_count: 0 });
      return;
    }

    await saveProjectTests(id, [], project.project_tests?.batch_job_id || generateTestId());

    logger.info('All project scenarios deleted', { project_id: id, deleted_count: deletedCount });
    res.json({ message: 'All scenarios deleted', project_id: id, deleted_count: deletedCount });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/projects/:id/tests/:testId - Delete a single project-level test
router.delete('/:id/tests/:testId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, testId } = req.params;

    const project = await getProject(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found', project_id: id });
      return;
    }

    const scenarios = await getProjectTests(id);
    const scenarioIndex = scenarios.findIndex(s => s.test_id === testId);
    if (scenarioIndex === -1) {
      res.status(404).json({ error: 'Scenario not found', test_id: testId });
      return;
    }

    scenarios.splice(scenarioIndex, 1);
    await saveProjectTests(id, scenarios, project.project_tests?.batch_job_id || generateTestId());

    logger.info('Project scenario deleted', { project_id: id, test_id: testId });
    res.json({ message: 'Scenario deleted', test_id: testId });
  } catch (error) {
    next(error);
  }
});

// GET /api/projects/:id/jobs - Get job history for project-level generation
router.get('/:id/jobs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const project = await getProject(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found', project_id: id });
      return;
    }

    const { jobs: allJobs } = await listJobs();
    const jobsForProject: JobSummary[] = [];

    for (const jobSummary of allJobs) {
      const fullJob = await getJob(jobSummary.job_id);
      if (fullJob && fullJob.project_id === id && !fullJob.component_id) {
        jobsForProject.push(jobSummary);
      }
    }

    jobsForProject.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const limitedJobs = jobsForProject.slice(0, 20);

    res.json({ total: limitedJobs.length, jobs: limitedJobs });
  } catch (error) {
    next(error);
  }
});

// ── Project Manual/Handbook ───────────────────────────────────────────

// GET /api/projects/:id/manual - Get current manual info
router.get('/:id/manual', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const project = await getProject(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found', project_id: id });
      return;
    }

    if (!project.project_context) {
      res.json({ project_id: id, has_manual: false });
      return;
    }

    const context = project.project_context;
    let chunks_summary = null;
    if (context.is_chunked) {
      chunks_summary = await getChunksSummary(`project_${id}_manual`);
    }

    res.json({
      project_id: id,
      has_manual: true,
      has_text: !!context.manual_text,
      text_length: context.manual_text?.length || 0,
      has_file: !!context.manual_file,
      manual_file: context.manual_file || null,
      added_at: context.added_at,
      is_chunked: context.is_chunked || false,
      chunking_info: context.chunking_info || null,
      chunks_summary,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/projects/:id/manual/text - Upload text manual
router.post('/:id/manual/text', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { manual_text } = req.body;

    if (!manual_text || typeof manual_text !== 'string' || manual_text.trim().length === 0) {
      res.status(400).json({ error: 'manual_text is required' });
      return;
    }

    const project = await getProject(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found', project_id: id });
      return;
    }

    const context: ProjectContext = {
      manual_text: manual_text.trim(),
      added_at: new Date().toISOString(),
    };

    await saveProjectContext(id, context);

    logger.info('Manual text added to project', {
      project_id: id,
      text_length: manual_text.trim().length,
    });

    res.json({
      message: 'Manual text added successfully',
      project_id: id,
      text_length: manual_text.trim().length,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/projects/:id/manual/file - Upload file manual
router.post('/:id/manual/file', contextUpload.single('file'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const project = await getProject(id);
    if (!project) {
      await fs.unlink(file.path).catch(() => {});
      res.status(404).json({ error: 'Project not found', project_id: id });
      return;
    }

    const fileSizeMB = await getFileSizeMB(file.path);
    if (fileSizeMB > chunkingConfig.upload_limit_mb) {
      await fs.unlink(file.path).catch(() => {});
      res.status(400).json({ error: `File size exceeds ${chunkingConfig.upload_limit_mb} MB limit` });
      return;
    }

    logger.info('Parsing manual file for project', {
      project_id: id,
      filename: file.originalname,
      file_size_mb: fileSizeMB,
    });

    const parsedDoc = await parseContextDocument(file.path, file.originalname);
    const storedFilePath = await saveProjectManualFile(id, file.path, file.originalname);
    await fs.unlink(file.path).catch(() => {});

    const needsChunking = shouldChunkDocument(parsedDoc.text.length);
    let chunkingInfo = undefined;

    if (needsChunking) {
      logger.info('Large manual detected, chunking for project', {
        project_id: id,
        text_length: parsedDoc.text.length,
      });

      const chunkedDoc = chunkDocument(
        [],
        parsedDoc.text,
        `project_${id}_manual`,
        parsedDoc.filename
      );

      await saveChunkedDocument(chunkedDoc);

      chunkingInfo = {
        total_chunks: chunkedDoc.total_chunks,
        total_tokens: chunkedDoc.total_estimated_tokens,
        chunked_at: chunkedDoc.chunked_at,
      };
    }

    const context: ProjectContext = {
      manual_text: needsChunking ? undefined : parsedDoc.text,
      manual_file: {
        filename: parsedDoc.filename,
        file_type: parsedDoc.file_type,
        uploaded_at: parsedDoc.parsed_at,
        stored_path: storedFilePath,
      },
      added_at: new Date().toISOString(),
      is_chunked: needsChunking,
      chunking_info: chunkingInfo,
    };

    await saveProjectContext(id, context);

    res.json({
      message: needsChunking
        ? 'Manual file added and chunked successfully'
        : 'Manual file added successfully',
      project_id: id,
      filename: parsedDoc.filename,
      file_type: parsedDoc.file_type,
      text_length: parsedDoc.text.length,
      is_chunked: needsChunking,
      chunking_info: chunkingInfo,
    });
  } catch (error) {
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    next(error);
  }
});

// DELETE /api/projects/:id/manual - Remove manual
router.delete('/:id/manual', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const deleted = await deleteProjectContext(id);

    if (!deleted) {
      res.json({ message: 'No manual found to delete', project_id: id });
      return;
    }

    res.json({ message: 'Manual removed successfully', project_id: id });
  } catch (error) {
    if ((error as Error).message.includes('not found')) {
      res.status(404).json({ error: (error as Error).message });
      return;
    }
    next(error);
  }
});

export default router;

// ── Async processing ──────────────────────────────────────────────────

async function processProjectCrossModuleAsync(
  projectId: string,
  jobId: string,
  maxScenarios?: number
): Promise<void> {
  const contextLogger = createContextLogger({
    step: 'project-cross-module',
    project_id: projectId,
    job_id: jobId,
    max_scenarios: maxScenarios,
  });

  try {
    const project = await getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const components = await listComponentsByProject(projectId);
    const componentGroups: ComponentGroup[] = [];

    for (const compSummary of components) {
      const component = await getComponent(compSummary.component_id);
      if (!component) continue;

      const pages = await listPagesByComponent(compSummary.component_id);
      const scenarioSources: ScenarioWithSource[] = [];

      for (const pageSummary of pages) {
        const page = await getPage(pageSummary.page_id);
        if (!page?.latest_job_id) continue;

        const job = await getJob(page.latest_job_id);
        const scenarios = job?.results?.scenarios || [];
        if (scenarios.length === 0) continue;

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

      if (scenarioSources.length > 0) {
        componentGroups.push({
          componentId: compSummary.component_id,
          componentName: compSummary.name,
          scenarios: scenarioSources,
        });
      }
    }

    if (componentGroups.length === 0) {
      contextLogger.warn('No scenarios available across components for cross-module generation');
      await updateJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        results: { total_scenarios: 0, validated_scenarios: 0, needs_review_scenarios: 0, scenarios: [] },
      });
      return;
    }

    // Load handbook/manual context
    // Priority: 1) Direct project manual  2) Linked document manual
    let manualContext: string | null = null;

    const buildChangeRequests = () => componentGroups.flatMap(g =>
      g.scenarios.map(s => ({
        id: s.scenario.test_id,
        title: s.scenario.test_name,
        description: s.scenario.description || '',
        acceptance_criteria: [] as string[],
        affected_areas: [] as string[],
      }))
    ).slice(0, 20);

    // Check direct project-level manual first
    if (project.project_context) {
      if (project.project_context.is_chunked) {
        const relevantChunks = await getRelevantChunksForChangeRequests(
          `project_${projectId}_manual`,
          buildChangeRequests()
        );
        if (relevantChunks.length > 0) {
          manualContext = buildContextFromChunks(relevantChunks);
        }
      } else if (project.project_context.manual_text) {
        manualContext = project.project_context.manual_text;
      }
    }

    // Fallback: load from linked document if no direct project manual
    if (!manualContext && project.metadata?.document_id) {
      const document = await getDocument(project.metadata.document_id);
      if (document?.project_context) {
        if (document.project_context.is_chunked) {
          const relevantChunks = await getRelevantChunksForChangeRequests(
            `${document.document_id}_manual`,
            buildChangeRequests()
          );
          if (relevantChunks.length > 0) {
            manualContext = buildContextFromChunks(relevantChunks);
          }
        } else if (document.project_context.manual_text) {
          manualContext = document.project_context.manual_text;
        }
      }
    }

    contextLogger.info('Collected scenarios for cross-module generation', {
      component_count: componentGroups.length,
      total_scenarios: componentGroups.reduce((sum, g) => sum + g.scenarios.length, 0),
      has_manual: !!manualContext,
    });

    // Deduplicate across all components
    const allScenarios = componentGroups.flatMap(g => g.scenarios);
    const { uniqueScenarios } = await deduplicateScenarios(allScenarios, jobId, contextLogger);

    // Re-group deduplicated scenarios by component
    const deduplicatedGroups: ComponentGroup[] = componentGroups.map(g => ({
      ...g,
      scenarios: uniqueScenarios.filter(s =>
        g.scenarios.some(orig => orig.scenario.test_id === s.scenario.test_id)
      ),
    })).filter(g => g.scenarios.length > 0);

    const projectScenarios = await generateProjectLevelTests(
      deduplicatedGroups,
      manualContext,
      jobId,
      contextLogger,
      maxScenarios
    );

    if (projectScenarios.length === 0) {
      contextLogger.warn('No cross-module scenarios generated');
      await updateJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        results: { total_scenarios: 0, validated_scenarios: 0, needs_review_scenarios: 0, scenarios: [] },
      });
      return;
    }

    await saveProjectTests(projectId, projectScenarios, jobId);

    const validatedCount = projectScenarios.filter(s => s.validation_status === 'validated').length;
    const needsReviewCount = projectScenarios.filter(s => s.validation_status === 'needs_review').length;

    await updateJob(jobId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      results: {
        total_scenarios: projectScenarios.length,
        validated_scenarios: validatedCount,
        needs_review_scenarios: needsReviewCount,
        scenarios: projectScenarios,
      },
    });

    contextLogger.info('Project cross-module tests saved', {
      project_id: projectId,
      scenario_count: projectScenarios.length,
    });
  } catch (error) {
    contextLogger.error('Project cross-module generation failed', {
      project_id: projectId,
      error: (error as Error).message,
    });

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

  return Math.min(parsed, MAX_PROJECT_TESTS);
}
