import { GeneratedTestScenario, LLMTestScenarioOutput, TestStep } from '../models/test-scenario';
import { NormalizedInput } from '../models/specification-input';
import { PromptMessages } from './prompt-builder';
import { generateTestId } from '../utils/uuid-generator';
import { createContextLogger } from '../utils/logger';
import { createLlmProvider, createFallbackProvider } from '../llm/provider-factory';
import { LlmProvider, ChatMessage, LlmProfile } from '../llm/types';
import { OllamaProvider } from '../llm/providers/ollama-provider';
import { ClaudeProvider } from '../llm/providers/claude-provider';

export interface LlmAttemptResult {
  scenarios: GeneratedTestScenario[];
  profile: LlmProfile;
  success: boolean;
  error?: string;
  duration: number;
}

export async function invokeLLMWithFallback(
  promptMessages: PromptMessages,
  normalizedInput: NormalizedInput,
  jobId: string
): Promise<{ primaryAttempt: LlmAttemptResult; fallbackAttempt?: LlmAttemptResult; finalScenarios: GeneratedTestScenario[] }> {
  const contextLogger = createContextLogger({
    step: 'llm-invocation-with-fallback',
    job_id: jobId,
    parent_jira_issue_id: normalizedInput.metadata.parent_jira_issue_id,
  });

  const provider = createLlmProvider();
  
  // Primary attempt
  contextLogger.info('Starting primary LLM attempt');
  const primaryProfile = provider instanceof OllamaProvider
    ? provider.getPrimaryProfile()
    : provider instanceof ClaudeProvider
    ? provider.getPrimaryProfile()
    : {
        name: 'primary',
        model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
        temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.2'),
        maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '3000', 10)
      };

  const primaryAttempt = await executeLlmAttempt(
    provider,
    promptMessages,
    normalizedInput,
    primaryProfile,
    'primary',
    contextLogger
  );

  let fallbackAttempt: LlmAttemptResult | undefined;
  let finalScenarios = primaryAttempt.scenarios;

  // Check if fallback is enabled and needed
  const fallbackEnabled = process.env.VALIDATION_FALLBACK_ENABLED === 'true';
  
  if (fallbackEnabled && (!primaryAttempt.success || primaryAttempt.scenarios.length === 0)) {
    contextLogger.info('Primary attempt failed or returned no scenarios, attempting fallback');
    
    const fallbackProvider = createFallbackProvider();
    const fallbackProfile = fallbackProvider instanceof OllamaProvider
      ? fallbackProvider.getFallbackProfile()
      : fallbackProvider instanceof ClaudeProvider
      ? fallbackProvider.getFallbackProfile()
      : {
          name: 'fallback',
          model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
          temperature: 0.0,
          maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '3000', 10),
          systemPromptSuffix: '\n\nIMPORTANT: You must respond with valid JSON only. Be extremely precise and follow the exact format specified.'
        };

    // Modify prompt for stricter fallback
    const fallbackPromptMessages = {
      systemMessage: promptMessages.systemMessage + (fallbackProfile.systemPromptSuffix || ''),
      userMessage: promptMessages.userMessage
    };

    fallbackAttempt = await executeLlmAttempt(
      fallbackProvider,
      fallbackPromptMessages,
      normalizedInput,
      fallbackProfile,
      'fallback',
      contextLogger
    );

    // Use fallback scenarios if they're better
    if (fallbackAttempt.success && fallbackAttempt.scenarios.length > 0) {
      finalScenarios = fallbackAttempt.scenarios;
      contextLogger.info('Using fallback attempt results');
    } else {
      contextLogger.warn('Fallback attempt also failed, using primary attempt results');
    }
  }

  contextLogger.info('LLM invocation with fallback completed', {
    primary_success: primaryAttempt.success,
    primary_scenarios: primaryAttempt.scenarios.length,
    fallback_attempted: !!fallbackAttempt,
    fallback_success: fallbackAttempt?.success,
    fallback_scenarios: fallbackAttempt?.scenarios.length || 0,
    final_scenarios: finalScenarios.length
  });

  return {
    primaryAttempt,
    fallbackAttempt,
    finalScenarios
  };
}

