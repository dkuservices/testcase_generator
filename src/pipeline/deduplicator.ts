import path from 'path';
import { ScenarioWithSource, DuplicateGroup } from '../models/batch-job';
import { GeneratedTestScenario } from '../models/test-scenario';
import { calculateSimilarity } from '../utils/text-similarity';
import { writeJSON } from '../storage/json-storage';

const SIMILARITY_THRESHOLD = parseFloat(process.env.BATCH_DEDUP_SIMILARITY_THRESHOLD || '0.85');
const DEDUP_DIR = path.join(process.cwd(), 'data', 'deduplications');

export async function deduplicateScenarios(
  scenarios: ScenarioWithSource[],
  batchJobId: string,
  contextLogger: any
): Promise<{
  uniqueScenarios: ScenarioWithSource[];
  duplicateGroups: DuplicateGroup[];
}> {
  contextLogger.info('Starting deduplication', {
    total_scenarios: scenarios.length,
    threshold: SIMILARITY_THRESHOLD,
  });

  const uniqueScenarios: ScenarioWithSource[] = [];
  const duplicateGroups: DuplicateGroup[] = [];
  const processed = new Set<number>();

  for (let i = 0; i < scenarios.length; i++) {
    if (processed.has(i)) continue;

    const current = scenarios[i];
    const currentText = getScenarioText(current.scenario);

    const duplicates: ScenarioWithSource[] = [];
    let maxSimilarity = 0;

    // Compare with remaining scenarios
    for (let j = i + 1; j < scenarios.length; j++) {
      if (processed.has(j)) continue;

      const candidate = scenarios[j];
      const candidateText = getScenarioText(candidate.scenario);

      const similarity = calculateSimilarity(currentText, candidateText);

      if (similarity >= SIMILARITY_THRESHOLD) {
        duplicates.push(candidate);
        processed.add(j);
        maxSimilarity = Math.max(maxSimilarity, similarity);
      }
    }

    uniqueScenarios.push(current);
    processed.add(i);

    if (duplicates.length > 0) {
      duplicateGroups.push({
        kept_scenario: current,
        duplicates,
        similarity_score: maxSimilarity,
      });

      contextLogger.debug('Duplicate group found', {
        kept_test_id: current.scenario.test_id,
        kept_test_name: current.scenario.test_name,
        duplicate_count: duplicates.length,
        similarity: maxSimilarity.toFixed(3),
      });
    }
  }

  // Save deduplication report
  await saveDedupReport(batchJobId, duplicateGroups);

  contextLogger.info('Deduplication completed', {
    unique_scenarios: uniqueScenarios.length,
    duplicate_groups: duplicateGroups.length,
    total_duplicates: scenarios.length - uniqueScenarios.length,
  });

  return { uniqueScenarios, duplicateGroups };
}

function getScenarioText(scenario: GeneratedTestScenario): string {
  // Combine test name, description, preconditions, and steps for comparison
  const preconditionsText = Array.isArray(scenario.preconditions)
    ? scenario.preconditions.join(' ')
    : '';

  const testStepsText = Array.isArray(scenario.test_steps)
    ? scenario.test_steps.map(step =>
        `${step.action} ${step.input} ${step.expected_result}`
      ).join(' ')
    : '';

  return [
    scenario.test_name || '',
    scenario.description || '',
    preconditionsText,
    testStepsText,
  ]
    .join(' ')
    .toLowerCase();
}

async function saveDedupReport(
  batchJobId: string,
  duplicateGroups: DuplicateGroup[]
): Promise<void> {
  const filePath = path.join(DEDUP_DIR, `${batchJobId}_dedup.json`);

  const report = {
    batch_job_id: batchJobId,
    timestamp: new Date().toISOString(),
    similarity_threshold: SIMILARITY_THRESHOLD,
    total_duplicate_groups: duplicateGroups.length,
    total_duplicates_removed: duplicateGroups.reduce((sum, g) => sum + g.duplicates.length, 0),
    duplicate_groups: duplicateGroups.map(group => ({
      kept_scenario: {
        test_id: group.kept_scenario.scenario.test_id,
        test_name: group.kept_scenario.scenario.test_name,
        source_page_id: group.kept_scenario.source_page_id,
        source_job_id: group.kept_scenario.source_job_id,
      },
      duplicates: group.duplicates.map(dup => ({
        test_id: dup.scenario.test_id,
        test_name: dup.scenario.test_name,
        source_page_id: dup.source_page_id,
        source_job_id: dup.source_job_id,
      })),
      similarity_score: group.similarity_score,
    })),
  };

  await writeJSON(filePath, report);
}
