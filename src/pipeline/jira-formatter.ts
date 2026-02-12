import { GeneratedTestScenario, TestStep } from '../models/test-scenario';
import { JiraConfig } from '../models/config';
import { saveJiraPayload, saveJiraPayloadSummary } from '../storage/file-manager';
import { createContextLogger } from '../utils/logger';

export async function formatForJira(
  scenarios: GeneratedTestScenario[],
  jiraConfig: JiraConfig,
  confluencePageId: string,
  jobId: string
): Promise<{ payloadFiles: string[]; summaryFile: string }> {
  const contextLogger = createContextLogger({
    step: 'jira-formatting',
    job_id: jobId,
    confluence_page_id: confluencePageId,
  });

  contextLogger.debug('Starting Jira payload formatting', { total_scenarios: scenarios.length });

  const validatedScenarios = scenarios.filter(s => s.validation_status === 'validated');
  const failedScenarios = scenarios.filter(s =>
    s.validation_status === 'needs_review' ||
    s.validation_status === 'failed' ||
    s.validation_status === 'dismissed'
  );

  contextLogger.info('Filtering scenarios for Jira formatting', {
    validated: validatedScenarios.length,
    failed: failedScenarios.length,
  });

  const payloadFiles: string[] = [];

  for (const scenario of validatedScenarios) {
    const payload = buildJiraPayload(scenario, jiraConfig);

    const filePath = await saveJiraPayload(confluencePageId, scenario.test_id, payload);
    payloadFiles.push(filePath);

    contextLogger.debug('Jira payload created', {
      test_id: scenario.test_id,
      test_name: scenario.test_name,
      file_path: filePath,
    });
  }

  const summaryFile = await saveJiraPayloadSummary(confluencePageId, {
    total_scenarios: scenarios.length,
    validated_count: validatedScenarios.length,
    failed_count: failedScenarios.length,
    file_paths: payloadFiles,
  });

  contextLogger.info('Jira formatting completed', {
    validated_payloads_created: validatedScenarios.length,
    failed_skipped: failedScenarios.length,
    summary_file: summaryFile,
  });

  return { payloadFiles, summaryFile };
}

function buildJiraPayload(scenario: GeneratedTestScenario, jiraConfig: JiraConfig): any {
  const description = formatDescription(scenario);
  const preconditionsFormatted = formatPreconditions(scenario.preconditions);
  const stepsFormatted = formatTestStepsTable(scenario.test_steps);

  const priority = mapPriority(scenario.priority);

  const labels = [
    'ai-generated',
    scenario.scenario_classification,
    scenario.test_type,
    scenario.automation_status.replace(/_/g, '-'), // ready-for-automation or automation-not-needed
  ];

  const payload: any = {
    fields: {
      project: {
        key: jiraConfig.project_key,
      },
      issuetype: {
        name: jiraConfig.test_issue_type,
      },
      summary: scenario.test_name,
      description: description,
      priority: {
        name: priority,
      },
      labels: labels,
    },
  };

  // Map custom fields
  if (jiraConfig.custom_field_mappings.parent_issue_link) {
    payload.fields[jiraConfig.custom_field_mappings.parent_issue_link] = scenario.parent_jira_issue_id;
  }

  if (jiraConfig.custom_field_mappings.preconditions) {
    payload.fields[jiraConfig.custom_field_mappings.preconditions] = preconditionsFormatted;
  }

  if (jiraConfig.custom_field_mappings.test_steps) {
    payload.fields[jiraConfig.custom_field_mappings.test_steps] = stepsFormatted;
  }

  // Map new custom fields if configured
  if ((jiraConfig.custom_field_mappings as any).automation_status) {
    payload.fields[(jiraConfig.custom_field_mappings as any).automation_status] = mapAutomationStatus(scenario.automation_status);
  }

  if ((jiraConfig.custom_field_mappings as any).test_repository_folder) {
    payload.fields[(jiraConfig.custom_field_mappings as any).test_repository_folder] = scenario.test_repository_folder;
  }

  return payload;
}

/**
 * Formats the description with Goal (Cieľ) section - TestFlo compatible
 */
function formatDescription(scenario: GeneratedTestScenario): string {
  return `h3. Cieľ
${scenario.description}

h3. Predpoklady
${formatPreconditions(scenario.preconditions)}

h3. Kroky testu
${formatTestStepsTable(scenario.test_steps)}

---
_AI Generated - Review before execution_
_Classification: ${scenario.scenario_classification}_
_Repository: ${scenario.test_repository_folder}_`;
}

/**
 * Formats preconditions as a bulleted list
 */
function formatPreconditions(preconditions: string[]): string {
  return preconditions.map(item => `* ${item}`).join('\n');
}

/**
 * Formats test steps as a wiki table for TestFlo
 * Columns: #, Akcia (Action), Vstup (Input), Očakávaný výsledok (Expected Result)
 */
function formatTestStepsTable(steps: TestStep[]): string {
  const header = '||#||Akcia||Vstup||Očakávaný výsledok||';
  const rows = steps.map(step =>
    `|${step.step_number}|${escapeTableCell(step.action)}|${escapeTableCell(step.input)}|${escapeTableCell(step.expected_result)}|`
  ).join('\n');

  return `${header}\n${rows}`;
}

/**
 * Escapes special characters for wiki table cells
 */
function escapeTableCell(text: string): string {
  if (!text) return '';
  // Escape pipe characters and newlines that would break table formatting
  return text
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '');
}

/**
 * Maps automation status to Jira custom field value
 */
function mapAutomationStatus(status: 'ready_for_automation' | 'automation_not_needed'): string {
  const statusMap: Record<string, string> = {
    ready_for_automation: 'READY FOR AUTOMATION',
    automation_not_needed: 'AUTOMATION NOT NEEDED',
  };
  return statusMap[status] || 'AUTOMATION NOT NEEDED';
}

function mapPriority(priority: 'critical' | 'high' | 'medium' | 'low'): string {
  const priorityMap: Record<string, string> = {
    critical: 'Highest',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  };

  return priorityMap[priority] || 'Medium';
}
