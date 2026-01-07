import { generateDailyCostReport } from './cost-tracker';
import { generateDailyMetricsReport } from './metrics-collector';
import { PricingConfig } from '../models/config';
import logger from '../utils/logger';

export async function generateAllDailyReports(pricingConfig: PricingConfig): Promise<void> {
  logger.info('Generating all daily reports');

  try {
    await generateDailyCostReport(pricingConfig);
    await generateDailyMetricsReport();

    logger.info('All daily reports generated successfully');
  } catch (error) {
    logger.error('Failed to generate daily reports', {
      error: (error as Error).message,
    });
  }
}
