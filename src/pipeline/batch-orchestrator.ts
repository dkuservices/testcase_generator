import { BatchJobOptions, AggregationResults, ScenarioWithSource } from '../models/batch-job';
import { SpecificationInput } from '../models/specification-input';
import { Job } from '../models/job';
import { JiraConfig } from '../models/config';
import { updateBatchJob } from '../storage/batch-job-store';
import { saveJob, getJob, updateJob } from '../storage/job-store';
import { executePipeline } from './pipeline-orchestrator';
import { isValidConfluenceUrl, extractPageIdFromUrl } from '../utils/confluence-url-parser';
import { fetchConfluencePage } from '../integrations/confluence-client';
import { deduplicateScenarios } from './deduplicator';
import { generateModuleLevelTests } from './module-test-generator';
import { generateBatchSummary } from './batch-summary-generator';
import { createContextLogger } from '../utils/logger';
import { generateTestId } from '../utils/uuid-generator';

const MAX_PARALLEL_JOBS = parseInt(process.env.BATCH_MAX_PARALLEL_JOBS || '3', 10);

export async function executeBatchPipeline(
  batchJobId: string,
  options: BatchJobOptions,
  jiraConfig: JiraConfig
): Promise<void> {
  const contextLogger = createContextLogger({
    batch_job_id: batchJobId,
    total_pages: options.links.length,
  });

  contextLogger.info('Batch pipeline execution started');

  try {
    // Phase 1: Validate all URLs
    contextLogger.info('Phase 1: Validating Confluence URLs');
    for (const link of options.links) {
      if (!isValidConfluenceUrl(link)) {
        throw new Error(`Invalid Confluence URL: ${link}`);
      }
    }

    // Phase 2: Create sub-jobs for each page
    contextLogger.info('Phase 2: Creating sub-jobs');
    const subJobIds: string[] = [];

    for (const link of options.links) {
      const pageId = extractPageIdFromUrl(link);
      if (!pageId) {
        throw new Error(`Could not extract page ID from: ${link}`);
      }

      const subJobId = generateTestId();
      const input: SpecificationInput = { link };

      const subJob: Job = {
        job_id: subJobId,
        status: 'processing',
        input,
        created_at: new Date().toISOString(),
        batch_job_id: batchJobId, // Link to parent
      };

      await saveJob(subJob);
      subJobIds.push(subJobId);
    }

    await updateBatchJob(batchJobId, { sub_jobs: subJobIds });

    // Phase 3: Process sub-jobs with concurrency control
    // IMPORTANT: Module-level tests require page-level scenarios to analyze,
    // so we MUST run the full pipeline if module-level generation is requested
    const needsPipeline = options.generate_page_level_tests || options.generate_module_level_tests;

    if (needsPipeline) {
      const reason = options.generate_page_level_tests
        ? 'page-level tests requested'
        : 'module-level tests require page scenarios';

      contextLogger.info(`Phase 3: Processing through full pipeline (${reason})`, {
        total_jobs: subJobIds.length,
        parallel_limit: MAX_PARALLEL_JOBS,
        save_page_tests: options.generate_page_level_tests,
      });

      await processSubJobsInParallel(
        subJobIds,
        jiraConfig,
        MAX_PARALLEL_JOBS,
        contextLogger
      );
    } else {
      // Both checkboxes unchecked - this shouldn't happen but handle it
      contextLogger.warn('Phase 3: No tests requested - batch will produce no results');
      await fetchPagesForSubJobs(subJobIds, contextLogger);
    }

    // Phase 4: Aggregation (if module-level tests enabled)
    let aggregationResults: AggregationResults | undefined;

    if (options.generate_module_level_tests) {
      contextLogger.info('Phase 4: Running aggregation and module-level test generation');
      aggregationResults = await runAggregation(
        batchJobId,
        subJobIds,
        jiraConfig,
        contextLogger
      );
    } else {
      contextLogger.info('Phase 4: Skipping aggregation (module-level tests not requested)');
    }

    // Phase 5: Mark batch as completed
    contextLogger.info('Phase 5: Finalizing batch job');
    await updateBatchJob(batchJobId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      aggregation_results: aggregationResults,
    });

    contextLogger.info('Batch pipeline execution completed successfully');

  } catch (error) {
    contextLogger.error('Batch pipeline execution failed', {
      error: (error as Error).message,
    });

    await updateBatchJob(batchJobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: (error as Error).message,
    });

    throw error;
  }
}

