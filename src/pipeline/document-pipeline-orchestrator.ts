/**
 * Document Pipeline Orchestrator
 * Orchestrates test generation from Word documents
 * Creates projects and components in the hierarchy
 */

import {
  ParsedWordDocument,
  DocumentPage,
  DocumentModuleInfo,
  CoveragePlan,
  DocumentGenerationResult,
  ModuleCoveragePlan,
} from '../models/word-document';
import { SpecificationInput } from '../models/specification-input';
import { JiraConfig } from '../models/config';
import { Component } from '../models/component';
import { parseWordDocument } from './word-parser';
import { detectModules } from './module-detector';
import { planCoverage, estimateCoverageMetrics } from './coverage-planner';
import { executePipeline } from './pipeline-orchestrator';
import { createJob, updateJob } from '../storage/job-store';
import { saveDocument, updateDocument, getDocument } from '../storage/document-store';
import { createProject, addComponentToProject, getProject } from '../storage/project-store';
import { saveComponent, addPageToComponent } from '../storage/component-store';
import {
  savePage,
  addJobToPage,
  updatePageTestSummary,
} from '../storage/page-store';
import { createContextLogger } from '../utils/logger';
import { generateTestId } from '../utils/uuid-generator';
import { Page } from '../models/page';
import { getRelevantChunksForChangeRequests, buildContextFromChunks } from './relevance-scorer';

export interface DocumentProcessingResult {
  documentId: string;
  projectId: string;
  componentIds: string[];
  coveragePlan?: CoveragePlan;
  generationResult?: DocumentGenerationResult;
  error?: string;
}

export interface MultiDocumentInput {
  buffer: Buffer;
  filename: string;
}

export interface MultiDocumentProjectResult {
  projectId: string;
  projectName: string;
  documentIds: string[];
  totalPages: number;
  totalChangeRequests: number;
}

/**
 * Parse and analyze a Word document
 * Creates a Project and Components for each detected module
 */
export async function processWordDocument(
  buffer: Buffer,
  filename: string,
  _jiraConfig: JiraConfig
): Promise<{ documentId: string; projectId: string }> {
  const documentId = generateTestId();
  const contextLogger = createContextLogger({
    step: 'document_processing',
    document_id: documentId,
    filename,
  });

  contextLogger.info('Starting Word document processing');

  try {
    const initialDocument: ParsedWordDocument = {
      document_id: documentId,
      filename,
      parsed_at: new Date().toISOString(),
      sections: [],
      pages: [],
      raw_text: '',
      status: 'uploaded',
    };
    await saveDocument(initialDocument);

    contextLogger.info('Step 1: Parsing Word document');
    const parseResult = await parseWordDocument(buffer, filename);

    const parsedDocument: ParsedWordDocument = {
      ...initialDocument,
      sections: parseResult.sections,
      raw_text: parseResult.raw_text,
      status: 'parsed',
    };
    await updateDocument(documentId, parsedDocument);

    contextLogger.info('Document parsed successfully', {
      sections_count: parseResult.sections.length,
      text_length: parseResult.raw_text.length,
    });

    contextLogger.info('Step 2: Detecting document pages');
    const pageResult = await detectModules(
      parseResult.sections,
      parseResult.raw_text,
      documentId
    );

    if (!pageResult.success) {
      await updateDocument(documentId, {
        ...parsedDocument,
        status: 'failed',
        error: pageResult.error,
      });
      throw new Error(`Page detection failed: ${pageResult.error}`);
    }

    const parsedProjectName = deriveProjectName(filename);
    const project = await createProject({
      name: parsedProjectName,
      description: `Automaticky vytvoreny z dokumentu: ${filename}`,
      metadata: {
        source_type: 'document',
        document_id: documentId,
        document_filename: filename,
      },
    });

    contextLogger.info('Project created', {
      project_id: project.project_id,
      project_name: project.name,
    });

    const componentResult = await createDocumentModuleComponent(
      project.project_id,
      documentId,
      filename,
      pageResult.modules
    );

    contextLogger.info('Document pages detected successfully', {
      pages_count: componentResult.pages.length,
      total_change_requests: componentResult.pages.reduce(
        (sum, p) => sum + p.change_requests.length,
        0
      ),
    });

    const documentWithPages: ParsedWordDocument = {
      ...parsedDocument,
      pages: componentResult.pages,
      module: componentResult.module,
      status: 'pages_detected',
    };

    await updateDocument(documentId, {
      ...documentWithPages,
      project_id: project.project_id,
    } as ParsedWordDocument & { project_id: string });

    return { documentId, projectId: project.project_id };

  } catch (error: any) {
    contextLogger.error('Document processing failed', {
      error: error.message,
    });
    throw error;
  }
}

