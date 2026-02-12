import { Router, Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { getPage } from '../../storage/page-store';
import { getComponent } from '../../storage/component-store';
import { getJob } from '../../storage/job-store';
import { createLlmProvider } from '../../llm/provider-factory';
import { ChatMessage } from '../../llm/types';
import { GeneratedTestScenario, TestStep } from '../../models/test-scenario';
import logger from '../../utils/logger';

const router = Router();

const chatSchema = Joi.object({
  message: Joi.string().trim().min(1).max(2000).required(),
  history: Joi.array().items(
    Joi.object({
      role: Joi.string().valid('user', 'assistant').required(),
      content: Joi.string().trim().min(1).max(2000).required(),
    })
  ).max(10).optional(),
});

const MAX_CONTEXT_SCENARIOS = 20;
const MAX_CONTEXT_STEPS = 6;
const MAX_CONTEXT_PRECONDITIONS = 4;
const MAX_CONTEXT_NOTES = 3;

router.post('/page/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { error, value } = chatSchema.validate(req.body);

    if (error) {
      res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => d.message),
      });
      return;
    }

    const page = await getPage(id);
    if (!page) {
      res.status(404).json({ error: 'Page not found', page_id: id });
      return;
    }

    const job = page.latest_job_id ? await getJob(page.latest_job_id) : null;
    const scenarios = job?.results?.scenarios || [];
    const scenarioCount = job?.results?.total_scenarios ?? scenarios.length;
    const scenarioLimit = job?.input?.scenario_override?.count;

    if (scenarios.length === 0) {
      res.json({
        reply: 'No test scenarios are available yet for this page. Generate tests first, then ask me to review coverage.',
        context: {
          scenario_count: 0,
          scenario_limit: scenarioLimit,
          scope: 'page',
        },
      });
      return;
    }

    const result = await generateChatReply({
      message: value.message,
      history: value.history || [],
      scenarios,
      scopeLabel: `Page: ${page.name}`,
      scenarioCount,
      scenarioLimit,
    });

    res.json({
      reply: result.reply,
      model: result.model,
      usage: result.usage,
      context: {
        scenario_count: scenarioCount,
        scenario_limit: scenarioLimit,
        scope: 'page',
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/component/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { error, value } = chatSchema.validate(req.body);

    if (error) {
      res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => d.message),
      });
      return;
    }

    const component = await getComponent(id);
    if (!component) {
      res.status(404).json({ error: 'Component not found', component_id: id });
      return;
    }

    const scenarios = component.component_tests?.scenarios || [];
    const scenarioCount = scenarios.length;

    if (scenarios.length === 0) {
      res.json({
        reply: 'No integration tests are available yet for this component. Generate integration tests first, then ask me to review coverage.',
        context: {
          scenario_count: 0,
          scope: 'component',
        },
      });
      return;
    }

    const result = await generateChatReply({
      message: value.message,
      history: value.history || [],
      scenarios,
      scopeLabel: `Component: ${component.name}`,
      scenarioCount,
    });

    res.json({
      reply: result.reply,
      model: result.model,
      usage: result.usage,
      context: {
        scenario_count: scenarioCount,
        scope: 'component',
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;

async function generateChatReply(options: {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  scenarios: GeneratedTestScenario[];
  scopeLabel: string;
  scenarioCount: number;
  scenarioLimit?: number;
}): Promise<{ reply: string; model?: string; usage?: Record<string, number | undefined> }> {
  const provider = createLlmProvider();

  const systemMessage = [
    'You are a senior QA and refactor advisor.',
    'Use only the provided test scenarios to answer questions about coverage, refactor ideas, and risk.',
    'If the user asks for changes not supported by the scenarios, say what is missing and suggest new tests clearly as proposals.',
    'Keep the response concise and action-oriented.',
  ].join(' ');

  const contextMessage = buildScenarioContext(options);

  const historyMessages: ChatMessage[] = options.history
    .filter(entry => entry && entry.content)
    .map(entry => ({
      role: entry.role,
      content: trimText(normalizeText(entry.content), 1200),
    }));

  const messages: ChatMessage[] = [
    { role: 'system', content: systemMessage },
    { role: 'system', content: contextMessage },
    ...historyMessages,
    { role: 'user', content: options.message },
  ];

  logger.info('Chat request', {
    scope: options.scopeLabel,
    scenario_count: options.scenarioCount,
    history_count: historyMessages.length,
    provider: provider.name,
  });

  const response = await provider.generateCompletion(messages, {
    temperature: 0.4,
    maxTokens: 900,
  });

  return {
    reply: response.content?.trim() || 'No response from assistant.',
    model: response.model,
    usage: response.usage,
  };
}

function buildScenarioContext(options: {
  scenarios: GeneratedTestScenario[];
  scopeLabel: string;
  scenarioCount: number;
  scenarioLimit?: number;
}): string {
  const lines: string[] = [];
  lines.push('TEST SCENARIO CONTEXT');
  lines.push(`Scope: ${options.scopeLabel}`);
  lines.push(`Scenario count: ${options.scenarioCount}`);
  if (typeof options.scenarioLimit === 'number') {
    lines.push(`Scenario target: ${options.scenarioLimit}`);
  }
  lines.push('');
  lines.push('SCENARIOS:');

  const limited = options.scenarios.slice(0, MAX_CONTEXT_SCENARIOS);
  limited.forEach((scenario, index) => {
    lines.push(formatScenarioSummary(scenario, index + 1));
  });

  if (options.scenarios.length > limited.length) {
    lines.push(`Only showing first ${limited.length} scenarios.`);
  }

  return lines.join('\n');
}

function formatScenarioSummary(scenario: GeneratedTestScenario, index: number): string {
  const lines: string[] = [];
  const title = normalizeText(scenario.test_name || `Scenario ${index}`);
  lines.push(`${index}. ${trimText(title, 140)}`);

  const meta: string[] = [];
  if (scenario.test_type) meta.push(`type=${scenario.test_type}`);
  if (scenario.scenario_classification) meta.push(`class=${scenario.scenario_classification}`);
  if (scenario.priority) meta.push(`priority=${scenario.priority}`);
  if (scenario.validation_status) meta.push(`status=${scenario.validation_status}`);
  if (meta.length > 0) {
    lines.push(`   meta: ${meta.join(', ')}`);
  }

  const description = normalizeText((scenario as { description?: string }).description || '');
  if (description) {
    lines.push(`   description: ${trimText(description, 200)}`);
  }

  const preconditions = Array.isArray(scenario.preconditions)
    ? scenario.preconditions
    : scenario.preconditions
      ? [String(scenario.preconditions)]
      : [];

  if (preconditions.length > 0) {
    lines.push(`   preconditions: ${formatList(preconditions, MAX_CONTEXT_PRECONDITIONS, 120)}`);
  }

  if (Array.isArray(scenario.test_steps) && scenario.test_steps.length > 0) {
    lines.push('   steps:');
    scenario.test_steps.slice(0, MAX_CONTEXT_STEPS).forEach((step: TestStep | string, idx: number) => {
      lines.push(`     - ${formatStep(step, idx + 1)}`);
    });
    if (scenario.test_steps.length > MAX_CONTEXT_STEPS) {
      lines.push(`     - (+${scenario.test_steps.length - MAX_CONTEXT_STEPS} more steps)`);
    }
  }

  // Handle validation_notes which can be string or ValidationDetail[]
  let notes: string[] = [];
  if (Array.isArray(scenario.validation_notes)) {
    // Check if it's ValidationDetail[] or string[]
    notes = scenario.validation_notes.map(note =>
      typeof note === 'string' ? note : (note.message || `${note.type}: ${note.severity}`)
    );
  } else if (scenario.validation_notes) {
    notes = [scenario.validation_notes];
  }

  if (notes.length > 0) {
    lines.push(`   validation_notes: ${formatList(notes, MAX_CONTEXT_NOTES, 140)}`);
  }

  return lines.join('\n');
}

function formatStep(step: TestStep | string, index: number): string {
  if (typeof step === 'string') {
    return trimText(normalizeText(step), 220);
  }
  const action = normalizeText(step.action || '');
  const input = normalizeText(step.input || '');
  const expected = normalizeText(step.expected_result || '');
  let line = action || `Step ${index}`;
  if (input) {
    line += ` | input: ${input}`;
  }
  if (expected) {
    line += ` | expect: ${expected}`;
  }
  return trimText(line, 220);
}

function formatList(items: string[], maxItems: number, maxItemLength: number): string {
  const trimmed = items
    .filter(Boolean)
    .map(item => trimText(normalizeText(item), maxItemLength))
    .filter(Boolean)
    .slice(0, maxItems);

  return trimmed.join('; ');
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function trimText(value: string, maxLength: number): string {
  if (!value || value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