async function processSubJobsInParallel(
  subJobIds: string[],
  jiraConfig: JiraConfig,
  maxParallel: number,
  contextLogger: any
): Promise<void> {
  const queue = [...subJobIds];
  const inProgress = new Set<Promise<void>>();

  while (queue.length > 0 || inProgress.size > 0) {
    // Fill up to maxParallel
    while (queue.length > 0 && inProgress.size < maxParallel) {
      const jobId = queue.shift()!;
      const promise = processSubJob(jobId, jiraConfig, contextLogger)
        .finally(() => inProgress.delete(promise));
      inProgress.add(promise);
    }

    // Wait for at least one to complete
    if (inProgress.size > 0) {
      await Promise.race(inProgress);
    }
  }
}

async function processSubJob(
  jobId: string,
  jiraConfig: JiraConfig,
  contextLogger: any
): Promise<void> {
  try {
    const job = await getJob(jobId);
    if (!job) {
      throw new Error(`Sub-job not found: ${jobId}`);
    }

    contextLogger.info('Processing sub-job', { job_id: jobId, link: job.input.link });

    // Fetch Confluence page
    const pageId = extractPageIdFromUrl(job.input.link!);
    const confluenceData = await fetchConfluencePage(pageId!);

    if (!confluenceData) {
      throw new Error(`Failed to fetch page: ${job.input.link}`);
    }

    // Execute normal pipeline
    const results = await executePipeline(confluenceData, jiraConfig, jobId);

    // Update sub-job
    await updateJob(jobId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      results,
    });

    contextLogger.info('Sub-job completed', { job_id: jobId });

  } catch (error) {
    contextLogger.error('Sub-job failed', {
      job_id: jobId,
      error: (error as Error).message
    });

    await updateJob(jobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: (error as Error).message,
    });
  }
}

async function fetchPagesForSubJobs(
  subJobIds: string[],
  contextLogger: any
): Promise<void> {
  // Fetch pages without running full pipeline (for module-level generation)
  for (const jobId of subJobIds) {
    try {
      const job = await getJob(jobId);
      if (!job) continue;

      const pageId = extractPageIdFromUrl(job.input.link!);
      // Fetch page to validate it exists (result not needed for this flow)
      await fetchConfluencePage(pageId!);

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

    } catch (error) {
      contextLogger.error('Failed to fetch page', { job_id: jobId });
    }
  }
}

async function runAggregation(
  batchJobId: string,
  subJobIds: string[],
  jiraConfig: JiraConfig,
  contextLogger: any
): Promise<AggregationResults> {
  // Collect all scenarios from successful sub-jobs
  const allScenarios: ScenarioWithSource[] = [];
  const pageIds: string[] = [];

  for (const jobId of subJobIds) {
    const job = await getJob(jobId);
    if (job?.status === 'completed' && job.results) {
      const pageId = extractPageIdFromUrl(job.input.link!) || 'unknown';
      pageIds.push(pageId);

      for (const scenario of job.results.scenarios) {
        allScenarios.push({
          scenario,
          source_page_id: pageId,
          source_job_id: jobId,
        });
      }
    }
  }

  contextLogger.info('Aggregation: Collected scenarios', {
    total_scenarios: allScenarios.length,
    total_pages: pageIds.length,
  });

  // Run deduplication
  const { uniqueScenarios, duplicateGroups } = await deduplicateScenarios(
    allScenarios,
    batchJobId,
    contextLogger
  );

  contextLogger.info('Aggregation: Deduplication completed', {
    unique_scenarios: uniqueScenarios.length,
    duplicates_removed: allScenarios.length - uniqueScenarios.length,
  });

  // Generate module-level tests
  const moduleLevelScenarios = await generateModuleLevelTests(
    uniqueScenarios,
    jiraConfig,
    batchJobId,
    contextLogger
  );

  contextLogger.info('Aggregation: Module-level tests generated', {
    module_test_count: moduleLevelScenarios.length,
  });

  // Generate summary
  const summary = await generateBatchSummary(
    batchJobId,
    pageIds,
    uniqueScenarios,
    moduleLevelScenarios,
    duplicateGroups,
    contextLogger
  );

  const aggregationResults: AggregationResults = {
    total_pages: pageIds.length,
    total_scenarios: uniqueScenarios.length,
    deduplicated_count: allScenarios.length - uniqueScenarios.length,
    module_level_scenarios: moduleLevelScenarios,
    summary,
  };

  return aggregationResults;
}