async function generateTestsForDocumentPage(
  page: DocumentPage,
  pagePlan: ModuleCoveragePlan | undefined,
  document: ParsedWordDocument,
  jiraConfig: JiraConfig,
  componentId: string | undefined,
  _logger: ReturnType<typeof createContextLogger>
): Promise<{
  jobId: string;
  totalScenarios: number;
  validatedScenarios: number;
  needsReviewScenarios: number;
}> {
  if (!componentId) {
    throw new Error('Document module component missing');
  }

  const jobId = generateTestId();

  await createJob({
    job_id: jobId,
    status: 'processing',
    created_at: new Date().toISOString(),
    document_id: document.document_id,
    component_id: componentId,
    page_id: page.page_id,
    input: {
      title: page.name,
      description: page.description,
      acceptance_criteria: page.change_requests
        .flatMap(cr => cr.acceptance_criteria)
        .join('\n'),
      metadata: {
        system_type: 'web',
        feature_priority: page.priority,
        parent_jira_issue_id: '',
      },
    },
  });

  await addJobToPage(page.page_id, jobId);

  try {
    const specInput = await buildPageSpecificationInput(page, document, pagePlan);

    const result = await executePipeline(specInput, jiraConfig, jobId);

    await updateJob(jobId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      results: {
        total_scenarios: result.total_scenarios,
        validated_scenarios: result.validated_scenarios,
        needs_review_scenarios: result.needs_review_scenarios,
        scenarios: result.scenarios,
      },
    });

    await updatePageTestSummary(page.page_id);

    return {
      jobId,
      totalScenarios: result.total_scenarios,
      validatedScenarios: result.validated_scenarios,
      needsReviewScenarios: result.needs_review_scenarios,
    };
  } catch (error: any) {
    await updateJob(jobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: error.message,
    });
    throw error;
  }
}

async function buildPageSpecificationInput(
  page: DocumentPage,
  document: ParsedWordDocument,
  pagePlan?: ModuleCoveragePlan
): Promise<SpecificationInput> {
  let description = await buildPageDescription(page, document);

  if (pagePlan) {
    description = `${description}

---
POKYNY PRE GENEROVANIE:
- Vygeneruj minimálne ${pagePlan.tests_planned} testovacích scenárov
- Rozloženie: ${pagePlan.test_distribution.happy_path} happy_path, ${pagePlan.test_distribution.negative} negative, ${pagePlan.test_distribution.edge_case} edge_case
- Pokry všetky zmenové požiadavky: ${page.change_requests.length}
---
`;
  }

  return {
    title: page.name,
    description,
    acceptance_criteria: buildPageAcceptanceCriteria(page),
    metadata: {
      system_type: 'web',
      feature_priority: page.priority,
      parent_jira_issue_id: '',
    },
    confluence_page_id: `doc-${document.document_id}-${page.module_id}`,
  };
}

async function buildPageDescription(page: DocumentPage, document: ParsedWordDocument): Promise<string> {
  const parts: string[] = [];

  // CRITICAL: Add project-level manual/handbook FIRST (this is the existing functionality context)
  if (document.project_context) {
    if (document.project_context.is_chunked) {
      // Manual is chunked - use relevance scoring to select relevant parts
      const relevantChunks = await getRelevantChunksForChangeRequests(
        `${document.document_id}_manual`,
        page.change_requests
      );

      if (relevantChunks.length > 0) {
        const chunkContext = buildContextFromChunks(relevantChunks);
        parts.push(chunkContext);
      }
    } else if (document.project_context.manual_text) {
      // Manual is small - use full text
      parts.push('## PRÍRUČKA / ŠPECIFIKÁCIA EXISTUJÚCEJ FUNKCIONALITY:\n');
      parts.push('(Toto je kontext existujúcej funkcionality, kde sa zmena aplikuje)\n');
      parts.push(document.project_context.manual_text);
      parts.push('\n---\n');
    }
  }

  // Then add page description
  parts.push(page.description);

  // Add page-level supplementary context if provided
  if (page.supplementary_context) {
    parts.push('\n## Dodatočný kontext k modulu:\n');

    if (page.supplementary_context.confluence_links && page.supplementary_context.confluence_links.length > 0) {
      parts.push('### Relevantné Confluence stránky:');
      page.supplementary_context.confluence_links.forEach((link) => {
        parts.push(`- ${link}`);
      });
      parts.push('');
    }

    if (page.supplementary_context.additional_text) {
      parts.push('### Dodatočné informácie:');
      parts.push(page.supplementary_context.additional_text);
      parts.push('');
    }
  }

  // Add change requests (these are the CHANGES to be tested)
  if (page.change_requests.length > 0) {
    parts.push('\n## ZMENOVÉ POŽIADAVKY (ČO SA MENÍ):\n');

    for (const cr of page.change_requests) {
      parts.push(`### ${cr.title}`);
      parts.push(cr.description);

      if (cr.affected_areas.length > 0) {
        parts.push(`\nOvlývnené oblasti: ${cr.affected_areas.join(', ')}`);
      }
      parts.push('');
    }
  }

  return parts.join('\n');
}

