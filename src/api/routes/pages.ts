import { Router, Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import {
  createPage,
  getPage,
  updatePage,
  deletePage,
  listPagesByComponent,
  addJobToPage,
  updatePageTestSummary,
  getPageByConfluenceLink,
} from '../../storage/page-store';
import { getComponent, addPageToComponent, removePageFromComponent } from '../../storage/component-store';
import { getJob } from '../../storage/job-store';
import { getDocument } from '../../storage/document-store';
import { JiraConfig } from '../../models/config';
import { Job } from '../../models/job';
import { SpecificationInput, ScenarioOverride } from '../../models/specification-input';
import { executePipeline } from '../../pipeline/pipeline-orchestrator';
import { ParsedWordDocument, DocumentPage } from '../../models/word-document';
import { getRelevantChunksForChangeRequests, buildContextFromChunks } from '../../pipeline/relevance-scorer';
import { saveJob, updateJob } from '../../storage/job-store';
import { generateJobId, generateUUID } from '../../utils/uuid-generator';
import { fetchConfluencePage } from '../../integrations/confluence-client';
import { extractPageIdFromUrl, isValidConfluenceUrl } from '../../utils/confluence-url-parser';
import logger from '../../utils/logger';
import { detectDependenciesFromContent, toPageDependencies } from '../../pipeline/dependency-detector';
import multer from 'multer';
import fs from 'fs/promises';
import { parseDocument, isValidFileType, getFileSizeMB } from '../../utils/document-parser';

const router = Router();

// Configure multer for file uploads
const upload = multer({
  dest: 'data/temp_uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB limit
  },
  fileFilter: (_req, file, cb) => {
    if (isValidFileType(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only docx, pdf, and txt files are allowed.'));
    }
  },
});

const createPageSchema = Joi.object({
  confluence_link: Joi.string().uri().required(),
  name: Joi.string().min(1).max(200).optional(),
});

const updatePageSchema = Joi.object({
  name: Joi.string().min(1).max(200).optional(),
  confluence_link: Joi.string().uri().optional(),
});

const MAX_OVERRIDE_TESTS = 20;

// Store jiraConfig for use in route handlers
let jiraConfig: JiraConfig;

export function createPagesRoute(config: JiraConfig): Router {
  jiraConfig = config;
  return router;
}

// GET /api/components/:componentId/pages - List pages in component
router.get('/component/:componentId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { componentId } = req.params;

    const component = await getComponent(componentId);
    if (!component) {
      res.status(404).json({ error: 'Component not found', component_id: componentId });
      return;
    }

    const pages = await listPagesByComponent(componentId);
    res.json({ total: pages.length, pages });
  } catch (error) {
    next(error);
  }
});

// POST /api/components/:componentId/pages - Add page to component
router.post('/component/:componentId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { componentId } = req.params;
    const { error, value } = createPageSchema.validate(req.body);

    if (error) {
      res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => d.message),
      });
      return;
    }

    const component = await getComponent(componentId);
    if (!component) {
      res.status(404).json({ error: 'Component not found', component_id: componentId });
      return;
    }

    // Check if page with this link already exists in this component
    const existingPage = await getPageByConfluenceLink(value.confluence_link);
    if (existingPage && existingPage.component_id === componentId) {
      res.status(409).json({
        error: 'Page already exists in this component',
        page_id: existingPage.page_id,
      });
      return;
    }

    const page = await createPage(componentId, component.project_id, value);
    await addPageToComponent(componentId, page.page_id);

    logger.info('Page created via API', {
      page_id: page.page_id,
      component_id: componentId,
    });

    res.status(201).json(page);
  } catch (error) {
    next(error);
  }
});

