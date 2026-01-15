import OpenAI from 'openai';
import { ChatMessage, LlmProvider, LlmResult, LlmGenerationOptions } from '../types';
import { createContextLogger } from '../../utils/logger';
import { retryWithBackoff, isRateLimitError, isRetryableError } from '../../utils/retry-handler';

export class OpenAIProvider implements LlmProvider {
  public readonly name = 'openai';
  private client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for OpenAI provider');
    }
    this.client = new OpenAI({ apiKey });
  }

  static isAvailable(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async generateCompletion(messages: ChatMessage[], options?: LlmGenerationOptions): Promise<LlmResult> {
    const contextLogger = createContextLogger({ 
      step: 'openai-invocation',
      provider: this.name,
      model: options?.model 
    });

    const model = options?.model || process.env.OPENAI_MODEL || 'gpt-4-turbo';
    const temperature = options?.temperature ?? parseFloat(process.env.OPENAI_TEMPERATURE || '0.2');
    const maxTokens = options?.maxTokens || parseInt(process.env.OPENAI_MAX_TOKENS || '3000', 10);

    contextLogger.debug('Invoking OpenAI', { model, temperature, max_tokens: maxTokens });

    const startTime = Date.now();

    try {
      const response = await retryWithBackoff(
        async () => {
          contextLogger.log('silly', 'Sending request to OpenAI', {
            messages: messages.map(m => ({ role: m.role, content: m.content.substring(0, 100) + '...' }))
          });

          return await this.client.chat.completions.create({
            model,
            messages: messages.map(msg => ({
              role: msg.role,
              content: msg.content
            })),
            temperature,
            max_tokens: maxTokens,
            response_format: options?.responseFormat === 'json' ? { type: 'json_object' } : undefined,
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

      contextLogger.log('silly', 'OpenAI response received', {
        prompt_tokens: usage?.prompt_tokens,
        completion_tokens: usage?.completion_tokens,
        total_tokens: usage?.total_tokens,
        duration_ms: duration,
        response_length: response.choices[0]?.message?.content?.length || 0
      });

      if (!response.choices[0]?.message?.content) {
        throw new Error('Empty response from OpenAI');
      }

      let content = response.choices[0].message.content;

      // JSON validation if expected
      if (options?.responseFormat === 'json') {
        try {
          const parsed = JSON.parse(content);
          content = JSON.stringify(parsed);
        } catch (parseError) {
          contextLogger.error('Failed to parse OpenAI JSON response', {
            error: (parseError as Error).message,
            raw_content: content.substring(0, 200) + '...'
          });
          throw new Error('Invalid JSON response from OpenAI');
        }
      }

      return {
        content,
        model,
        temperature,
        usage: {
          prompt_tokens: usage?.prompt_tokens,
          completion_tokens: usage?.completion_tokens,
          total_tokens: usage?.total_tokens
        }
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      contextLogger.error('OpenAI invocation failed', {
        error: (error as Error).message,
        duration_ms: duration,
        model
      });
      throw error;
    }
  }
}