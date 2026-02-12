import { ScenarioWithSource } from '../models/batch-job';
import { GeneratedTestScenario, TestStep } from '../models/test-scenario';
import { createLlmProvider } from '../llm/provider-factory';
import { ChatMessage } from '../llm/types';
import { generateTestId } from '../utils/uuid-generator';

export interface ComponentGroup {
  componentId: string;
  componentName: string;
  scenarios: ScenarioWithSource[];
}

export async function generateProjectLevelTests(
  componentGroups: ComponentGroup[],
  manualContext: string | null,
  batchJobId: string,
  contextLogger: any,
  maxScenarios?: number
): Promise<GeneratedTestScenario[]> {
  contextLogger.info('Generating project-level cross-module tests');

  if (componentGroups.length === 0) {
    contextLogger.warn('No component groups available for project-level generation');
    return [];
  }

  const scenarioCountText = typeof maxScenarios === 'number' && maxScenarios > 0
    ? String(maxScenarios)
    : '3-5';
  const systemMessage = buildProjectSystemMessage(scenarioCountText);
  const userMessage = buildProjectUserMessage(componentGroups, manualContext, scenarioCountText);

  const provider = createLlmProvider();
  const messages: ChatMessage[] = [
    { role: 'system', content: systemMessage },
    { role: 'user', content: userMessage },
  ];

  try {
    const response = await provider.generateCompletion(messages, {
      temperature: 0.2,
      maxTokens: 4096,
    });

    if (!response.content) {
      throw new Error('Empty response from LLM');
    }

    let parsedResponse: any;
    try {
      parsedResponse = JSON.parse(response.content);
    } catch (parseError) {
      const jsonMatch = response.content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[1]);
      } else {
        throw parseError;
      }
    }

    const rawScenarios = extractScenarios(parsedResponse);

    if (!Array.isArray(rawScenarios) || rawScenarios.length === 0) {
      contextLogger.warn('No project-level scenarios generated');
      return [];
    }

    const enrichedScenarios: GeneratedTestScenario[] = rawScenarios.map(raw => {
      const testSteps: TestStep[] = Array.isArray(raw.test_steps)
        ? raw.test_steps.map((step: any, idx: number) => {
            if (typeof step === 'object' && step.action) {
              return {
                step_number: step.step_number ?? idx + 1,
                action: String(step.action || '').trim(),
                input: String(step.input || '').trim(),
                expected_result: String(step.expected_result || '').trim(),
              };
            }
            return {
              step_number: idx + 1,
              action: String(step).trim(),
              input: '',
              expected_result: '',
            };
          })
        : [];

      const preconditions: string[] = Array.isArray(raw.preconditions)
        ? raw.preconditions.map((p: any) => String(p).trim())
        : typeof raw.preconditions === 'string'
          ? raw.preconditions.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
          : [];

      return {
        test_id: generateTestId(),
        test_name: raw.test_name || 'Unnamed cross-module test',
        description: raw.description || raw.expected_result || 'Cieľ: Cross-modulový integračný test projektu',
        test_type: raw.test_type || 'functional',
        scenario_classification: raw.scenario_classification || 'happy_path',
        preconditions,
        test_steps: testSteps,
        priority: raw.priority || 'high',
        automation_status: raw.automation_status || 'automation_not_needed',
        test_repository_folder: raw.test_repository_folder || `Project/${batchJobId.substring(0, 8)}`,
        tags: ['ai-generated', 'project-level', 'cross-module-test', batchJobId],
        parent_jira_issue_id: 'PROJECT-' + batchJobId.substring(0, 8),
        traceability: {
          source_confluence_page_id: 'project-' + batchJobId,
          source_specification_version: '1',
          generated_at: new Date().toISOString(),
          llm_model: response.model || 'unknown',
        },
        validation_status: 'validated' as const,
      };
    });

    contextLogger.info('Project-level cross-module tests generated', {
      count: enrichedScenarios.length,
    });

    return enrichedScenarios;

  } catch (error) {
    contextLogger.error('Failed to generate project-level tests', {
      error: (error as Error).message,
    });
    return [];
  }
}

