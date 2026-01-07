import path from 'path';
import cron from 'node-cron';
import { listJobs } from '../storage/job-store';
import { writeJSON, ensureDirectoryExists } from '../storage/json-storage';
import logger from '../utils/logger';

interface DailyMetricsReport {
  date: string;
  jobs: {
    total: number;
    completed: number;
    failed: number;
    success_rate: number;
  };
  scenarios: {
    total_generated: number;
    validated: number;
    needs_review: number;
    validation_rate: number;
  };
  performance: {
    avg_pipeline_duration_ms: number;
    avg_llm_response_time_ms: number;
    p95_pipeline_duration_ms: number;
  };
}

interface PipelineMetric {
  job_id: string;
  duration_ms: number;
  llm_response_time_ms?: number;
}

const dailyMetrics: PipelineMetric[] = [];

export function trackPipelineMetric(jobId: string, durationMs: number, llmResponseTimeMs?: number): void {
  dailyMetrics.push({
    job_id: jobId,
    duration_ms: durationMs,
    llm_response_time_ms: llmResponseTimeMs,
  });

  logger.debug('Pipeline metric tracked', {
    job_id: jobId,
    duration_ms: durationMs,
    llm_response_time_ms: llmResponseTimeMs,
  });
}

export function initializeMetricsCollection(): cron.ScheduledTask {
  logger.info('Initializing metrics collection with daily report generation');

  const task = cron.schedule('0 0 * * *', async () => {
    await generateDailyMetricsReport();
  });

  logger.info('Metrics collection initialized');

  return task;
}

export async function generateDailyMetricsReport(): Promise<void> {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  const dateStr = date.toISOString().split('T')[0];

  logger.info('Generating daily metrics report', { date: dateStr });

  try {
    const startOfDay = new Date(dateStr);
    const endOfDay = new Date(dateStr);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const allJobs = await listJobs(
      { since: startOfDay.toISOString() },
      { limit: 10000, offset: 0 }
    );

    const jobs = allJobs.jobs;

    const completedJobs = jobs.filter(j => j.status === 'completed').length;
    const failedJobs = jobs.filter(j => j.status === 'failed').length;
    const successRate = jobs.length > 0 ? completedJobs / jobs.length : 0;

    let totalGenerated = 0;
    let validated = 0;
    let needsReview = 0;

    for (const jobSummary of jobs) {
      if (jobSummary.scenario_count) {
        totalGenerated += jobSummary.scenario_count;
      }
    }

    const validationRate = totalGenerated > 0 ? validated / totalGenerated : 0;

    const durations = dailyMetrics.map(m => m.duration_ms).filter(d => d > 0);
    const llmTimes = dailyMetrics.map(m => m.llm_response_time_ms).filter(t => t !== undefined && t > 0) as number[];

    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const avgLlmTime = llmTimes.length > 0 ? llmTimes.reduce((a, b) => a + b, 0) / llmTimes.length : 0;

    durations.sort((a, b) => a - b);
    const p95Index = Math.floor(durations.length * 0.95);
    const p95Duration = durations.length > 0 ? durations[p95Index] || 0 : 0;

    const report: DailyMetricsReport = {
      date: dateStr,
      jobs: {
        total: jobs.length,
        completed: completedJobs,
        failed: failedJobs,
        success_rate: parseFloat(successRate.toFixed(2)),
      },
      scenarios: {
        total_generated: totalGenerated,
        validated,
        needs_review: needsReview,
        validation_rate: parseFloat(validationRate.toFixed(2)),
      },
      performance: {
        avg_pipeline_duration_ms: Math.round(avgDuration),
        avg_llm_response_time_ms: Math.round(avgLlmTime),
        p95_pipeline_duration_ms: Math.round(p95Duration),
      },
    };

    await ensureDirectoryExists(path.join(process.cwd(), 'logs', 'metrics'));

    const filePath = path.join(process.cwd(), 'logs', 'metrics', `${dateStr}.json`);
    await writeJSON(filePath, report);

    logger.info('Daily metrics report generated', {
      date: dateStr,
      total_jobs: report.jobs.total,
      success_rate: report.jobs.success_rate,
    });

    dailyMetrics.length = 0;
  } catch (error) {
    logger.error('Failed to generate daily metrics report', {
      date: dateStr,
      error: (error as Error).message,
    });
  }
}
