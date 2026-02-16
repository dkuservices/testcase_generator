import path from 'path';
import { Job, JobSummary } from '../models/job';
import { readJSON, writeJSON, fileExists, listFiles, deleteFile } from './json-storage';
import logger from '../utils/logger';

const JOBS_DIR = path.join(process.cwd(), 'data', 'jobs');

export async function saveJob(job: Job): Promise<void> {
  const filePath = path.join(JOBS_DIR, `${job.job_id}.json`);
  await writeJSON(filePath, job);
  logger.debug('Job saved', { job_id: job.job_id, status: job.status });
}

export async function createJob(job: Partial<Job> & { job_id: string }): Promise<Job> {
  const fullJob: Job = {
    job_id: job.job_id,
    status: job.status || 'processing',
    created_at: job.created_at || new Date().toISOString(),
    input: job.input || {
      title: '',
      description: '',
      acceptance_criteria: '',
      metadata: {
        system_type: 'web',
        feature_priority: 'medium',
        parent_jira_issue_id: '',
      },
    },
    completed_at: job.completed_at,
    results: job.results,
    error: job.error,
    component_id: job.component_id,
    project_id: job.project_id,
    page_id: job.page_id,
    document_id: job.document_id,
  };

  await saveJob(fullJob);
  return fullJob;
}

export async function getJob(jobId: string): Promise<Job | null> {
  const filePath = path.join(JOBS_DIR, `${jobId}.json`);

  if (!(await fileExists(filePath))) {
    return null;
  }

  try {
    return await readJSON<Job>(filePath);
  } catch (error) {
    logger.error('Failed to read job', { job_id: jobId, error: (error as Error).message });
    return null;
  }
}

export async function updateJob(jobId: string, updates: Partial<Job>): Promise<void> {
  const job = await getJob(jobId);

  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const updatedJob = { ...job, ...updates };
  await saveJob(updatedJob);
}

export async function deleteJob(jobId: string): Promise<string[]> {
  const filePath = path.join(JOBS_DIR, `${jobId}.json`);
  const deletedFiles: string[] = [];

  if (await fileExists(filePath)) {
    await deleteFile(filePath);
    deletedFiles.push(filePath);
  }

  return deletedFiles;
}

export async function getJobsBulk(jobIds: string[]): Promise<Map<string, Job>> {
  const result = new Map<string, Job>();
  await Promise.all(
    jobIds.map(async (jobId) => {
      const filePath = path.join(JOBS_DIR, `${jobId}.json`);
      try {
        if (await fileExists(filePath)) {
          const job = await readJSON<Job>(filePath);
          result.set(jobId, job);
        }
      } catch (error) {
        logger.warn('Failed to read job in bulk', { job_id: jobId, error: (error as Error).message });
      }
    })
  );
  return result;
}

export async function listJobs(
  filters?: {
    status?: 'processing' | 'completed' | 'failed' | 'cancelled';
    since?: string;
  },
  pagination?: {
    limit: number;
    offset: number;
  }
): Promise<{ total: number; jobs: JobSummary[] }> {
  const files = await listFiles(JOBS_DIR, '.json');

  let jobs: Job[] = [];
  for (const file of files) {
    const filePath = path.join(JOBS_DIR, file);
    try {
      const job = await readJSON<Job>(filePath);
      jobs.push(job);
    } catch (error) {
      logger.warn('Failed to read job file', { file, error: (error as Error).message });
    }
  }

  if (filters?.status) {
    jobs = jobs.filter(job => job.status === filters.status);
  }

  if (filters?.since) {
    jobs = jobs.filter(job => new Date(job.created_at) >= new Date(filters.since!));
  }

  jobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const total = jobs.length;

  if (pagination) {
    const { limit, offset } = pagination;
    jobs = jobs.slice(offset, offset + limit);
  }

  const jobSummaries: JobSummary[] = jobs.map(job => ({
    job_id: job.job_id,
    status: job.status,
    parent_jira_issue_id: job.input.metadata?.parent_jira_issue_id || '',
    created_at: job.created_at,
    completed_at: job.completed_at,
    scenario_count: job.results?.total_scenarios,
  }));

  return { total, jobs: jobSummaries };
}