function buildProjectSystemMessage(scenarioCountText: string): string {
  return `You are a Senior QA Integration Test Architect with 15+ years of experience designing CROSS-MODULE end-to-end tests for large enterprise systems.

YOUR TASK: Create ${scenarioCountText} CROSS-MODULE test scenarios that validate COMPLETE BUSINESS WORKFLOWS spanning MULTIPLE MODULES (components) in the project.

CRITICAL DIFFERENCE FROM MODULE-LEVEL TESTS:
- Module-level tests span pages WITHIN a single module
- YOUR tests span ACROSS MULTIPLE MODULES (components) in the entire project
- These are the highest-level integration tests, validating that different parts of the system work together

CRITICAL REQUIREMENTS - READ CAREFULLY:

1. CROSS-MODULE REQUIREMENT (MANDATORY):
   - Each test MUST touch at least 3 DIFFERENT MODULES (components)
   - Each test step MUST start with [Nazov modulu] →
   - Tests that stay within 1-2 modules will be REJECTED
   - You will receive a list of available modules and their features

2. TEST STEP FORMAT (STRICTLY ENFORCED):
   ✓ CORRECT: "[Sprava uzivatelov] → Vytvoriť nového používateľa s rolou administrátor"
   ✓ CORRECT: "[Fakturacia] → Overiť, že nový používateľ má prístup k faktúram"
   ✗ WRONG: "Vytvoriť používateľa" (missing module name)
   ✗ WRONG: "Create user in user management" (not in Slovak)

3. WORKFLOW LOGIC:
   - Simulate how REAL business processes flow across different system modules
   - Think about data that is created in one module and used/verified in another
   - Focus on inter-module dependencies and data consistency
   - End by validating data consistency across ALL modules you touched

4. SCENARIO COUNT:
   - Generate EXACTLY ${scenarioCountText} scenarios (not more, not less)
   - Each scenario must test a DIFFERENT cross-module business workflow
   - Focus on critical end-to-end processes

5. HANDBOOK/MANUAL CONTEXT:
   - If provided, use the handbook context to understand existing system functionality
   - Your tests should validate how changes in one module affect other modules
   - Reference real module names and features from the handbook

KEY VALIDATION RULES:
- If a test touches fewer than 3 different modules, it's NOT a cross-module test
- Every test must end with cross-module validation steps
- test_name, test_steps and expected_result MUST be in Slovak
- NO single-module tests, NO isolated feature tests`;
}

