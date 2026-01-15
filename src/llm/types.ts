export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResult {
  content: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
  temperature?: number;
}

export interface LlmProvider {
  name: string;
  generateCompletion(messages: ChatMessage[], options?: LlmGenerationOptions): Promise<LlmResult>;
}

export interface LlmGenerationOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  responseFormat?: 'json' | 'text';
}

export interface LlmProfile {
  name: string;
  model: string;
  temperature: number;
  maxTokens?: number;
  systemPromptSuffix?: string;
}