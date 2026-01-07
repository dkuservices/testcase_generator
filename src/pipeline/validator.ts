import { GeneratedTestScenario } from '../models/test-scenario';
import { NormalizedInput } from '../models/specification-input';
import { containsNewConcepts } from '../utils/text-similarity';
import { createContextLogger } from '../utils/logger';

export async function validateScenarios(
  scenarios: GeneratedTestScenario[],
  normalizedInput: NormalizedInput,
  jobId: string
): Promise<GeneratedTestScenario[]> {
  const contextLogger = createContextLogger({
    step: 'validation',
    job_id: jobId,
    parent_jira_issue_id: normalizedInput.metadata.parent_jira_issue_id,
  });

  contextLogger.debug('Starting scenario validation', { scenario_count: scenarios.length });

  const validatedScenarios: GeneratedTestScenario[] = [];

  for (const scenario of scenarios) {
    const validationIssues: string[] = [];

    validateRequiredFields(scenario, validationIssues);

    validateTestStepsClarity(scenario, validationIssues);

    validateNewFunctionality(scenario, normalizedInput, validationIssues);

    validateTraceability(scenario, normalizedInput, validationIssues);

    if (validationIssues.length > 0) {
      scenario.validation_status = 'needs_review';
      scenario.validation_notes = validationIssues.join('; ');

      contextLogger.warn('Scenario failed validation', {
        test_id: scenario.test_id,
        test_name: scenario.test_name,
        issues: validationIssues,
      });
    } else {
      scenario.validation_status = 'validated';

      contextLogger.debug('Scenario passed validation', {
        test_id: scenario.test_id,
        test_name: scenario.test_name,
      });
    }

    validatedScenarios.push(scenario);
  }

  const validatedCount = validatedScenarios.filter(s => s.validation_status === 'validated').length;
  const needsReviewCount = validatedScenarios.filter(s => s.validation_status === 'needs_review').length;

  contextLogger.info('Validation completed', {
    total_scenarios: validatedScenarios.length,
    validated: validatedCount,
    needs_review: needsReviewCount,
  });

  return validatedScenarios;
}

function validateRequiredFields(scenario: GeneratedTestScenario, issues: string[]): void {
  if (!scenario.test_name || scenario.test_name.trim().length === 0) {
    issues.push('Missing test_name');
  }

  if (!scenario.test_type || !['functional', 'regression', 'smoke'].includes(scenario.test_type)) {
    issues.push('Invalid or missing test_type');
  }

  if (!scenario.scenario_classification || !['happy_path', 'negative', 'edge_case'].includes(scenario.scenario_classification)) {
    issues.push('Invalid or missing scenario_classification');
  }

  if (!scenario.preconditions || scenario.preconditions.trim().length === 0) {
    issues.push('Missing preconditions');
  }

  if (!scenario.test_steps || !Array.isArray(scenario.test_steps) || scenario.test_steps.length === 0) {
    issues.push('Missing or empty test_steps array');
  }

  if (!scenario.expected_result || scenario.expected_result.trim().length === 0) {
    issues.push('Missing expected_result');
  }

  if (!scenario.priority || !['critical', 'high', 'medium', 'low'].includes(scenario.priority)) {
    issues.push('Invalid or missing priority');
  }
}

function validateTestStepsClarity(scenario: GeneratedTestScenario, issues: string[]): void {
  if (!scenario.test_steps || !Array.isArray(scenario.test_steps)) {
    return;
  }

  for (let i = 0; i < scenario.test_steps.length; i++) {
    const step = scenario.test_steps[i];

    if (step.trim().length < 10) {
      issues.push(`Test step ${i + 1} is too short (less than 10 characters)`);
    }

    if (!containsVerb(step)) {
      issues.push(`Test step ${i + 1} does not contain an actionable verb`);
    }

    const placeholderPatterns = ['TODO', 'TBD', '[insert', '...', 'xxx'];
    for (const pattern of placeholderPatterns) {
      if (step.toLowerCase().includes(pattern.toLowerCase())) {
        issues.push(`Test step ${i + 1} contains placeholder text: "${pattern}"`);
      }
    }
  }
}

function containsVerb(text: string): boolean {
  const commonActionVerbs = [
    'click', 'enter', 'select', 'open', 'close', 'navigate', 'verify', 'check',
    'submit', 'input', 'fill', 'choose', 'press', 'tap', 'type', 'view',
    'delete', 'create', 'update', 'search', 'filter', 'sort', 'download',
    'upload', 'save', 'cancel', 'confirm', 'login', 'logout', 'sign',
    'validate', 'test', 'ensure', 'wait', 'scroll', 'hover', 'drag', 'drop'
  ];

  const lowerText = text.toLowerCase();
  return commonActionVerbs.some(verb => lowerText.includes(verb));
}

function validateNewFunctionality(
  scenario: GeneratedTestScenario,
  normalizedInput: NormalizedInput,
  issues: string[]
): void {
  const scenarioText = `${scenario.test_name} ${scenario.preconditions} ${scenario.test_steps.join(' ')} ${scenario.expected_result}`;

  const sourceText = normalizedInput.normalized_text;

  if (containsNewConcepts(sourceText, scenarioText, 0.3)) {
    issues.push('Scenario introduces new concepts not found in the specification (moderate strictness)');
  }
}

function validateTraceability(
  scenario: GeneratedTestScenario,
  normalizedInput: NormalizedInput,
  issues: string[]
): void {
  if (scenario.parent_jira_issue_id !== normalizedInput.metadata.parent_jira_issue_id) {
    issues.push('parent_jira_issue_id does not match input metadata');
  }

  if (!scenario.traceability.source_confluence_page_id) {
    issues.push('Missing source_confluence_page_id in traceability');
  }

  if (!scenario.traceability.generated_at) {
    issues.push('Missing generated_at timestamp in traceability');
  } else {
    try {
      new Date(scenario.traceability.generated_at);
    } catch {
      issues.push('Invalid ISO 8601 timestamp in generated_at');
    }
  }
}