function buildProjectUserMessage(
  componentGroups: ComponentGroup[],
  manualContext: string | null,
  scenarioCountText: string
): string {
  let message = '';

  // Include handbook/manual context if available
  if (manualContext) {
    message += '═══════════════════════════════════════════════════════\n';
    message += 'PRIRUCKA / SPECIFIKACIA EXISTUJUCEJ FUNKCIONALITY\n';
    message += '═══════════════════════════════════════════════════════\n\n';
    message += manualContext;
    message += '\n\n';
  }

  message += '═══════════════════════════════════════════════════════\n';
  message += 'DOSTUPNE MODULY (KOMPONENTY) V PROJEKTE\n';
  message += '═══════════════════════════════════════════════════════\n\n';

  let moduleNumber = 1;
  for (const group of componentGroups) {
    message += `${moduleNumber}. [${group.componentName}]\n`;
    message += `   ID modulu: ${group.componentId}\n`;
    message += `   Pocet testov: ${group.scenarios.length}\n`;
    message += `   Dostupne funkcie:\n`;

    const uniqueTestNames = new Set(group.scenarios.map(s => s.scenario.test_name));
    const features = Array.from(uniqueTestNames).slice(0, 5);
    for (const testName of features) {
      message += `   • ${testName}\n`;
    }
    message += '\n';
    moduleNumber++;
  }

  message += '═══════════════════════════════════════════════════════\n';
  message += 'ULOHA\n';
  message += '═══════════════════════════════════════════════════════\n\n';

  message += `Navrhnite PRESNE ${scenarioCountText} CROSS-MODULOVYCH integracnych testovacich scenarov.\n\n`;

  message += `POVINNE POZIADAVKY PRE KAZDY SCENAR:\n`;
  message += `1. Musi sa dotykat MINIMALNE 3 ROZNYCH MODULOV zo zoznamu vyssie\n`;
  message += `2. Kazdy krok MUSI zacinat s [Nazov modulu] → nasledovany akciou v slovencine\n`;
  message += `3. Simulovat kompletny biznis workflow (vytvorenie → spracovanie → overenie napriec modulmi)\n`;
  message += `4. Koncit validacnymi krokmi kontrolujucimi konzistenciu dat napriec modulmi\n\n`;

  message += `PRIKLAD CROSS-MODULOVEHO WORKFLOW PATTERNU:\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `Biznis proces: "Kompletny proces objednavky s fakturovanim"\n\n`;
  message += `Moduly: Sprava produktov → Objednavky → Fakturacia → Skladove hospod.\n\n`;
  message += `  [Sprava produktov] → Overit dostupnost produktu na sklade\n`;
  message += `  [Objednavky] → Vytvorit novu objednavku s vybranym produktom\n`;
  message += `  [Objednavky] → Potvrdit objednavku a odoslat na spracovanie\n`;
  message += `  [Fakturacia] → Overit automaticke vytvorenie faktury\n`;
  message += `  [Skladove hospod.] → Overit znizenie stavu na sklade\n`;
  message += `  [Sprava produktov] → Overit aktualizovany stav dostupnosti\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  message += `OUTPUT FORMAT - STRICT JSON:\n`;
  message += `{\n`;
  message += `  "scenarios": [\n`;
  message += `    {\n`;
  message += `      "test_name": "Popis cross-moduloveho biznis procesu v slovencine",\n`;
  message += `      "test_type": "functional",\n`;
  message += `      "scenario_classification": "happy_path" | "negative" | "edge_case",\n`;
  message += `      "preconditions": "Pociatocny stav v slovencine",\n`;
  message += `      "test_steps": [\n`;
  message += `        { "action": "[Nazov modulu] → Akcia v slovencine", "input": "Vstupne udaje", "expected_result": "Ocakavany vysledok kroku" },\n`;
  message += `        { "action": "[Iny modul] → Dalsia akcia", "input": "Udaje", "expected_result": "Vysledok" }\n`;
  message += `      ],\n`;
  message += `      "expected_result": "Celkovy vysledok testu v slovencine",\n`;
  message += `      "priority": "critical" | "high" | "medium" | "low"\n`;
  message += `    }\n`;
  message += `  ]\n`;
  message += `}\n\n`;

  message += `KRITICKA VALIDACIA PRED ODPOVEDOU:\n`;
  message += `☑ Vytvoril som presne ${scenarioCountText} scenarov?\n`;
  message += `☑ Kazdy scenar sa dotyka minimalne 3 ROZNYCH MODULOV?\n`;
  message += `☑ Kazdy krok ma action s [Nazov modulu] → a obsahuje input a expected_result?\n`;
  message += `☑ Vsetko (test_name, test_steps, expected_result) je v slovencine?\n`;
  message += `☑ Kazdy scenar testuje kompletny cross-modulovy biznis workflow?\n`;
  message += `☑ Pouzil som skutocne nazvy modulov zo zoznamu vyssie?\n\n`;

  message += `Vygenerujte ${scenarioCountText} cross-modulovych integracnych scenarov teraz:`;

  return message;
}

function extractScenarios(parsedResponse: unknown): any[] {
  if (Array.isArray(parsedResponse)) {
    return parsedResponse;
  }

  if (parsedResponse && typeof parsedResponse === 'object') {
    const candidate = parsedResponse as Record<string, any>;
    const scenarios =
      candidate.scenarios ||
      candidate.test_scenarios ||
      candidate.testScenarios ||
      candidate.items ||
      candidate.data;

    if (Array.isArray(scenarios)) {
      return scenarios;
    }
  }

  return [];
}
