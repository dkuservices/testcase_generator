import { NormalizedInput } from '../models/specification-input';
import { createContextLogger } from '../utils/logger';

export interface PromptMessages {
  systemMessage: string;
  userMessage: string;
}

export function buildPrompt(normalizedInput: NormalizedInput): PromptMessages {
  const contextLogger = createContextLogger({
    step: 'prompt-building',
    parent_jira_issue_id: normalizedInput.metadata.parent_jira_issue_id,
  });

  contextLogger.debug('Building LLM prompt');

  const systemMessage = `You are a QA test scenario generator. Your task is to generate human-readable test scenarios, NOT test code or test scripts.

STRICT RULES:
1. Generate test SCENARIOS only - no code, no automation scripts
2. Do NOT introduce new business rules or functionality beyond the provided specification
3. Generate three types of scenarios: happy path, negative cases, and edge cases
4. Each scenario must be traceable to the specification
5. Be deterministic and factual - low creativity
6. Output must be valid JSON matching the provided schema

For each scenario, classify it as:
- happy_path: Valid inputs, normal flow, positive outcomes
- negative: Invalid inputs, error conditions, violations
- edge_case: Boundary values, rare conditions, unusual combinations`;

  const userMessage = `SYSTEM TYPE: ${normalizedInput.metadata.system_type}
FEATURE PRIORITY: ${normalizedInput.metadata.feature_priority}
PARENT JIRA ISSUE: ${normalizedInput.metadata.parent_jira_issue_id}

SPECIFICATION:
${normalizedInput.normalized_text}

Generate comprehensive test scenarios covering happy path, negative cases, and edge cases. Output as JSON array of test scenarios matching this schema:
[{
  "test_name": "string",
  "test_type": "functional" | "regression" | "smoke",
  "scenario_classification": "happy_path" | "negative" | "edge_case",
  "preconditions": "string",
  "test_steps": ["step1", "step2", ...],
  "expected_result": "string",
  "priority": "critical" | "high" | "medium" | "low"
}]`;

  contextLogger.debug('LLM prompt built', {
    system_message_length: systemMessage.length,
    user_message_length: userMessage.length,
  });

  return {
    systemMessage,
    userMessage,
  };
}