function buildPageAcceptanceCriteria(page: DocumentPage): string {
  const criteria: string[] = [];

  for (const cr of page.change_requests) {
    for (const ac of cr.acceptance_criteria) {
      criteria.push(`[${cr.title}] ${ac}`);
    }
  }

  return criteria.join('\n');
}

/**
 * Analyze if document is worth testing
 * Returns assessment with reasoning
 */
function assessDocumentForTesting(
  pages: DocumentPage[],
  contextLogger: ReturnType<typeof createContextLogger>
): {
  worthTesting: boolean;
  reason: string;
  severity: 'info' | 'warning';
} {
  // Count metrics
  const totalPages = pages.length;
  const totalChangeRequests = pages.reduce((sum, p) => sum + p.change_requests.length, 0);
  const totalAcceptanceCriteria = pages.reduce((sum, p) =>
    sum + p.change_requests.reduce((crSum, cr) => crSum + cr.acceptance_criteria.length, 0), 0
  );

  // Calculate content quality
  const avgDescriptionLength = pages.reduce((sum, p) => sum + p.description.length, 0) / totalPages;
  const pagesWithContent = pages.filter(p => p.description.length > 20 || p.change_requests.length > 0).length;

  // Decision logic - be critical but not overly strict

  // CRITICAL: No change requests at all - LLM likely created system components instead of changes
  if (totalChangeRequests === 0) {
    return {
      worthTesting: false,
      reason: `Dokument neobsahuje žiadne zmenové požiadavky v ${totalPages} moduloch. LLM pravdepodobne vytvoril systémové komponenty namiesto detekcie konkrétnych zmien. Skontroluj logy module_detection.`,
      severity: 'warning'
    };
  }

  // WARNING: Very little content across all pages
  if (totalPages > 2 && pagesWithContent === 0) {
    return {
      worthTesting: false,
      reason: `Dokument má ${totalPages} modulov, ale ani jeden neobsahuje zmenové požiadavky ani popis. Možno je dokument prázdny alebo LLM zlyhal pri extrakcii.`,
      severity: 'warning'
    };
  }

  // INFO: Low but acceptable content - generate but warn
  if (totalChangeRequests === 0 && avgDescriptionLength >= 30) {
    contextLogger.info('Document has no change requests but has descriptions - proceeding with generation', {
      avg_description_length: Math.round(avgDescriptionLength),
      total_pages: totalPages
    });
  }

  // If at least some pages have content, proceed with generation
  if (pagesWithContent > 0) {
    return {
      worthTesting: true,
      reason: `Dokument má ${pagesWithContent}/${totalPages} modulov s obsahom. Pokračujem s generovaním.`,
      severity: 'info'
    };
  }

  // Document is worth testing
  return {
    worthTesting: true,
    reason: `Dokument obsahuje ${totalPages} modulov, ${totalChangeRequests} zmenových požiadaviek a ${totalAcceptanceCriteria} akceptačných kritérií. Vhodný na testovanie.`,
    severity: 'info'
  };
}

/**
 * Generate tests for a processed document
 * Stores tests in component_tests for each component
 */
