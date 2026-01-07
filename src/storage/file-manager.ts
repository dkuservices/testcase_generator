import path from 'path';
import { GeneratedTestScenario } from '../models/test-scenario';
import { writeJSON, readJSON, fileExists } from './json-storage';
import logger from '../utils/logger';

export async function saveGeneratedScenarios(
  confluencePageId: string,
  scenarios: GeneratedTestScenario[]
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${confluencePageId}_${timestamp}.json`;
  const filePath = path.join(process.cwd(), 'data', 'generated', filename);

  await writeJSON(filePath, scenarios);

  logger.info('Generated scenarios saved', {
    confluence_page_id: confluencePageId,
    scenario_count: scenarios.length,
    file_path: filePath,
  });

  return filePath;
}

export async function saveNeedsReviewScenarios(
  confluencePageId: string,
  scenarios: GeneratedTestScenario[]
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${confluencePageId}_${timestamp}.json`;
  const filePath = path.join(process.cwd(), 'data', 'needs_review', filename);

  await writeJSON(filePath, scenarios);

  logger.warn('Scenarios marked for review saved', {
    confluence_page_id: confluencePageId,
    scenario_count: scenarios.length,
    file_path: filePath,
  });

  return filePath;
}

export async function saveJiraPayload(
  confluencePageId: string,
  testId: string,
  payload: any
): Promise<string> {
  const filename = `${confluencePageId}_${testId}.json`;
  const filePath = path.join(process.cwd(), 'data', 'jira_payloads', filename);

  await writeJSON(filePath, payload);

  logger.debug('Jira payload saved', {
    confluence_page_id: confluencePageId,
    test_id: testId,
    file_path: filePath,
  });

  return filePath;
}

export async function saveJiraPayloadSummary(
  confluencePageId: string,
  summary: {
    total_scenarios: number;
    validated_count: number;
    failed_count: number;
    file_paths: string[];
  }
): Promise<string> {
  const filename = `${confluencePageId}_summary.json`;
  const filePath = path.join(process.cwd(), 'data', 'jira_payloads', filename);

  await writeJSON(filePath, summary);

  logger.info('Jira payload summary saved', {
    confluence_page_id: confluencePageId,
    ...summary,
  });

  return filePath;
}

export async function saveMetadata(
  confluencePageId: string,
  metadata: {
    timestamp: string;
    specification_version: string;
    confluence_page_id: string;
  }
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${confluencePageId}_${timestamp}_metadata.json`;
  const filePath = path.join(process.cwd(), 'data', 'metadata', filename);

  await writeJSON(filePath, metadata);

  logger.debug('Metadata saved', { confluence_page_id: confluencePageId });

  return filePath;
}

export async function readSchedulerState(): Promise<{ last_run: string } | null> {
  const filePath = path.join(process.cwd(), 'data', 'scheduler_state.json');

  if (!(await fileExists(filePath))) {
    return null;
  }

  try {
    return await readJSON<{ last_run: string }>(filePath);
  } catch (error) {
    logger.error('Failed to read scheduler state', { error: (error as Error).message });
    return null;
  }
}

export async function saveSchedulerState(lastRun: string): Promise<void> {
  const filePath = path.join(process.cwd(), 'data', 'scheduler_state.json');
  await writeJSON(filePath, { last_run: lastRun });
  logger.debug('Scheduler state saved', { last_run: lastRun });
}
