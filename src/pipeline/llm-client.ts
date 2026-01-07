import OpenAI from 'openai';
import { GeneratedTestScenario, LLMTestScenarioOutput } from '../models/test-scenario';
import { NormalizedInput } from '../models/specification-input';
import { PromptMessages } from './prompt-builder';
import { generateTestId } from '../utils/uuid-generator';
import { retryWithBackoff, isRateLimitError, isRetryableError } from '../utils/retry-handler';
import { createContextLogger } from '../utils/logger';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const model = process.env.OPENAI_MODEL || 'gpt-4-turbo';
const temperature = parseFloat(process.env.OPENAI_TEMPERATURE || '0.2');
const maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS || '3000', 10);

export async function invokeLLM(
  promptMessages: PromptMessages,
  normalizedInput: NormalizedInput,
  jobId: string
): Promise<GeneratedTestScenario[]> {
  const contextLogger = createContextLogger({
    step: 'llm-invocation',
    job_id: jobId,
    parent_jira_issue_id: normalizedInput.metadata.parent_jira_issue_id,
  });

  contextLogger.debug('Invoking LLM', { model, temperature, max_tokens: maxTokens });

  const startTime = Date.now();

  try {
    const response = await retryWithBackoff(
      async () => {
        contextLogger.log('silly', 'Sending request to OpenAI', {
          prompt_system: promptMessages.systemMessage,
          prompt_user: promptMessages.userMessage,
        });

        return await openai.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: promptMessages.systemMessage },
            { role: 'user', content: promptMessages.userMessage },
          ],
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        });
      },
      {
        maxAttempts: 3,
        delayMs: 1000,
        exponentialBackoff: true,
        onRetry: (attempt, error) => {
          if (isRateLimitError(error)) {
            contextLogger.warn('Rate limit hit, retrying', { attempt });
          } else if (isRetryableError(error)) {
            contextLogger.warn('Retryable error encountered', { attempt, error: error.message });
          }
        },
      }
    );

    const duration = Date.now() - startTime;

    const usage = response.usage;
    contextLogger.log('silly', 'LLM response received', {
      prompt_tokens: usage?.prompt_tokens,
      completion_tokens: usage?.completion_tokens,
      total_tokens: usage?.total_tokens,
      duration_ms: duration,
      raw_response: response.choices[0]?.message?.content,
    });

    if (!response.choices[0]?.message?.content) {
      throw new Error('Empty response from LLM');
    }

    let parsedResponse: { scenarios?: LLMTestScenarioOutput[] };
    try {
      parsedResponse = JSON.parse(response.choices[0].message.content);
    } catch (error) {
      contextLogger.error('Failed to parse LLM JSON response', {
        error: (error as Error).message,
        raw_content: response.choices[0].message.content,
      });
      throw new Error('Invalid JSON response from LLM');
    }

    const scenarios = parsedResponse.scenarios || (Array.isArray(parsedResponse) ? parsedResponse : []);

    if (!Array.isArray(scenarios) || scenarios.length === 0) {
      contextLogger.warn('LLM returned no scenarios');
      return [];
    }

    const enrichedScenarios: GeneratedTestScenario[] = scenarios.map(scenario => enrichScenario(scenario, normalizedInput, model));

    contextLogger.info('LLM invocation completed', {
      scenario_count: enrichedScenarios.length,
      duration_ms: duration,
      prompt_tokens: usage?.prompt_tokens,
      completion_tokens: usage?.completion_tokens,
    });

    return enrichedScenarios;
  } catch (error) {
    const duration = Date.now() - startTime;
    contextLogger.error('LLM invocation failed', {
      error: (error as Error).message,
      duration_ms: duration,
    });
    throw error;
  }
}

function enrichScenario(
  scenario: LLMTestScenarioOutput,
  normalizedInput: NormalizedInput,
  llmModel: string
): GeneratedTestScenario {
  const testId = generateTestId();
  const timestamp = new Date().toISOString();

  return {
    test_id: testId,
    test_name: scenario.test_name,
    test_type: scenario.test_type,
    scenario_classification: scenario.scenario_classification,
    preconditions: scenario.preconditions,
    test_steps: scenario.test_steps,
    expected_result: scenario.expected_result,
    priority: scenario.priority,
    tags: ['ai-generated'],
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
