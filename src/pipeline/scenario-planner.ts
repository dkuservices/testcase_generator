import { NormalizedInput, ScenarioOverride } from '../models/specification-input';
import { createContextLogger } from '../utils/logger';
import { createLlmProvider } from '../llm/provider-factory';
import { ChatMessage } from '../llm/types';

/**
 * Scenario plan describing what scenarios should be generated
 */
export interface ScenarioPlan {
  recommended_count: number;
  scenario_types: Array<{
    classification: 'happy_path' | 'negative' | 'edge_case';
    priority: 'critical' | 'high' | 'medium' | 'low';
    focus: string; // Brief description of what this scenario should test
  }>;
  reasoning: string;
  test_repository_folder: string; // Suggested folder path
}

/**
 * Plans the optimal number and types of test scenarios based on specification complexity.
 * Can be overridden by human input via scenario_override.
 */
export async function planScenarios(
  normalizedInput: NormalizedInput,
  jobId: string
): Promise<ScenarioPlan> {
  const contextLogger = createContextLogger({
    step: 'scenario-planning',
    job_id: jobId,
    parent_jira_issue_id: normalizedInput.metadata.parent_jira_issue_id,
  });

  const override = normalizedInput.scenario_override;

  // If override provided, use it to build the plan
  if (override && (override.count || override.types)) {
    contextLogger.info('Using scenario override from user input', {
      override_count: override.count,
      override_types: override.types,
    });

    return buildOverridePlan(override, normalizedInput);
  }

  // Otherwise, ask LLM to analyze and plan
  contextLogger.info('No override provided, using AI to plan scenarios');

  try {
    return await generateAIPlan(normalizedInput, jobId, contextLogger);
  } catch (error) {
    contextLogger.error('AI scenario planning failed, using default plan', {
      error: (error as Error).message,
    });
    return getDefaultPlan(normalizedInput);
  }
}

/**
 * Builds a scenario plan from user override
 */
function buildOverridePlan(
  override: ScenarioOverride,
  normalizedInput: NormalizedInput
): ScenarioPlan {
  const count = override.count || 3;
  const types = override.types || ['happy_path', 'negative', 'edge_case'];

  const scenarioTypes: ScenarioPlan['scenario_types'] = [];

  const classificationLabels: Record<string, string> = {
    'happy_path': 'Pozitívny scenár',
    'negative': 'Negatívny scenár',
    'edge_case': 'Hraničný scenár',
  };

  for (let i = 0; i < count; i++) {
    const classification = types[i % types.length] as 'happy_path' | 'negative' | 'edge_case';
    const priority = getPriorityForClassification(classification);

    scenarioTypes.push({
      classification,
      priority,
      focus: `${classificationLabels[classification] || 'Scenár'} ${i + 1}`,
    });
  }

  return {
    recommended_count: count,
    scenario_types: scenarioTypes,
    reasoning: 'Použitý používateľský override',
    test_repository_folder: suggestFolderFromInput(normalizedInput),
  };
}

/**
 * Generates scenario plan using AI analysis of the specification
 */
async function generateAIPlan(
  normalizedInput: NormalizedInput,
  _jobId: string, // Reserved for logging context
  contextLogger: any
): Promise<ScenarioPlan> {
  const provider = createLlmProvider();

  const systemMessage = `You are a QA Test Architect. Analyze the given specification and determine the optimal test coverage strategy.

Your task is to:
1. Assess the complexity of the feature
2. Identify critical user paths that need happy_path testing
3. Identify potential error conditions for negative testing
4. Identify edge cases and boundary conditions
5. Recommend appropriate test repository folder structure

RULES:
- Simple features (login, single form): 1-2 scenarios
- Medium features (CRUD, workflows): 2-4 scenarios
- Complex features (multi-step processes, integrations): 3-6 scenarios
- Maximum 6 scenarios to avoid redundancy

IMPORTANT: All "focus" and "reasoning" text MUST be in Slovakian (Slovak) language.

Return JSON only with this structure:
{
  "recommended_count": <number>,
  "scenario_types": [
    {
      "classification": "happy_path" | "negative" | "edge_case",
      "priority": "critical" | "high" | "medium" | "low",
      "focus": "Stručný popis čo má tento scenár testovať (v slovenčine)"
    }
  ],
  "reasoning": "Stručné vysvetlenie prečo je táto stratégia odporúčaná (v slovenčine)",
  "test_repository_folder": "Navrhnutá cesta priečinka ako 'ModulName/FunkciaName'"
}`;

  const userMessage = `Analyze this specification and create a test coverage plan:

System Type: ${normalizedInput.metadata.system_type}
Feature Priority: ${normalizedInput.metadata.feature_priority}
Parent Issue: ${normalizedInput.metadata.parent_jira_issue_id}

SPECIFICATION:
${normalizedInput.normalized_text}

Determine the optimal number and types of test scenarios for comprehensive but efficient coverage.`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemMessage },
    { role: 'user', content: userMessage },
  ];

  contextLogger.debug('Sending scenario planning request to LLM');

  const response = await provider.generateCompletion(messages, {
    temperature: 0.3,
    maxTokens: 1000,
    responseFormat: 'json',
  });

  if (!response.content) {
    throw new Error('Empty response from LLM for scenario planning');
  }

  const parsed = JSON.parse(response.content);

  // Slovak labels for fallback focus text
  const classificationFocusLabels: Record<string, string> = {
    'happy_path': 'Dodatočný pozitívny scenár',
    'negative': 'Dodatočný negatívny scenár',
    'edge_case': 'Dodatočný hraničný scenár',
  };

  // Validate and normalize the response
  const plan: ScenarioPlan = {
    recommended_count: Math.min(Math.max(parsed.recommended_count || 3, 1), 6),
    scenario_types: (parsed.scenario_types || []).map((st: any) => ({
      classification: normalizeClassification(st.classification),
      priority: normalizePriority(st.priority),
      focus: st.focus || 'Všeobecný testovací scenár',
    })),
    reasoning: parsed.reasoning || 'Plán vygenerovaný AI',
    test_repository_folder: parsed.test_repository_folder || suggestFolderFromInput(normalizedInput),
  };

  // Ensure we have enough scenario types for the count
  while (plan.scenario_types.length < plan.recommended_count) {
    const index = plan.scenario_types.length;
    const classifications: Array<'happy_path' | 'negative' | 'edge_case'> = ['happy_path', 'negative', 'edge_case'];
    const classification = classifications[index % 3];
    plan.scenario_types.push({
      classification,
      priority: getPriorityForClassification(classification),
      focus: classificationFocusLabels[classification] || 'Dodatočný scenár',
    });
  }

  contextLogger.info('AI scenario plan generated', {
    recommended_count: plan.recommended_count,
    types: plan.scenario_types.map(st => st.classification),
    folder: plan.test_repository_folder,
  });

  return plan;
}