async function executeLlmAttempt(
  provider: LlmProvider,
  promptMessages: PromptMessages,
  normalizedInput: NormalizedInput,
  profile: LlmProfile,
  attemptType: string,
  contextLogger: any
): Promise<LlmAttemptResult> {
  const startTime = Date.now();

  try {
    contextLogger.debug(`Executing ${attemptType} LLM attempt`, {
      provider: provider.name,
      profile: profile.name,
      model: profile.model,
      temperature: profile.temperature
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: promptMessages.systemMessage },
      { role: 'user', content: promptMessages.userMessage }
    ];

    const response = await provider.generateCompletion(messages, {
      model: profile.model,
      temperature: profile.temperature,
      maxTokens: profile.maxTokens,
      responseFormat: 'json'
    });

    const duration = Date.now() - startTime;

    contextLogger.log('silly', `${attemptType} LLM response received`, {
      duration_ms: duration,
      response_length: response.content?.length || 0,
      model: response.model,
      usage: response.usage
    });

    if (!response.content) {
      throw new Error(`Empty response from ${provider.name}`);
    }

    let parsedResponse: unknown;
    try {
      parsedResponse = JSON.parse(response.content);
    } catch (error) {
      contextLogger.error(`Failed to parse ${attemptType} LLM JSON response`, {
        error: (error as Error).message,
        raw_content: response.content.substring(0, 200) + '...',
      });
      return {
        scenarios: [],
        profile,
        success: false,
        error: `Invalid JSON response from ${provider.name}`,
        duration
      };
    }

    const rawScenarios = extractScenarios(parsedResponse);

    if (!Array.isArray(rawScenarios) || rawScenarios.length === 0) {
      contextLogger.warn(`${attemptType} LLM returned no scenarios`, {
        parsed_type: typeof parsedResponse,
        parsed_keys: parsedResponse && typeof parsedResponse === 'object' ? Object.keys(parsedResponse as object) : [],
        raw_preview: response.content.substring(0, 200) + '...'
      });
      return {
        scenarios: [],
        profile,
        success: false,
        error: 'No scenarios returned',
        duration
      };
    }

    const normalizedScenarios = rawScenarios
      .map(normalizeScenarioOutput)
      .filter((scenario): scenario is LLMTestScenarioOutput => scenario !== null);

    if (normalizedScenarios.length === 0) {
      contextLogger.warn(`${attemptType} LLM scenarios could not be normalized`, {
        raw_count: rawScenarios.length
      });
      return {
        scenarios: [],
        profile,
        success: false,
        error: 'Scenario normalization failed',
        duration
      };
    }

    const enrichedScenarios: GeneratedTestScenario[] = normalizedScenarios.map(scenario =>
      enrichScenario(scenario, normalizedInput, response.model || profile.model, attemptType)
    );

    contextLogger.info(`${attemptType} LLM attempt completed successfully`, {
      scenario_count: enrichedScenarios.length,
      duration_ms: duration,
      usage: response.usage
    });

    return {
      scenarios: enrichedScenarios,
      profile,
      success: true,
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    contextLogger.error(`${attemptType} LLM attempt failed`, {
      error: (error as Error).message,
      duration_ms: duration,
      provider: provider.name,
      profile: profile.name
    });

    return {
      scenarios: [],
      profile,
      success: false,
      error: (error as Error).message,
      duration
    };
  }
}

function extractScenarios(parsedResponse: unknown): any[] {
  if (Array.isArray(parsedResponse)) {
    return parsedResponse;
  }

  if (!parsedResponse || typeof parsedResponse !== 'object') {
    return [];
  }

  const candidate = parsedResponse as Record<string, any>;
  const direct =
    candidate.scenarios ||
    candidate.test_scenarios ||
    candidate.testScenarios ||
    candidate.items ||
    candidate.data;

  if (Array.isArray(direct)) {
    return direct;
  }

  for (const value of Object.values(candidate)) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function normalizeScenarioOutput(raw: any): LLMTestScenarioOutput | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  // Handle test_steps as array of objects (new TestFlo format)
  const testStepsRaw = raw.test_steps ?? raw.steps ?? raw.testSteps;
  const testSteps: TestStep[] = normalizeTestSteps(testStepsRaw);

  // Handle preconditions as array (new format)
  const preconditionsRaw = raw.preconditions ?? raw.precondition ?? [];
  const preconditions: string[] = normalizePreconditions(preconditionsRaw);

  // Normalize classification
  const classificationRaw = String(
    raw.scenario_classification ?? raw.classification ?? raw.scenario_type ?? ''
  ).toLowerCase().replace(/\s+/g, '_');
  const scenario_classification = classificationRaw === 'happy' ? 'happy_path'
    : classificationRaw === 'edge' ? 'edge_case'
    : classificationRaw;

  // Normalize test type
  const testTypeRaw = String(raw.test_type ?? raw.type ?? '').toLowerCase();
  const test_type = testTypeRaw.includes('regress') ? 'regression'
    : testTypeRaw.includes('smoke') ? 'smoke'
    : testTypeRaw.includes('function') ? 'functional'
    : testTypeRaw;

  // Normalize priority
  const priorityRaw = String(raw.priority ?? raw.severity ?? '').toLowerCase();
  const priority = priorityRaw === 'p1' ? 'critical'
    : priorityRaw === 'p2' ? 'high'
    : priorityRaw === 'p3' ? 'medium'
    : priorityRaw === 'p4' ? 'low'
    : priorityRaw;

  // Normalize automation status
  const automationRaw = String(raw.automation_status ?? raw.automationStatus ?? '').toLowerCase();
  const automation_status = automationRaw.includes('ready') || automationRaw.includes('yes') || automationRaw.includes('true')
    ? 'ready_for_automation'
    : 'automation_not_needed';

  // Get description (goal)
  const description = String(raw.description ?? raw.goal ?? raw.objective ?? '').trim();

  // Get test repository folder
  const test_repository_folder = String(raw.test_repository_folder ?? raw.folder ?? raw.repository_folder ?? '').trim();

  return {
    test_name: String(raw.test_name ?? raw.title ?? raw.name ?? '').trim(),
    description,
    test_type: test_type as LLMTestScenarioOutput['test_type'],
    scenario_classification: scenario_classification as LLMTestScenarioOutput['scenario_classification'],
    preconditions,
    test_steps: testSteps,
    priority: priority as LLMTestScenarioOutput['priority'],
    automation_status: automation_status as LLMTestScenarioOutput['automation_status'],
    test_repository_folder,
  };
}

/**
 * Normalizes test steps to the new TestStep[] format
 * Handles both new format (array of objects) and legacy format (array of strings)
 */
function normalizeTestSteps(raw: any): TestStep[] {
  if (!Array.isArray(raw)) {
    // If it's a string, split by newlines (legacy support)
    if (typeof raw === 'string') {
      const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      return lines.map((line, index) => ({
        step_number: index + 1,
        action: line,
        input: '',
        expected_result: '',
      }));
    }
    return [];
  }

  return raw.map((step, index) => {
    // New format: object with action, input, expected_result
    if (step && typeof step === 'object' && !Array.isArray(step)) {
      return {
        step_number: step.step_number ?? step.stepNumber ?? step.number ?? index + 1,
        action: String(step.action ?? step.step ?? step.description ?? '').trim(),
        input: String(step.input ?? step.data ?? step.test_data ?? '').trim(),
        expected_result: String(step.expected_result ?? step.expectedResult ?? step.expected ?? step.result ?? '').trim(),
      };
    }
    // Legacy format: string
    if (typeof step === 'string') {
      return {
        step_number: index + 1,
        action: step.trim(),
        input: '',
        expected_result: '',
      };
    }
    // Invalid format
    return {
      step_number: index + 1,
      action: String(step),
      input: '',
      expected_result: '',
    };
  }).filter(step => step.action.length > 0);
}

/**
 * Normalizes preconditions to string array format
 * Handles both new format (array) and legacy format (single string)
 */
function normalizePreconditions(raw: any): string[] {
  if (Array.isArray(raw)) {
    return raw.map(item => String(item).trim()).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    // Split by newlines or bullet points
    const items = raw.split(/[\n\r]+|[•\-\*]\s+/).map(s => s.trim()).filter(Boolean);
    return items.length > 0 ? items : [raw.trim()];
  }
  return [];
}

function enrichScenario(
  scenario: LLMTestScenarioOutput,
  normalizedInput: NormalizedInput,
  llmModel: string,
  attemptType: string
): GeneratedTestScenario {
  const testId = generateTestId();
  const timestamp = new Date().toISOString();

  return {
    test_id: testId,
    test_name: scenario.test_name,
    description: scenario.description,
    test_type: scenario.test_type,
    scenario_classification: scenario.scenario_classification,
    preconditions: scenario.preconditions,
    test_steps: scenario.test_steps,
    priority: scenario.priority,
    automation_status: scenario.automation_status,
    test_repository_folder: scenario.test_repository_folder,
    tags: ['ai-generated', `${attemptType}-attempt`],
    parent_jira_issue_id: normalizedInput.metadata.parent_jira_issue_id,
    traceability: {
      source_confluence_page_id: normalizedInput.original_input.confluence_page_id || 'manual-input',
      source_specification_version: normalizedInput.original_input.confluence_version || '1',
      generated_at: timestamp,
      llm_model: llmModel,
    },
    validation_status: 'validated',
  };
}
