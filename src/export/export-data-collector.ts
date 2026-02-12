import path from 'path';
import { readJSON, listFiles, fileExists } from '../storage/json-storage';
import { Job } from '../models/job';
import { ExportOptions, ExportScenarioEntry } from './export-types';
import logger from '../utils/logger';

export async function collectExportData(options: ExportOptions): Promise<ExportScenarioEntry[]> {
  const jobsDir = path.join(process.cwd(), 'data', 'jobs');

  if (!(await fileExists(jobsDir))) {
    return [];
  }

  const files = options.jobId
    ? [`${options.jobId}.json`]
    : await listFiles(jobsDir, '.json');

  const scenarios: ExportScenarioEntry[] = [];

  for (const file of files) {
    const jobPath = path.join(jobsDir, file);

    if (!(await fileExists(jobPath))) {
      continue;
    }

    let job: Job;
    try {
      job = await readJSON<Job>(jobPath);
    } catch (error) {
      logger.warn('Failed to read job for export', {
        file,
        error: (error as Error).message,
      });
      continue;
    }

    if (!job.results?.scenarios) {
      continue;
    }

    for (const scenario of job.results.scenarios) {
      if (options.statuses.includes(scenario.validation_status as any)) {
        scenarios.push({
          job_id: job.job_id,
          job_created_at: job.created_at,
          job_completed_at: job.completed_at,
          source_title: job.input.title,
          source_link: job.input.link,
          confluence_page_id:
            job.input.confluence_page_id || scenario.traceability?.source_confluence_page_id,
          parent_jira_issue_id:
            job.input.metadata?.parent_jira_issue_id || scenario.parent_jira_issue_id,
          scenario,
        });
      }
    }
  }

  scenarios.sort(
    (a, b) => new Date(b.job_created_at).getTime() - new Date(a.job_created_at).getTime()
  );

  return scenarios;
}
