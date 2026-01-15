import { LlmProvider } from './types';
import { OllamaProvider } from './providers/ollama-provider';
import { OpenAIProvider } from './providers/openai-provider';
import { ClaudeProvider } from './providers/claude-provider';
import { createContextLogger } from '../utils/logger';

const logger = createContextLogger({ step: 'provider-factory' });

export function createLlmProvider(providerName?: string): LlmProvider {
  const provider = providerName || process.env.LLM_PROVIDER || 'ollama';
  
  logger.info('Creating LLM provider', { provider });

  switch (provider.toLowerCase()) {
    case 'ollama':
      return new OllamaProvider();
    case 'openai':
      // Check if OpenAI is available before creating
      if (!OpenAIProvider.isAvailable()) {
        logger.warn('OpenAI provider requested but OPENAI_API_KEY not available, falling back to Ollama', {
          requested_provider: provider,
          fallback_provider: 'ollama'
        });
        return new OllamaProvider();
      }
      return new OpenAIProvider();
    case 'claude':
      // Check if Claude CLI is available before creating
      if (!ClaudeProvider.isAvailable()) {
        logger.warn('Claude provider requested but CLI not found in PATH, falling back to Ollama', {
          requested_provider: provider,
          fallback_provider: 'ollama'
        });
        return new OllamaProvider();
      }
      return new ClaudeProvider();
    default:
      logger.warn('Unknown provider specified, defaulting to Ollama', {
        requested_provider: provider,
        default_provider: 'ollama'
      });
      return new OllamaProvider();
  }
}

export function createFallbackProvider(): LlmProvider {
  const fallbackProvider = process.env.LLM_FALLBACK_PROVIDER || process.env.LLM_PROVIDER || 'ollama';
  
  logger.info('Creating fallback LLM provider', { provider: fallbackProvider });
  
  return createLlmProvider(fallbackProvider);
}