export async function generateTestsForDocument(
  documentId: string,
  jiraConfig: JiraConfig
): Promise<DocumentGenerationResult> {
  const contextLogger = createContextLogger({
    step: 'document_test_generation',
    document_id: documentId,
  });

  contextLogger.info('Starting test generation for document');

  const document = await getDocument(documentId);
  if (!document) {
    throw new Error(`Document not found: ${documentId}`);
  }

  if (document.status !== 'pages_detected' && document.status !== 'awaiting_manual' && document.status !== 'awaiting_context' && document.status !== 'completed') {
    throw new Error(`Document is not ready for generation. Status: ${document.status}`);
  }

  // Get project ID from document
  const docWithProject = document as ParsedWordDocument & { project_id?: string };
  const projectId = docWithProject.project_id;

  if (!projectId) {
    throw new Error('Document has no associated project');
  }

  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  try {
    await updateDocument(documentId, { ...document, status: 'generating' });

    contextLogger.info('Step 1: Planning coverage');
    const pages = document.pages || [];
    if (pages.length === 0) {
      throw new Error('Document has no pages detected');
    }

    // Assess if document is worth testing
    const assessment = assessDocumentForTesting(pages, contextLogger);
    contextLogger.info('Document assessment', {
      worth_testing: assessment.worthTesting,
      reason: assessment.reason
    });

    if (!assessment.worthTesting) {
      // Document is not worth testing - complete without generating
      await updateDocument(documentId, {
        ...document,
        status: 'completed',
        error: `Generovanie testov preskočené: ${assessment.reason}`
      });

      contextLogger.warn('Test generation skipped', { reason: assessment.reason });

      return {
        document_id: documentId,
        total_scenarios: 0,
        validated_scenarios: 0,
        needs_review_scenarios: 0,
        modules_processed: pages.length,
        job_ids: [],
        completed_at: new Date().toISOString(),
      };
    }

    const coveragePlan = planCoverage(pages, documentId);
    const metrics = estimateCoverageMetrics(pages, coveragePlan);
    contextLogger.info('Coverage plan created', {
      total_tests_planned: coveragePlan.total_tests_planned,
      tests_per_change_request: metrics.testsPerChangeRequest,
      tests_per_criterion: metrics.testsPerCriterion,
    });

    contextLogger.info('Step 2: Generating tests for pages');
    const jobIds: string[] = [];
    let totalScenarios = 0;
    let validatedScenarios = 0;
    let needsReviewScenarios = 0;

    const planByPageId = new Map(coveragePlan.modules.map(module => [module.module_id, module]));
    const componentId = document.module?.component_id;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pagePlan = planByPageId.get(page.module_id);

      contextLogger.info(`Generating tests for page ${i + 1}/${pages.length}`, {
        page_name: page.name,
        page_id: page.page_id,
        plan_tests: pagePlan?.tests_planned,
      });

      try {
        const result = await generateTestsForDocumentPage(
          page,
          pagePlan,
          document,
          jiraConfig,
          componentId,
          contextLogger
        );

        jobIds.push(result.jobId);
        totalScenarios += result.totalScenarios;
        validatedScenarios += result.validatedScenarios;
        needsReviewScenarios += result.needsReviewScenarios;
      } catch (error: any) {
        contextLogger.error(`Failed to generate tests for page: ${page.name}`, {
          error: error.message,
        });
      }
    }

    const generationResult: DocumentGenerationResult = {
      document_id: documentId,
      total_scenarios: totalScenarios,
      validated_scenarios: validatedScenarios,
      needs_review_scenarios: needsReviewScenarios,
      modules_processed: pages.length,
      job_ids: jobIds,
      completed_at: new Date().toISOString(),
    };

    await updateDocument(documentId, { ...document, status: 'completed' });

    contextLogger.info('Test generation completed', {
      total_scenarios: totalScenarios,
      validated_scenarios: validatedScenarios,
      needs_review_scenarios: needsReviewScenarios,
      jobs_created: jobIds.length,
    });

    return generationResult;

  } catch (error: any) {
    await updateDocument(documentId, {
      ...document,
      status: 'failed',
      error: error.message,
    });
    throw error;
  }
}

/**
 * Process multiple Word documents into a single project
 * All modules from all documents become components under one project
 */