// GET /api/pages/:id - Get page details
router.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const page = await getPage(id);

    if (!page) {
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    // Get latest job details if available
    let latestJob = null;
    if (page.latest_job_id) {
      latestJob = await getJob(page.latest_job_id);
    }

    res.json({
      ...page,
      latest_job: latestJob ? {
        job_id: latestJob.job_id,
        status: latestJob.status,
        created_at: latestJob.created_at,
        completed_at: latestJob.completed_at,
        scenario_count: latestJob.results?.total_scenarios,
      } : null,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/pages/:id/source-document - Get source document data for pages created from documents
router.get('/:id/source-document', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const page = await getPage(id);

    if (!page) {
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    // Check if this page was created from a document
    if (page.source_type !== 'document' || !page.document_id) {
      res.json({
        page_id: id,
        source_type: page.source_type || 'confluence',
        has_source_document: false,
        message: 'This page was not created from a document',
      });
      return;
    }

    // Get the source document
    const document = await getDocument(page.document_id);
    if (!document) {
      res.status(404).json({
        error: 'Source document not found',
        page_id: id,
        document_id: page.document_id,
      });
      return;
    }

    // Find the specific DocumentPage in the document
    const documentPage = document.pages?.find(p => p.module_id === page.document_page_id);

    res.json({
      page_id: id,
      source_type: 'document',
      has_source_document: true,
      document: {
        document_id: document.document_id,
        filename: document.filename,
        parsed_at: document.parsed_at,
        status: document.status,
        has_manual: !!document.project_context?.manual_text || !!document.project_context?.is_chunked || !!document.project_context?.manual_file,
        manual_info: document.project_context ? {
          is_chunked: document.project_context.is_chunked || false,
          manual_filename: document.project_context.manual_file?.filename,
          added_at: document.project_context.added_at,
          has_stored_file: !!document.project_context.manual_file?.stored_path,
        } : null,
      },
      document_page: documentPage ? {
        module_id: documentPage.module_id,
        page_id: documentPage.page_id,
        name: documentPage.name,
        description: documentPage.description,
        priority: documentPage.priority,
        change_requests: documentPage.change_requests,
        supplementary_context: documentPage.supplementary_context,
      } : null,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/pages/:id - Update page
router.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { error, value } = updatePageSchema.validate(req.body);

    if (error) {
      res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => d.message),
      });
      return;
    }

    const page = await updatePage(id, value);
    res.json(page);
  } catch (error) {
    if ((error as Error).message.includes('not found')) {
      res.status(404).json({ error: (error as Error).message });
      return;
    }
    next(error);
  }
});

// DELETE /api/pages/:id - Delete page
router.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const page = await getPage(id);
    if (!page) {
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    // Remove from component first
    await removePageFromComponent(page.component_id, id);

    // Then delete page
    await deletePage(id);

    res.json({ message: 'Page deleted', page_id: id });
  } catch (error) {
    next(error);
  }
});

