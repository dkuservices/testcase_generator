import OpenAI from 'openai';
import logger, { createContextLogger } from '../utils/logger';

export function createOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  const contextLogger = createContextLogger({ step: 'openai-init' });

  if (!apiKey) {
    contextLogger.fatal('OPENAI_API_KEY environment variable not set');
    throw new Error('OPENAI_API_KEY is required');
  }

  logger.info('OpenAI client initialized', {
    model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
  });

  return new OpenAI({ apiKey });
}

export function createOpenAIClientSafe(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  const contextLogger = createContextLogger({ step: 'openai-init-safe' });

  if (!apiKey) {
    contextLogger.warn('OPENAI_API_KEY environment variable not set, OpenAI client not available');
    return null;
  }

  logger.info('OpenAI client initialized', {
    model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
  });

  return new OpenAI({ apiKey });
}

export function getOpenAIConfig() {
  return {
    model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.2'),
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '3000', 10),
  };
}