export async function processMultipleDocuments(
  documents: MultiDocumentInput[],
  projectName: string,
  _jiraConfig: JiraConfig
): Promise<MultiDocumentProjectResult> {
  const contextLogger = createContextLogger({
    step: 'multi_document_processing',
    project_name: projectName,
    document_count: documents.length,
  });

  contextLogger.info('Starting multi-document processing');

  // Create the project first
  const project = await createProject({
    name: projectName,
    description: `Automaticky vytvoreny z ${documents.length} dokumentov`,
    metadata: {
      source_type: 'document',
      document_filename: documents.map(d => d.filename).join(', '),
    },
  });

  contextLogger.info('Project created', {
    project_id: project.project_id,
    project_name: project.name,
  });

  const documentIds: string[] = [];
  let totalPages = 0;
  let totalChangeRequests = 0;

  // Process each document
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const documentId = generateTestId();

    contextLogger.info(`Processing document ${i + 1}/${documents.length}: ${doc.filename}`, {
      document_id: documentId,
    });

    try {
      // Create initial document record
      const initialDocument: ParsedWordDocument = {
        document_id: documentId,
        filename: doc.filename,
        parsed_at: new Date().toISOString(),
        sections: [],
        pages: [],
        raw_text: '',
        status: 'uploaded',
      };
      await saveDocument(initialDocument);

      // Parse the document
      const parseResult = await parseWordDocument(doc.buffer, doc.filename);

      const parsedDocument: ParsedWordDocument = {
        ...initialDocument,
        sections: parseResult.sections,
        raw_text: parseResult.raw_text,
        status: 'parsed',
      };
      await updateDocument(documentId, parsedDocument);

      contextLogger.info('Document parsed', {
        document_id: documentId,
        sections_count: parseResult.sections.length,
      });

      const pageResult = await detectModules(
        parseResult.sections,
        parseResult.raw_text,
        documentId
      );

      if (!pageResult.success) {
        await updateDocument(documentId, {
          ...parsedDocument,
          status: 'failed',
          error: pageResult.error,
        });
        contextLogger.error('Page detection failed', {
          document_id: documentId,
          error: pageResult.error,
        });
        documentIds.push(documentId);
        continue;
      }

      const componentResult = await createDocumentModuleComponent(
        project.project_id,
        documentId,
        doc.filename,
        pageResult.modules
      );

      const documentWithPages: ParsedWordDocument = {
        ...parsedDocument,
        pages: componentResult.pages,
        module: componentResult.module,
        status: 'pages_detected',
      };

      await updateDocument(documentId, {
        ...documentWithPages,
        project_id: project.project_id,
      } as ParsedWordDocument & { project_id: string });

      contextLogger.info('Document pages detected', {
        document_id: documentId,
        pages_count: componentResult.pages.length,
      });

      totalPages += componentResult.pages.length;
      totalChangeRequests += componentResult.pages.reduce(
        (sum, page) => sum + page.change_requests.length,
        0
      );

      documentIds.push(documentId);

    } catch (error: any) {
      contextLogger.error('Document processing failed', {
        document_id: documentId,
        filename: doc.filename,
        error: error.message,
      });
      documentIds.push(documentId);
    }
  }

  contextLogger.info('Multi-document processing completed', {
    project_id: project.project_id,
    documents_processed: documentIds.length,
    total_pages: totalPages,
    total_change_requests: totalChangeRequests,
  });

  return {
    projectId: project.project_id,
    projectName: project.name,
    documentIds,
    totalPages,
    totalChangeRequests,
  };
}

/**
 * Derive project name from filename
 * Removes extension and cleans up the name
 */
function deriveProjectName(filename: string): string {
  // Remove extension
  let name = filename.replace(/\.(docx?|DOCX?)$/, '');

  // Replace underscores and dashes with spaces
  name = name.replace(/[_-]+/g, ' ');

  // Capitalize first letter
  name = name.charAt(0).toUpperCase() + name.slice(1);

  return name;
}

async function createDocumentModuleComponent(
  projectId: string,
  documentId: string,
  filename: string,
  detectedPages: DocumentPage[]
): Promise<{
  component: Component;
  module: DocumentModuleInfo;
  pages: DocumentPage[];
}> {
  const componentId = generateTestId();
  const now = new Date().toISOString();
  const moduleName = deriveProjectName(filename);
  const component: Component = {
    component_id: componentId,
    project_id: projectId,
    name: moduleName,
    description: `Automaticky vytvoreny z dokumentu: ${filename}`,
    page_ids: [],
    created_at: now,
    updated_at: now,
    source_module_id: documentId,
    priority: 'medium',
    change_requests: [],
  };

  await saveComponent(component);
  await addComponentToProject(projectId, componentId);

  const persistedPages: DocumentPage[] = [];

  for (const page of detectedPages) {
    const pageId = generateTestId();
    const pageRecord: Page = {
      page_id: pageId,
      component_id: componentId,
      project_id: projectId,
      confluence_link: `document://${documentId}/${pageId}`,
      confluence_page_id: undefined,
      name: page.name,
      created_at: now,
      updated_at: now,
      job_history: [],
      source_type: 'document',
      document_id: documentId,
      document_page_id: page.module_id,
    };

    await savePage(pageRecord);
    await addPageToComponent(componentId, pageId);
    component.page_ids.push(pageId);

    persistedPages.push({
      ...page,
      page_id: pageId,
    });
  }

  const moduleInfo: DocumentModuleInfo = {
    module_id: component.component_id,
    name: component.name,
    description: component.description,
    component_id: component.component_id,
    page_ids: [...component.page_ids],
  };

  return { component, module: moduleInfo, pages: persistedPages };
}
