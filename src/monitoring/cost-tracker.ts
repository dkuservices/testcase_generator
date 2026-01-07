import path from 'path';
import cron from 'node-cron';
import { PricingConfig } from '../models/config';
import { writeJSON, readJSON, fileExists, ensureDirectoryExists } from '../storage/json-storage';
import logger from '../utils/logger';

interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  model: string;
  timestamp: string;
  job_id?: string;
  mode?: string;
}

interface DailyCostReport {
  date: string;
  model: string;
  total_requests: number;
  total_tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  estimated_cost_usd: number;
  breakdown_by_mode: {
    [mode: string]: {
      requests: number;
      cost_usd: number;
    };
  };
  pricing: {
    prompt_per_1k: number;
    completion_per_1k: number;
  };
}

const dailyUsages: TokenUsage[] = [];

export function trackTokenUsage(
  promptTokens: number,
  completionTokens: number,
  totalTokens: number,
  model: string,
  jobId?: string,
  mode: string = 'manual'
): void {
  const usage: TokenUsage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    model,
    timestamp: new Date().toISOString(),
    job_id: jobId,
    mode,
  };

  dailyUsages.push(usage);

  logger.log('silly', 'Token usage tracked', usage);
}

export function initializeCostTracking(pricingConfig: PricingConfig): cron.ScheduledTask {
  logger.info('Initializing cost tracking with daily report generation');

  const task = cron.schedule('0 0 * * *', async () => {
    await generateDailyCostReport(pricingConfig);
  });

  logger.info('Cost tracking initialized');

  return task;
}

export async function generateDailyCostReport(pricingConfig: PricingConfig): Promise<void> {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  const dateStr = date.toISOString().split('T')[0];

  logger.info('Generating daily cost report', { date: dateStr });

  try {
    if (dailyUsages.length === 0) {
      logger.info('No token usage to report for the day', { date: dateStr });
      return;
    }

    const modelUsages = groupByModel(dailyUsages);

    await ensureDirectoryExists(path.join(process.cwd(), 'logs', 'cost-reports'));

    for (const [model, usages] of Object.entries(modelUsages)) {
      const report = buildCostReport(model, usages, pricingConfig, dateStr);

      const filePath = path.join(process.cwd(), 'logs', 'cost-reports', `${dateStr}_${model}.json`);
      await writeJSON(filePath, report);

      logger.info('Daily cost report generated', {
        date: dateStr,
        model,
        total_requests: report.total_requests,
        estimated_cost_usd: report.estimated_cost_usd,
      });
    }

    dailyUsages.length = 0;
  } catch (error) {
    logger.error('Failed to generate daily cost report', {
      date: dateStr,
      error: (error as Error).message,
    });
  }
}

function groupByModel(usages: TokenUsage[]): Record<string, TokenUsage[]> {
  const grouped: Record<string, TokenUsage[]> = {};

  for (const usage of usages) {
    if (!grouped[usage.model]) {
      grouped[usage.model] = [];
    }
    grouped[usage.model].push(usage);
  }

  return grouped;
}

function buildCostReport(
  model: string,
  usages: TokenUsage[],
  pricingConfig: PricingConfig,
  date: string
): DailyCostReport {
  const pricing = pricingConfig[model] || pricingConfig['gpt-4-turbo'];

  const totalPromptTokens = usages.reduce((sum, u) => sum + u.prompt_tokens, 0);
  const totalCompletionTokens = usages.reduce((sum, u) => sum + u.completion_tokens, 0);
  const totalTokens = usages.reduce((sum, u) => sum + u.total_tokens, 0);

  const promptCost = (totalPromptTokens / 1000) * pricing.prompt_per_1k_tokens;
  const completionCost = (totalCompletionTokens / 1000) * pricing.completion_per_1k_tokens;
  const totalCost = promptCost + completionCost;

  const breakdownByMode: Record<string, { requests: number; cost_usd: number }> = {};

  for (const usage of usages) {
    const mode = usage.mode || 'unknown';

    if (!breakdownByMode[mode]) {
      breakdownByMode[mode] = { requests: 0, cost_usd: 0 };
    }

    breakdownByMode[mode].requests++;

    const usagePromptCost = (usage.prompt_tokens / 1000) * pricing.prompt_per_1k_tokens;
    const usageCompletionCost = (usage.completion_tokens / 1000) * pricing.completion_per_1k_tokens;
    breakdownByMode[mode].cost_usd += usagePromptCost + usageCompletionCost;
  }

  return {
    date,
    model,
    total_requests: usages.length,
    total_tokens: {
      prompt: totalPromptTokens,
      completion: totalCompletionTokens,
      total: totalTokens,
    },
    estimated_cost_usd: parseFloat(totalCost.toFixed(2)),
    breakdown_by_mode: breakdownByMode,
    pricing: {
      prompt_per_1k: pricing.prompt_per_1k_tokens,
      completion_per_1k: pricing.completion_per_1k_tokens,
    },
  };
}