/**
 * Default plan when AI planning fails
 */
function getDefaultPlan(normalizedInput: NormalizedInput): ScenarioPlan {
  return {
    recommended_count: 3,
    scenario_types: [
      { classification: 'happy_path', priority: 'critical', focus: 'Hlavný používateľský workflow' },
      { classification: 'negative', priority: 'high', focus: 'Spracovanie chýb a validácia' },
      { classification: 'edge_case', priority: 'medium', focus: 'Hraničné podmienky' },
    ],
    reasoning: 'Predvolený plán - AI plánovanie nedostupné',
    test_repository_folder: suggestFolderFromInput(normalizedInput),
  };
}

/**
 * Suggests a folder path based on input metadata
 */
function suggestFolderFromInput(normalizedInput: NormalizedInput): string {
  const parentIssue = normalizedInput.metadata.parent_jira_issue_id || 'General';

  // Extract project/module from parent issue key (e.g., "KISINTE-543" -> "KISINTE")
  const projectKey = parentIssue.split('-')[0] || 'General';

  // Extract feature name from normalized text (first few words of title)
  const featureName = extractFeatureName(normalizedInput.normalized_text);

  return `${projectKey}/${featureName}`;
}

/**
 * Extracts a feature name from normalized text
 */
function extractFeatureName(text: string): string {
  // Try to extract from "Feature: ..." line
  const featureMatch = text.match(/Feature:\s*(.+?)(?:\n|$)/i);
  if (featureMatch) {
    return sanitizeFolderName(featureMatch[1].trim().slice(0, 50));
  }

  // Fallback: use first 50 chars of text
  const words = text.split(/\s+/).slice(0, 5).join(' ');
  return sanitizeFolderName(words);
}

/**
 * Sanitizes a string for use as a folder name
 */
function sanitizeFolderName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s\-_áäčďéíľĺňóôŕšťúýžÁÄČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 50) || 'General';
}

/**
 * Gets default priority for a scenario classification
 */
function getPriorityForClassification(
  classification: 'happy_path' | 'negative' | 'edge_case'
): 'critical' | 'high' | 'medium' | 'low' {
  switch (classification) {
    case 'happy_path':
      return 'critical';
    case 'negative':
      return 'high';
    case 'edge_case':
      return 'medium';
    default:
      return 'medium';
  }
}

/**
 * Normalizes classification string from LLM
 */
function normalizeClassification(value: string): 'happy_path' | 'negative' | 'edge_case' {
  const lower = (value || '').toLowerCase().replace(/\s+/g, '_');
  if (lower === 'happy' || lower === 'happy_path' || lower === 'positive') {
    return 'happy_path';
  }
  if (lower === 'negative' || lower === 'error' || lower === 'failure') {
    return 'negative';
  }
  if (lower === 'edge' || lower === 'edge_case' || lower === 'boundary') {
    return 'edge_case';
  }
  return 'happy_path';
}

/**
 * Normalizes priority string from LLM
 */
function normalizePriority(value: string): 'critical' | 'high' | 'medium' | 'low' {
  const lower = (value || '').toLowerCase();
  if (lower === 'critical' || lower === 'p1' || lower === 'highest') {
    return 'critical';
  }
  if (lower === 'high' || lower === 'p2') {
    return 'high';
  }
  if (lower === 'medium' || lower === 'p3' || lower === 'normal') {
    return 'medium';
  }
  if (lower === 'low' || lower === 'p4' || lower === 'lowest') {
    return 'low';
  }
  return 'medium';
}