// GET /api/pages/:id/tests - Get page-level tests
router.get('/:id/tests', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const page = await getPage(id);
    if (!page) {
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    if (!page.latest_job_id) {
      res.json({
        page_id: id,
        total: 0,
        scenarios: [],
        message: 'No tests generated yet',
      });
      return;
    }

    const job = await getJob(page.latest_job_id);
    if (!job || !job.results) {
      res.json({
        page_id: id,
        total: 0,
        scenarios: [],
        message: 'Job has no results',
      });
      return;
    }

    res.json({
      page_id: id,
      job_id: page.latest_job_id,
      total: job.results.total_scenarios,
      validated: job.results.validated_scenarios,
      needs_review: job.results.needs_review_scenarios,
      scenarios: job.results.scenarios,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/pages/:id/tests/:testId - Update a test scenario
router.patch('/:id/tests/:testId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, testId } = req.params;
    const updates = req.body || {};

    const page = await getPage(id);
    if (!page) {
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    if (!page.latest_job_id) {
      res.status(404).json({ error: 'No tests found for this page' });
      return;
    }

    const job = await getJob(page.latest_job_id);
    if (!job || !job.results?.scenarios) {
      res.status(404).json({ error: 'Job has no scenarios' });
      return;
    }

    const scenario = job.results.scenarios.find(s => s.test_id === testId);
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
    if (updates.preconditions !== undefined) {
      if (Array.isArray(updates.preconditions)) {
        scenario.preconditions = updates.preconditions.map((p: string) => String(p).trim()).filter(Boolean);
      }
    }
    if (updates.test_steps !== undefined && Array.isArray(updates.test_steps)) {
      scenario.test_steps = updates.test_steps.map((step: any, idx: number) => ({
        step_number: step.step_number ?? idx + 1,
        action: String(step.action || '').trim(),
        input: String(step.input || '').trim(),
        expected_result: String(step.expected_result || '').trim(),
      }));
    }

    await updateJob(page.latest_job_id, { results: job.results });

    logger.info('Scenario updated via page API', {
      page_id: id,
      job_id: page.latest_job_id,
      test_id: testId,
    });

    res.json({ message: 'Scenario updated', test_id: testId });
  } catch (error) {
    next(error);
  }
});

// POST /api/pages/:id/tests/:testId/validate - Update validation status
router.post('/:id/tests/:testId/validate', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, testId } = req.params;
    const { validation_status, validation_notes } = req.body;

    const page = await getPage(id);
    if (!page) {
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    if (!page.latest_job_id) {
      res.status(404).json({ error: 'No tests found for this page' });
      return;
    }

    const job = await getJob(page.latest_job_id);
    if (!job || !job.results?.scenarios) {
      res.status(404).json({ error: 'Job has no scenarios' });
      return;
    }

    const scenario = job.results.scenarios.find(s => s.test_id === testId);
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

    // Recalculate counts
    job.results.validated_scenarios = job.results.scenarios.filter(s => s.validation_status === 'validated').length;
    job.results.needs_review_scenarios = job.results.scenarios.filter(s => s.validation_status === 'needs_review').length;

    await updateJob(page.latest_job_id, { results: job.results });
    await updatePageTestSummary(id);

    logger.info('Scenario validation updated', {
      page_id: id,
      test_id: testId,
      validation_status,
    });

    res.json({ message: 'Validation updated', test_id: testId, validation_status });
  } catch (error) {
    next(error);
  }
});

// POST /api/pages/:id/tests/:testId/comments - Add a comment to a scenario
router.post('/:id/tests/:testId/comments', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, testId } = req.params;
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

    const page = await getPage(id);
    if (!page) {
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    if (!page.latest_job_id) {
      res.status(404).json({ error: 'No tests found for this page' });
      return;
    }

    const job = await getJob(page.latest_job_id);
    if (!job || !job.results?.scenarios) {
      res.status(404).json({ error: 'Job has no scenarios' });
      return;
    }

    const scenario = job.results.scenarios.find(s => s.test_id === testId);
    if (!scenario) {
      res.status(404).json({ error: 'Scenario not found', test_id: testId });
      return;
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
    await updateJob(page.latest_job_id, { results: job.results });

    logger.info('Comment added to scenario via page API', {
      page_id: id,
      job_id: page.latest_job_id,
      test_id: testId,
      comment_id: comment.id,
    });

    res.status(201).json(comment);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/pages/:id/tests - Delete all test scenarios
router.delete('/:id/tests', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const page = await getPage(id);
    if (!page) {
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    if (!page.latest_job_id) {
      res.json({ message: 'No tests to delete', page_id: id, deleted_count: 0 });
      return;
    }

    const job = await getJob(page.latest_job_id);
    if (!job || !job.results?.scenarios) {
      res.json({ message: 'No tests to delete', page_id: id, deleted_count: 0 });
      return;
    }

    const deletedCount = job.results.scenarios.length;

    // Clear all scenarios
    job.results.scenarios = [];
    job.results.total_scenarios = 0;
    job.results.validated_scenarios = 0;
    job.results.needs_review_scenarios = 0;

    await updateJob(page.latest_job_id, { results: job.results });
    await updatePageTestSummary(id);

    logger.info('All scenarios deleted via page API', {
      page_id: id,
      job_id: page.latest_job_id,
      deleted_count: deletedCount,
    });

    res.json({ message: 'All scenarios deleted', page_id: id, deleted_count: deletedCount });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/pages/:id/tests/:testId - Delete a test scenario
router.delete('/:id/tests/:testId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, testId } = req.params;

    const page = await getPage(id);
    if (!page) {
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    if (!page.latest_job_id) {
      res.status(404).json({ error: 'No tests found for this page' });
      return;
    }

    const job = await getJob(page.latest_job_id);
    if (!job || !job.results?.scenarios) {
      res.status(404).json({ error: 'Job has no scenarios' });
      return;
    }

    const scenarioIndex = job.results.scenarios.findIndex(s => s.test_id === testId);
    if (scenarioIndex === -1) {
      res.status(404).json({ error: 'Scenario not found', test_id: testId });
      return;
    }

    // Remove the scenario
    job.results.scenarios.splice(scenarioIndex, 1);

    // Recalculate counts
    job.results.total_scenarios = job.results.scenarios.length;
    job.results.validated_scenarios = job.results.scenarios.filter(s => s.validation_status === 'validated').length;
    job.results.needs_review_scenarios = job.results.scenarios.filter(s => s.validation_status === 'needs_review').length;

    await updateJob(page.latest_job_id, { results: job.results });
    await updatePageTestSummary(id);

    logger.info('Scenario deleted via page API', {
      page_id: id,
      job_id: page.latest_job_id,
      test_id: testId,
    });

    res.json({ message: 'Scenario deleted', test_id: testId });
  } catch (error) {
    next(error);
  }
});

// GET /api/pages/:id/jobs - Get job history for page
router.get('/:id/jobs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const page = await getPage(id);
    if (!page) {
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    const jobs = await Promise.all(
      page.job_history.map(async jobId => {
        const job = await getJob(jobId);
        return job ? {
          job_id: job.job_id,
          status: job.status,
          created_at: job.created_at,
          completed_at: job.completed_at,
          scenario_count: job.results?.total_scenarios,
        } : null;
      })
    );

    res.json({
      page_id: id,
      total: jobs.filter(Boolean).length,
      jobs: jobs.filter(Boolean),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/pages/:id/generate - Generate tests for this page
router.post('/:id/generate', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const page = await getPage(id);
    if (!page) {
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    const jobId = generateJobId();
    const maxTests = parseMaxTests(req.body?.max_tests);
    const scenarioOverride: ScenarioOverride | undefined = maxTests ? { count: maxTests } : undefined;

    // Handle document-based pages differently
    if (page.source_type === 'document' && page.document_id) {
      // For document-based pages, use document generation
      const document = await getDocument(page.document_id);
      if (!document) {
        res.status(404).json({ error: 'Source document not found', document_id: page.document_id });
        return;
      }

      // Find the DocumentPage in the document
      const documentPage = document.pages?.find(p => p.module_id === page.document_page_id);
      if (!documentPage) {
        res.status(404).json({ error: 'Document page not found', document_page_id: page.document_page_id });
        return;
      }

      const job: Job = {
        job_id: jobId,
        status: 'processing',
        input: {
          title: documentPage.name,
          description: documentPage.description,
          metadata: {
            system_type: 'web',
            feature_priority: documentPage.priority,
            parent_jira_issue_id: '',
          },
        },
        created_at: new Date().toISOString(),
        project_id: page.project_id,
        component_id: page.component_id,
        page_id: page.page_id,
      };

      await saveJob(job);
      await addJobToPage(id, jobId);

      res.status(202).json({
        job_id: jobId,
        page_id: id,
        status: 'processing',
        message: 'Test generation started (from document)',
        created_at: job.created_at,
      });

      // Process document page asynchronously
      processDocumentPageJobAsync(jobId, id, document, documentPage, scenarioOverride);
      return;
    }

    // For Confluence-based pages, validate the URL
    if (!isValidConfluenceUrl(page.confluence_link)) {
      res.status(400).json({ error: 'Invalid Confluence URL', link: page.confluence_link });
      return;
    }

    const input: SpecificationInput = {
      link: page.confluence_link,
      ...(scenarioOverride ? { scenario_override: scenarioOverride } : {}),
    };

    const job: Job = {
      job_id: jobId,
      status: 'processing',
      input,
      created_at: new Date().toISOString(),
      // Add hierarchy references
      project_id: page.project_id,
      component_id: page.component_id,
      page_id: page.page_id,
    };

    await saveJob(job);
    await addJobToPage(id, jobId);

    res.status(202).json({
      job_id: jobId,
      page_id: id,
      status: 'processing',
      message: 'Test generation started',
      created_at: job.created_at,
    });

    // Process asynchronously
    processPageJobAsync(jobId, page.confluence_link, id, scenarioOverride);
  } catch (error) {
    next(error);
  }
});

async function processPageJobAsync(
  jobId: string,
  confluenceLink: string,
  pageId: string,
  scenarioOverride?: ScenarioOverride
): Promise<void> {
  try {
    logger.info('Starting page job processing', { job_id: jobId, page_id: pageId });

    // Extract page ID from the URL
    const confluencePageId = extractPageIdFromUrl(confluenceLink);
    if (!confluencePageId) {
      throw new Error(`Could not extract page ID from URL: ${confluenceLink}`);
    }

    // Fetch the Confluence page content
    const confluenceData = await fetchConfluencePage(confluencePageId);
    if (!confluenceData) {
      throw new Error(`Failed to fetch Confluence page with ID: ${confluencePageId}`);
    }

    logger.info('Successfully fetched Confluence page content', {
      job_id: jobId,
      page_id: pageId,
      confluence_page_id: confluencePageId,
      title: confluenceData.title,
    });

    // Get page to include supplementary context
    const page = await getPage(pageId);

    const pipelineInput: SpecificationInput = {
      ...confluenceData,
      ...(scenarioOverride ? { scenario_override: scenarioOverride } : {}),
      ...(page?.supplementary_context ? { supplementary_context: page.supplementary_context } : {}),
    };

    if (page?.supplementary_context?.additional_text) {
      logger.info('Including supplementary context in pipeline', {
        job_id: jobId,
        page_id: pageId,
        context_length: page.supplementary_context.additional_text.length,
      });
    }

    const results = await executePipeline(pipelineInput, jiraConfig, jobId);

    await updateJob(jobId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      results,
    });

    // Update page test summary
    await updatePageTestSummary(pageId);

    // Detect dependencies from Confluence content
    if (page) {
      const contentForDependencies = [
        confluenceData.title || '',
        confluenceData.description || '',
        confluenceData.acceptance_criteria || '',
      ].join(' ');

      const detectedDeps = await detectDependenciesFromContent(
        contentForDependencies,
        pageId,
        page.project_id
      );

      if (detectedDeps.length > 0) {
        const pageDependencies = toPageDependencies(detectedDeps);
        await updatePage(pageId, { dependencies: pageDependencies } as any);

        logger.info('Dependencies detected and saved', {
          page_id: pageId,
          dependency_count: pageDependencies.length,
        });
      }
    }

    logger.info('Page job completed successfully', { job_id: jobId, page_id: pageId });
  } catch (error) {
    logger.error('Page job failed', {
      job_id: jobId,
      page_id: pageId,
      error: (error as Error).message,
    });

    await updateJob(jobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: (error as Error).message,
    });
  }
}

/**
 * Process test generation for a document-based page
 */
async function processDocumentPageJobAsync(
  jobId: string,
  pageId: string,
  document: ParsedWordDocument,
  documentPage: DocumentPage,
  scenarioOverride?: ScenarioOverride
): Promise<void> {
  try {
    logger.info('Starting document page job processing', {
      job_id: jobId,
      page_id: pageId,
      document_id: document.document_id,
      module_id: documentPage.module_id,
    });

    // Build description from document page data
    const descriptionParts: string[] = [];

    // Add manual/handbook context if available
    if (document.project_context) {
      if (document.project_context.is_chunked) {
        // Manual is chunked - use relevance scoring to select relevant parts
        const relevantChunks = await getRelevantChunksForChangeRequests(
          `${document.document_id}_manual`,
          documentPage.change_requests
        );

        if (relevantChunks.length > 0) {
          const chunkContext = buildContextFromChunks(relevantChunks);
          descriptionParts.push(chunkContext);
        }
      } else if (document.project_context.manual_text) {
        // Manual is small - use full text
        descriptionParts.push('## PRÍRUČKA / ŠPECIFIKÁCIA EXISTUJÚCEJ FUNKCIONALITY:\n');
        descriptionParts.push('(Toto je kontext existujúcej funkcionality, kde sa zmena aplikuje)\n');
        descriptionParts.push(document.project_context.manual_text);
        descriptionParts.push('\n---\n');
      }
    }

    // Add page description
    descriptionParts.push(documentPage.description);

    // Add change requests
    if (documentPage.change_requests && documentPage.change_requests.length > 0) {
      descriptionParts.push('\n## ZMENOVÉ POŽIADAVKY:\n');
      for (const cr of documentPage.change_requests) {
        descriptionParts.push(`### ${cr.title}`);
        descriptionParts.push(cr.description);
        if (cr.acceptance_criteria && cr.acceptance_criteria.length > 0) {
          descriptionParts.push('\nAkceptačné kritériá:');
          cr.acceptance_criteria.forEach((ac, i) => {
            descriptionParts.push(`${i + 1}. ${ac}`);
          });
        }
        if (cr.affected_areas && cr.affected_areas.length > 0) {
          descriptionParts.push(`\nOvplyvnené oblasti: ${cr.affected_areas.join(', ')}`);
        }
        descriptionParts.push('\n');
      }
    }

    // Get page for supplementary context
    const page = await getPage(pageId);

    // Add supplementary context if available
    if (page?.supplementary_context?.additional_text) {
      descriptionParts.push('\n## Dodatočný kontext:\n');
      descriptionParts.push(page.supplementary_context.additional_text);
    }

    const pipelineInput: SpecificationInput = {
      title: documentPage.name,
      description: descriptionParts.join('\n'),
      metadata: {
        system_type: 'web',
        feature_priority: documentPage.priority,
        parent_jira_issue_id: '',
      },
      confluence_page_id: `doc-${document.document_id}-${documentPage.module_id}`,
      ...(scenarioOverride ? { scenario_override: scenarioOverride } : {}),
    };

    logger.info('Executing pipeline for document page', {
      job_id: jobId,
      page_id: pageId,
      title: documentPage.name,
      description_length: pipelineInput.description?.length || 0,
      change_requests_count: documentPage.change_requests?.length || 0,
    });

    const results = await executePipeline(pipelineInput, jiraConfig, jobId);

    await updateJob(jobId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      results,
    });

    // Update page test summary
    await updatePageTestSummary(pageId);

    logger.info('Document page job completed successfully', {
      job_id: jobId,
      page_id: pageId,
      total_scenarios: results.total_scenarios,
    });
  } catch (error) {
    logger.error('Document page job failed', {
      job_id: jobId,
      page_id: pageId,
      error: (error as Error).message,
    });

    await updateJob(jobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: (error as Error).message,
    });
  }
}

// GET /api/pages/:id/context - Get supplementary context
router.get('/:id/context', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const page = await getPage(id);
    if (!page) {
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    res.json({
      page_id: id,
      supplementary_context: page.supplementary_context || null,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/pages/:id/context/text - Add text context
router.post('/:id/context/text', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({ error: 'Text content is required' });
      return;
    }

    const page = await getPage(id);
    if (!page) {
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    const currentContext = page.supplementary_context || {};
    const updatedContext = {
      ...currentContext,
      additional_text: text.trim(),
      added_at: new Date().toISOString(),
    };

    await updatePage(id, { supplementary_context: updatedContext } as any);

    logger.info('Text context added to page', {
      page_id: id,
      text_length: text.trim().length,
    });

    res.json({
      message: 'Text context added successfully',
      page_id: id,
      supplementary_context: updatedContext,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/pages/:id/context/file - Upload file context (docx/pdf)
router.post('/:id/context/file', upload.single('file'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const page = await getPage(id);
    if (!page) {
      // Clean up uploaded file
      await fs.unlink(file.path).catch(() => {});
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    // Check file size
    const fileSizeMB = await getFileSizeMB(file.path);
    if (fileSizeMB > 10) {
      await fs.unlink(file.path).catch(() => {});
      res.status(400).json({ error: 'File size exceeds 10 MB limit' });
      return;
    }

    // Parse the document
    const parsedDoc = await parseDocument(file.path, file.originalname);

    // Clean up uploaded file
    await fs.unlink(file.path).catch(() => {});

    // Update page with extracted text
    const currentContext = page.supplementary_context || {};
    const updatedContext = {
      ...currentContext,
      additional_text: parsedDoc.text,
      added_at: new Date().toISOString(),
      source_file: {
        filename: parsedDoc.filename,
        file_type: parsedDoc.file_type,
        uploaded_at: parsedDoc.parsed_at,
      },
    };

    await updatePage(id, { supplementary_context: updatedContext } as any);

    logger.info('File context added to page', {
      page_id: id,
      filename: parsedDoc.filename,
      file_type: parsedDoc.file_type,
      text_length: parsedDoc.text.length,
    });

    res.json({
      message: 'File context added successfully',
      page_id: id,
      filename: parsedDoc.filename,
      file_type: parsedDoc.file_type,
      text_length: parsedDoc.text.length,
      supplementary_context: updatedContext,
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    next(error);
  }
});

// POST /api/pages/:id/context/link - Add Confluence link context
router.post('/:id/context/link', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { link } = req.body;

    if (!link || typeof link !== 'string') {
      res.status(400).json({ error: 'Confluence link is required' });
      return;
    }

    if (!isValidConfluenceUrl(link)) {
      res.status(400).json({ error: 'Invalid Confluence URL format' });
      return;
    }

    const page = await getPage(id);
    if (!page) {
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    const currentContext = page.supplementary_context || {};
    const existingLinks = currentContext.confluence_links || [];

    if (existingLinks.includes(link)) {
      res.status(400).json({ error: 'Link already exists in context' });
      return;
    }

    const updatedContext = {
      ...currentContext,
      confluence_links: [...existingLinks, link],
      added_at: new Date().toISOString(),
    };

    await updatePage(id, { supplementary_context: updatedContext } as any);

    // Optionally fetch and add the content from the link
    try {
      const pageId = extractPageIdFromUrl(link);
      if (pageId) {
        const confluenceData = await fetchConfluencePage(pageId);
        if (confluenceData) {
          const additionalText = [
            confluenceData.title || '',
            confluenceData.description || '',
            confluenceData.acceptance_criteria || '',
          ].filter(Boolean).join('\n\n');

          const existingText = currentContext.additional_text || '';
          updatedContext.additional_text = existingText
            ? `${existingText}\n\n--- From ${link} ---\n${additionalText}`
            : `--- From ${link} ---\n${additionalText}`;

          await updatePage(id, { supplementary_context: updatedContext } as any);
        }
      }
    } catch (fetchError) {
      logger.warn('Failed to fetch Confluence page content for context', {
        page_id: id,
        link,
        error: (fetchError as Error).message,
      });
    }

    logger.info('Confluence link added to page context', {
      page_id: id,
      link,
    });

    res.json({
      message: 'Confluence link added successfully',
      page_id: id,
      supplementary_context: updatedContext,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/pages/:id/context - Clear supplementary context
router.delete('/:id/context', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const page = await getPage(id);
    if (!page) {
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    await updatePage(id, { supplementary_context: undefined } as any);

    logger.info('Supplementary context cleared from page', { page_id: id });

    res.json({
      message: 'Supplementary context cleared successfully',
      page_id: id,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

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

  return Math.min(parsed, MAX_OVERRIDE_TESTS);
}
