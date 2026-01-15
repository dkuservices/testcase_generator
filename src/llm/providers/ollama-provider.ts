import { Ollama } from 'ollama';
import { ChatMessage, LlmProvider, LlmResult, LlmGenerationOptions, LlmProfile } from '../types';
import { createContextLogger } from '../../utils/logger';

export class OllamaProvider implements LlmProvider {
  public readonly name = 'ollama';
  private client: Ollama;
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.client = new Ollama({ host: this.baseUrl });
  }

  async generateCompletion(messages: ChatMessage[], options?: LlmGenerationOptions): Promise<LlmResult> {
    const contextLogger = createContextLogger({ 
      step: 'ollama-invocation',
      provider: this.name,
      model: options?.model 
    });

    const model = options?.model || process.env.OLLAMA_MODEL_PRIMARY || 'llama2';
    const temperature = options?.temperature ?? parseFloat(process.env.OLLAMA_TEMPERATURE_PRIMARY || '0.3');
    const maxTokens = options?.maxTokens;

    contextLogger.debug('Invoking Ollama', { 
      model, 
      temperature, 
      max_tokens: maxTokens,
      base_url: this.baseUrl 
    });

    const startTime = Date.now();

    try {
      // Convert messages to Ollama format
      const ollamaMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      const response = await this.client.chat({
        model,
        messages: ollamaMessages,
        options: {
          temperature,
          ...(maxTokens && { num_predict: maxTokens })
        },
        format: options?.responseFormat === 'json' ? 'json' : undefined
      });

      const duration = Date.now() - startTime;

      contextLogger.debug('Ollama response received', {
        duration_ms: duration,
        response_length: response.message?.content?.length || 0
      });

      if (!response.message?.content) {
        throw new Error('Empty response from Ollama');
      }

      let content = response.message.content;

      // JSON robustness: Parse and validate JSON if expected
      if (options?.responseFormat === 'json') {
        try {
          const parsed = JSON.parse(content);
          // Ensure it's valid JSON by re-stringifying
          content = JSON.stringify(parsed);
        } catch (parseError) {
          contextLogger.warn('Initial JSON parse failed, attempting repair', {
            error: (parseError as Error).message,
            raw_content: content.substring(0, 200) + '...'
          });

          // One repair attempt: try to fix common JSON issues
          const repairedContent = this.repairJson(content);
          try {
            const parsed = JSON.parse(repairedContent);
            content = JSON.stringify(parsed);
            contextLogger.info('JSON repair successful');
          } catch (repairError) {
            contextLogger.error('JSON repair failed', {
              parse_error: (parseError as Error).message,
              repair_error: (repairError as Error).message,
              original_content: content.substring(0, 200) + '...',
              repaired_content: repairedContent.substring(0, 200) + '...'
            });
            throw new Error('Failed to parse JSON response from Ollama after repair attempt');
          }
        }
      }

      return {
        content,
        model,
        temperature,
        usage: {
          prompt_tokens: response.prompt_eval_count,
          completion_tokens: response.eval_count,
          total_tokens: (response.prompt_eval_count || 0) + (response.eval_count || 0)
        }
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      contextLogger.error('Ollama invocation failed', {
        error: (error as Error).message,
        duration_ms: duration,
        model,
        base_url: this.baseUrl
      });
      throw error;
    }
  }

  private repairJson(content: string): string {
    // Common JSON repair strategies
    let repaired = content.trim();
    
    // Remove any text before the first { or [
    const jsonStart = Math.min(
      repaired.indexOf('{') === -1 ? Infinity : repaired.indexOf('{'),
      repaired.indexOf('[') === -1 ? Infinity : repaired.indexOf('[')
    );
    
    if (jsonStart !== Infinity && jsonStart > 0) {
      repaired = repaired.substring(jsonStart);
    }

    // Remove any text after the last } or ]
    const lastBrace = repaired.lastIndexOf('}');
    const lastBracket = repaired.lastIndexOf(']');
    const jsonEnd = Math.max(lastBrace, lastBracket);
    
    if (jsonEnd !== -1 && jsonEnd < repaired.length - 1) {
      repaired = repaired.substring(0, jsonEnd + 1);
    }

    // Fix common issues
    repaired = repaired
      .replace(/,\s*}/g, '}')  // Remove trailing commas before }
      .replace(/,\s*]/g, ']')  // Remove trailing commas before ]
      .replace(/'/g, '"')      // Replace single quotes with double quotes
      .replace(/(\w+):/g, '"$1":'); // Quote unquoted keys

    return repaired;
  }

  // Get primary profile configuration
  getPrimaryProfile(): LlmProfile {
    return {
      name: 'primary',
      model: process.env.OLLAMA_MODEL_PRIMARY || 'llama2',
      temperature: parseFloat(process.env.OLLAMA_TEMPERATURE_PRIMARY || '0.3'),
      maxTokens: parseInt(process.env.OLLAMA_MAX_TOKENS || '3000', 10)
    };
  }

  // Get fallback profile configuration with stricter settings
  getFallbackProfile(): LlmProfile {
    return {
      name: 'fallback',
      model: process.env.OLLAMA_MODEL_FALLBACK || process.env.OLLAMA_MODEL_PRIMARY || 'llama2',
      temperature: parseFloat(process.env.OLLAMA_TEMPERATURE_FALLBACK || '0.0'),
      maxTokens: parseInt(process.env.OLLAMA_MAX_TOKENS || '3000', 10),
      systemPromptSuffix: '\n\nIMPORTANT: You must respond with valid JSON only. Be extremely precise and follow the exact format specified. Do not add any explanatory text outside the JSON structure.'
    };
  }
}