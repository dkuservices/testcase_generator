import { GeneratedTestScenario } from '../models/test-scenario';
import { JiraConfig } from '../models/config';
import { saveJiraPayload, saveJiraPayloadSummary } from '../storage/file-manager';
import logger, { createContextLogger } from '../utils/logger';

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
  const failedScenarios = scenarios.filter(s => s.validation_status === 'needs_review' || s.validation_status === 'failed');

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

  const priority = mapPriority(scenario.priority);

  const labels = [
    'ai-generated',
    scenario.scenario_classification,
    scenario.test_type,
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

  if (jiraConfig.custom_field_mappings.parent_issue_link) {
    payload.fields[jiraConfig.custom_field_mappings.parent_issue_link] = scenario.parent_jira_issue_id;
  }

  return payload;
}

function formatDescription(scenario: GeneratedTestScenario): string {
  const steps = scenario.test_steps
    .map((step, index) => `${index + 1}. ${step}`)
    .join('\n');

  return `*Preconditions:*
${scenario.preconditions}

*Test Steps:*
${steps}

*Expected Result:*
${scenario.expected_result}

---
_AI Generated - Review before execution_
_Classification: ${scenario.scenario_classification}_`;
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
