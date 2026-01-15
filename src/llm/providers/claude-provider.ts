import { spawn } from 'child_process';
import { ChatMessage, LlmProvider, LlmResult, LlmGenerationOptions, LlmProfile } from '../types';
import { createContextLogger } from '../../utils/logger';

interface ClaudeCliResponse {
  type: string;
  subtype: string;
  is_error: boolean;
  result: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  }>;
  total_cost_usd?: number;
  session_id?: string;
}

export class ClaudeProvider implements LlmProvider {
  public readonly name = 'claude';
  private cliPath: string;
  private timeoutMs: number;

  constructor() {
    this.cliPath = process.env.CLAUDE_CLI_PATH || 'claude';
    this.timeoutMs = parseInt(process.env.CLAUDE_TIMEOUT_MS || '120000', 10);

    // Verify CLI is available
    if (!ClaudeProvider.isAvailable()) {
      throw new Error('Claude CLI not found. Please install Claude Code CLI and ensure it\'s in PATH, or set CLAUDE_CLI_PATH environment variable.');
    }
  }

  static isAvailable(): boolean {
    const cliPath = process.env.CLAUDE_CLI_PATH || 'claude';
    try {
      const { execSync } = require('child_process');
      execSync(`${cliPath} --version`, { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch (error) {
      return false;
    }
  }

  async generateCompletion(messages: ChatMessage[], options?: LlmGenerationOptions): Promise<LlmResult> {
    const contextLogger = createContextLogger({
      step: 'claude-cli-invocation',
      provider: this.name,
      model: options?.model
    });

    const model = options?.model || process.env.CLAUDE_MODEL || 'sonnet';
    const temperature = options?.temperature ?? parseFloat(process.env.CLAUDE_TEMPERATURE || '0.2');
    const maxTokens = options?.maxTokens || parseInt(process.env.CLAUDE_MAX_TOKENS || '4096', 10);

    const startTime = Date.now();

    try {
      // Retry logic with exponential backoff
      let lastError: Error | undefined;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          contextLogger.debug('Invoking Claude CLI', {
            attempt,
            model,
            temperature,
            max_tokens: maxTokens,
            cli_path: this.cliPath
          });

          const result = await this.executeClaude(messages, {
            model,
            temperature,
            maxTokens,
            responseFormat: options?.responseFormat
          }, contextLogger);

          const duration = Date.now() - startTime;
          contextLogger.info('Claude CLI invocation successful', {
            duration_ms: duration,
            attempt,
            usage: result.usage
          });

          return result;

        } catch (error) {
          lastError = error as Error;
          contextLogger.warn('Claude CLI invocation attempt failed', {
            attempt,
            error: (error as Error).message
          });

          // Exponential backoff: 2s, 4s, 8s
          if (attempt < 3) {
            const delayMs = 2000 * Math.pow(2, attempt - 1);
            contextLogger.debug('Retrying after delay', { delay_ms: delayMs });
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
      }

      throw lastError || new Error('Claude CLI invocation failed after 3 attempts');

    } catch (error) {
      const duration = Date.now() - startTime;
      contextLogger.error('Claude CLI invocation failed', {
        error: (error as Error).message,
        duration_ms: duration,
        model,
        cli_path: this.cliPath
      });
      throw error;
    }
  }

  private async executeClaude(
    messages: ChatMessage[],
    options: {
      model: string;
      temperature: number;
      maxTokens: number;
      responseFormat?: 'json' | 'text';
    },
    contextLogger: any
  ): Promise<LlmResult> {
    // Construct prompt from messages
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const userMsg = messages.find(m => m.role === 'user')?.content || '';

    // Build CLI arguments (NO prompt text in args - will use stdin instead)
    const args = [
      '--print',                                    // Non-interactive mode
      '--output-format', 'json',                    // Get JSON response
      '--model', options.model,                     // Specify model
      '--no-session-persistence'                    // Don't save session
    ];

    // Add system prompt as argument (shorter, should fit)
    if (systemMsg) {
      args.push('--system-prompt', systemMsg);
    }

    // For JSON output, add explicit instruction in user message
    let promptText = userMsg;
    if (options.responseFormat === 'json') {
      promptText += '\n\nIMPORTANT: You must respond with valid JSON only. Do not add any explanatory text outside the JSON structure.';
    }

    // NOTE: We'll pass the prompt via stdin to avoid Windows command-line length limits

    contextLogger.log('silly', 'Executing Claude CLI', {
      args: args,
      prompt_length: promptText.length
    });

    // Spawn Claude CLI process
    return new Promise((resolve, reject) => {
      const claude = spawn(this.cliPath, args, {
        timeout: this.timeoutMs,
        stdio: ['pipe', 'pipe', 'pipe'],  // Use stdin pipe for prompt input
        shell: process.platform === 'win32'  // Use shell on Windows
      });

      // Write prompt to stdin and close it
      try {
        claude.stdin.write(promptText);
        claude.stdin.end();
      } catch (error) {
        reject(new Error(`Failed to write prompt to stdin: ${(error as Error).message}`));
        return;
      }

      let stdout = '';
      let stderr = '';

      claude.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      claude.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      claude.on('error', (error) => {
        reject(new Error(`Failed to spawn Claude CLI: ${error.message}`));
      });

      claude.on('close', (code) => {
        if (code === 0 && stdout) {
          try {
            // Parse Claude CLI JSON response
            const cliResponse: ClaudeCliResponse = JSON.parse(stdout);

            if (cliResponse.is_error || cliResponse.subtype !== 'success') {
              reject(new Error(`Claude CLI returned error: ${cliResponse.result}`));
              return;
            }

            // Extract content from result (may be wrapped in markdown code blocks)
            let content = cliResponse.result;

            // If expecting JSON, extract from markdown code blocks
            if (options.responseFormat === 'json') {
              content = this.extractJsonFromMarkdown(content);

              // Validate and repair JSON
              try {
                const parsed = JSON.parse(content);
                content = JSON.stringify(parsed);
                contextLogger.debug('Claude JSON response validated successfully');
              } catch (parseError) {
                contextLogger.warn('JSON response invalid, attempting repair', {
                  error: (parseError as Error).message
                });

                // Attempt repair
                const repairedContent = this.repairJson(content);
                try {
                  const parsed = JSON.parse(repairedContent);
                  content = JSON.stringify(parsed);
                  contextLogger.info('Claude JSON repair successful');
                } catch (repairError) {
                  contextLogger.error('Claude JSON repair failed', {
                    parse_error: (parseError as Error).message,
                    repair_error: (repairError as Error).message,
                    raw_content: content.substring(0, 200) + '...'
                  });
                  reject(new Error('Invalid JSON response from Claude CLI'));
                  return;
                }
              }
            }

            // Extract token usage
            const usage = {
              prompt_tokens: (cliResponse.usage?.input_tokens || 0) + (cliResponse.usage?.cache_read_input_tokens || 0),
              completion_tokens: cliResponse.usage?.output_tokens || 0,
              total_tokens: ((cliResponse.usage?.input_tokens || 0) + (cliResponse.usage?.cache_read_input_tokens || 0) + (cliResponse.usage?.output_tokens || 0))
            };

            resolve({
              content,
              model: options.model,
              temperature: options.temperature,
              usage
            });

          } catch (parseError) {
            reject(new Error(`Failed to parse Claude CLI output: ${(parseError as Error).message}`));
          }
        } else {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr || stdout}`));
        }
      });

      // Handle timeout
      setTimeout(() => {
        if (claude.exitCode === null) {
          claude.kill();
          reject(new Error(`Claude CLI timed out after ${this.timeoutMs}ms`));
        }
      }, this.timeoutMs);
    });
  }

  /**
   * Extract JSON from markdown code blocks
   */
  private extractJsonFromMarkdown(content: string): string {
    // Look for ```json ... ``` or ``` ... ``` blocks
    const jsonBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonBlockMatch) {
      return jsonBlockMatch[1].trim();
    }

    // If no code blocks, return as-is
    return content.trim();
  }

  /**
   * Repair common JSON formatting issues
   * (Reused from Ollama provider)
   */
  private repairJson(content: string): string {
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
      .replace(/,\s*}/g, '}')           // Remove trailing commas before }
      .replace(/,\s*]/g, ']')           // Remove trailing commas before ]
      .replace(/'/g, '"')               // Replace single quotes with double quotes
      .replace(/(\w+):/g, '"$1":');     // Quote unquoted keys

    return repaired;
  }

  /**
   * Get primary profile configuration
   */
  getPrimaryProfile(): LlmProfile {
    return {
      name: 'primary',
      model: process.env.CLAUDE_MODEL || 'sonnet',
      temperature: parseFloat(process.env.CLAUDE_TEMPERATURE || '0.2'),
      maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS || '4096', 10)
    };
  }

  /**
   * Get fallback profile configuration with stricter settings
   */
  getFallbackProfile(): LlmProfile {
    return {
      name: 'fallback',
      model: process.env.CLAUDE_MODEL_FALLBACK || 'haiku',
      temperature: parseFloat(process.env.CLAUDE_TEMPERATURE_FALLBACK || '0.0'),
      maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS || '4096', 10),
      systemPromptSuffix: '\n\nIMPORTANT: You must respond with valid JSON only. Be extremely precise and follow the exact format specified. Do not add any explanatory text outside the JSON structure.'
    };
  }
}
