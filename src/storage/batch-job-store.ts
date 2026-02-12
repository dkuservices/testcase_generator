import path from 'path';
import { BatchJob, BatchJobSummary } from '../models/batch-job';
import { readJSON, writeJSON, fileExists, listFiles, deleteFile } from './json-storage';
import { getJob } from './job-store';
import logger from '../utils/logger';

const BATCH_JOBS_DIR = path.join(process.cwd(), 'data', 'batch_jobs');

export async function saveBatchJob(batchJob: BatchJob): Promise<void> {
  const filePath = path.join(BATCH_JOBS_DIR, `${batchJob.batch_job_id}.json`);
  await writeJSON(filePath, batchJob);
  logger.debug('Batch job saved', { batch_job_id: batchJob.batch_job_id, status: batchJob.status });
}

export async function getBatchJob(batchJobId: string): Promise<BatchJob | null> {
  const filePath = path.join(BATCH_JOBS_DIR, `${batchJobId}.json`);

  if (!(await fileExists(filePath))) {
    return null;
  }

  try {
    return await readJSON<BatchJob>(filePath);
  } catch (error) {
    logger.error('Failed to read batch job', { batch_job_id: batchJobId, error: (error as Error).message });
    return null;
  }
}

export async function updateBatchJob(
  batchJobId: string,
  updates: Partial<BatchJob>
): Promise<void> {
  const batchJob = await getBatchJob(batchJobId);

  if (!batchJob) {
    throw new Error(`Batch job not found: ${batchJobId}`);
  }

  const updatedBatchJob = { ...batchJob, ...updates };
  await saveBatchJob(updatedBatchJob);
}

export async function deleteBatchJob(batchJobId: string): Promise<string[]> {
  const filePath = path.join(BATCH_JOBS_DIR, `${batchJobId}.json`);
  const deletedFiles: string[] = [];

  if (await fileExists(filePath)) {
    await deleteFile(filePath);
    deletedFiles.push(filePath);
  }

  return deletedFiles;
}

export async function listBatchJobs(
  filters?: {
    status?: 'processing' | 'completed' | 'failed' | 'partial';
    since?: string;
  },
  pagination?: {
    limit: number;
    offset: number;
  }
): Promise<{ total: number; batchJobs: BatchJobSummary[] }> {
  const files = await listFiles(BATCH_JOBS_DIR, '.json');

  let batchJobs: BatchJob[] = [];
  for (const file of files) {
    const filePath = path.join(BATCH_JOBS_DIR, file);
    try {
      const batchJob = await readJSON<BatchJob>(filePath);
      batchJobs.push(batchJob);
    } catch (error) {
      logger.warn('Failed to read batch job file', { file, error: (error as Error).message });
    }
  }

  // Apply filters
  if (filters?.status) {
    batchJobs = batchJobs.filter(bj => bj.status === filters.status);
  }

  if (filters?.since) {
    batchJobs = batchJobs.filter(bj =>
      new Date(bj.created_at) >= new Date(filters.since!)
    );
  }

  // Sort by created_at descending
  batchJobs.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const total = batchJobs.length;

  // Apply pagination
  if (pagination) {
    const { limit, offset } = pagination;
    batchJobs = batchJobs.slice(offset, offset + limit);
  }

  // Convert to summaries
  const summaries: BatchJobSummary[] = await Promise.all(
    batchJobs.map(async (bj) => {
      // Count completed sub-jobs
      let completedCount = 0;
      for (const sjId of bj.sub_jobs) {
        const job = await getJob(sjId);
        if (job?.status === 'completed') {
          completedCount++;
        }
      }

      return {
        batch_job_id: bj.batch_job_id,
        status: bj.status,
        total_pages: bj.options.links.length,
        completed_pages: completedCount,
        created_at: bj.created_at,
        completed_at: bj.completed_at,
      };
    })
  );

  return { total, batchJobs: summaries };
}
