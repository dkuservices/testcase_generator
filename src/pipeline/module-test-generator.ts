import { ScenarioWithSource } from '../models/batch-job';
import { GeneratedTestScenario, TestStep } from '../models/test-scenario';
import { createLlmProvider } from '../llm/provider-factory';
import { ChatMessage } from '../llm/types';
import { generateTestId } from '../utils/uuid-generator';

export async function generateModuleLevelTests(
  uniqueScenarios: ScenarioWithSource[],
  _jiraConfig: unknown, // Reserved for future use
  batchJobId: string,
  contextLogger: any,
  maxScenarios?: number
): Promise<GeneratedTestScenario[]> {
  contextLogger.info('Generating module-level integration tests');

  if (uniqueScenarios.length === 0) {
    contextLogger.warn('No scenarios available for module-level generation');
    return [];
  }

  // Group scenarios by page
  const pageGroups = groupScenariosByPage(uniqueScenarios);

  // Build module-level prompt
  const scenarioCountText = typeof maxScenarios === 'number' && maxScenarios > 0
    ? String(maxScenarios)
    : '3-4';
  const systemMessage = buildModuleSystemMessage(scenarioCountText);
  const userMessage = buildModuleUserMessage(pageGroups, scenarioCountText);

  const provider = createLlmProvider();
  const messages: ChatMessage[] = [
    { role: 'system', content: systemMessage },
    { role: 'user', content: userMessage },
  ];

  try {
    const response = await provider.generateCompletion(messages, {
      temperature: 0.2, // Lower temperature for more focused, deterministic scenarios
      maxTokens: 3000, // Keep output concise while allowing multi-scenario responses
    });

    if (!response.content) {
      throw new Error('Empty response from LLM');
    }

    let parsedResponse: any;
    try {
      parsedResponse = JSON.parse(response.content);
    } catch (parseError) {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = response.content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[1]);
      } else {
        throw parseError;
      }
    }

    const rawScenarios = extractScenarios(parsedResponse);

    if (!Array.isArray(rawScenarios) || rawScenarios.length === 0) {
      contextLogger.warn('No module-level scenarios generated');
      return [];
    }

    // Enrich scenarios with module-level tags
    const enrichedScenarios: GeneratedTestScenario[] = rawScenarios.map(raw => {
      // Convert legacy test_steps (strings) to new TestStep format if needed
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
            // Legacy string format - convert to new format
            return {
              step_number: idx + 1,
              action: String(step).trim(),
              input: '',
              expected_result: '',
            };
          })
        : [];

      // Convert preconditions to array if string
      const preconditions: string[] = Array.isArray(raw.preconditions)
        ? raw.preconditions.map((p: any) => String(p).trim())
        : typeof raw.preconditions === 'string'
          ? raw.preconditions.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
          : [];

      return {
        test_id: generateTestId(),
        test_name: raw.test_name || 'Unnamed module test',
        description: raw.description || raw.expected_result || 'Cieľ: Integračný test modulu',
        test_type: raw.test_type || 'functional',
        scenario_classification: raw.scenario_classification || 'happy_path',
        preconditions,
        test_steps: testSteps,
        priority: raw.priority || 'high',
        automation_status: raw.automation_status || 'automation_not_needed',
        test_repository_folder: raw.test_repository_folder || `Module/${batchJobId.substring(0, 8)}`,
        tags: ['ai-generated', 'module-level', 'integration-test', batchJobId],
        parent_jira_issue_id: 'MODULE-' + batchJobId.substring(0, 8),
        traceability: {
          source_confluence_page_id: 'batch-' + batchJobId,
          source_specification_version: '1',
          generated_at: new Date().toISOString(),
          llm_model: response.model || 'unknown',
        },
        validation_status: 'validated' as const, // Module-level tests are pre-validated
      };
    });

    contextLogger.info('Module-level tests generated', {
      count: enrichedScenarios.length,
    });

    return enrichedScenarios;

  } catch (error) {
    contextLogger.error('Failed to generate module-level tests', {
      error: (error as Error).message,
    });
    return [];
  }
}

interface PageGroup {
  scenarios: ScenarioWithSource[];
  pageName: string;
}

function groupScenariosByPage(
  scenarios: ScenarioWithSource[]
): Map<string, PageGroup> {
  const groups = new Map<string, PageGroup>();

  for (const scenarioWithSource of scenarios) {
    const pageId = scenarioWithSource.source_page_id;
    if (!groups.has(pageId)) {
      groups.set(pageId, {
        scenarios: [],
        pageName: scenarioWithSource.source_page_name || '',
      });
    }
    groups.get(pageId)!.scenarios.push(scenarioWithSource);
  }

  return groups;
}

function buildModuleSystemMessage(scenarioCountText: string): string {
  return `You are a Senior QA Integration Test Specialist with 15+ years of experience designing end-to-end workflow tests for enterprise systems.

YOUR TASK: Create ${scenarioCountText} integration test scenarios that validate COMPLETE BUSINESS WORKFLOWS spanning MULTIPLE pages in the module.

CRITICAL REQUIREMENTS - READ CAREFULLY:

1. MULTI-PAGE REQUIREMENT (MANDATORY):
   - Each test MUST touch at least 3-4 DIFFERENT pages
   - Each test step MUST start with [Page/Feature Name] →
   - Tests that touch only 1-2 pages will be REJECTED
   - You will receive a list of available pages - your tests MUST use multiple pages from that list

2. TEST STEP FORMAT (STRICTLY ENFORCED):
   ✓ CORRECT: "[Organizational Structure] → Vybrať organizačnú jednotku pre nového zamestnanca"
   ✓ CORRECT: "[Employee Creation] → Vytvoriť nového zamestnanca s menom 'Ján Novák'"
   ✗ WRONG: "Vybrať organizačnú jednotku" (missing page name)
   ✗ WRONG: "Go to employee page and create employee" (not in Slovak, vague)

3. WORKFLOW LOGIC:
   - Simulate how a REAL user would complete a business task
   - Navigate logically between pages: Create → View → Modify → Search → Verify
   - Each step should lead naturally to the next
   - End by validating data consistency across ALL pages you touched

4. SCENARIO COUNT:
   - Generate EXACTLY ${scenarioCountText} scenarios (not more, not less)
   - Each scenario must test a DIFFERENT business workflow
   - Focus on critical processes users perform daily

EXAMPLES OF CORRECT MULTI-PAGE WORKFLOWS:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Príklad 1: Kompletný proces zaradenia zamestnanca
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test_name: "Kompletný proces zaradenia zamestnanca - vytvorenie, priradenie, konfigurácia, overenie"
scenario_classification: "happy_path"
priority: "critical"

preconditions: "Používateľ je prihlásený s administrátorskými právami, existuje aspoň jedna organizačná jednotka"

test_steps: [
  { "action": "[Organizačná štruktúra] → Otvoriť stránku organizačnej štruktúry", "input": "Menu: Organizácia", "expected_result": "Zobrazí sa hierarchia organizačných jednotiek" },
  { "action": "[Organizačná štruktúra] → Vybrať organizačnú jednotku 'IT Oddelenie'", "input": "Klik na IT Oddelenie", "expected_result": "Jednotka je označená pre priradenie" },
  { "action": "[Vytvorenie zamestnanca] → Navigovať na vytvorenie zamestnanca", "input": "Tlačidlo: Nový zamestnanec", "expected_result": "Zobrazí sa formulár vytvorenia" },
  { "action": "[Vytvorenie zamestnanca] → Vyplniť údaje zamestnanca", "input": "Meno: Ján, Priezvisko: Novák, Email: jan.novak@example.sk", "expected_result": "Formulár je vyplnený" },
  { "action": "[Vytvorenie zamestnanca] → Uložiť zamestnanca", "input": "Tlačidlo: Uložiť", "expected_result": "Zamestnanec je vytvorený, presmerovanie na detail" },
  { "action": "[Detail zamestnanca] → Overiť zobrazenie údajov", "input": "-", "expected_result": "Zobrazuje sa meno 'Ján Novák' a email" },
  { "action": "[Vyhľadávanie] → Vyhľadať nového zamestnanca", "input": "Hľadaný text: Ján Novák", "expected_result": "Zamestnanec sa zobrazuje vo výsledkoch" },
  { "action": "[Organizačná štruktúra] → Overiť priradenie v štruktúre", "input": "Rozbaliť IT Oddelenie", "expected_result": "Ján Novák je zobrazený pod IT Oddelenie" }
]

expected_result: "Zamestnanec 'Ján Novák' je úspešne vytvorený, priradený k IT Oddeleniu a je viditeľný na všetkých stránkach s konzistentnými údajmi"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Príklad 2: Úprava údajov zamestnanca s propagáciou na všetky pohľady
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test_name: "Úprava údajov zamestnanca s okamžitou propagáciou na všetky pohľady"
scenario_classification: "happy_path"
priority: "high"

preconditions: "Existuje zamestnanec 'Peter Horváth' priradený k oddeleniu 'Marketing'"

test_steps: [
  { "action": "[Zoznam zamestnancov] → Otvoriť zoznam zamestnancov", "input": "Menu: Zamestnanci", "expected_result": "Zobrazí sa zoznam všetkých zamestnancov" },
  { "action": "[Zoznam zamestnancov] → Vyhľadať zamestnanca", "input": "Filter: Peter Horváth", "expected_result": "Zamestnanec je nájdený v zozname" },
  { "action": "[Detail zamestnanca] → Otvoriť detail zamestnanca", "input": "Klik na Peter Horváth", "expected_result": "Zobrazí sa detail s pozíciou Marketing Manager" },
  { "action": "[Administrácia profilu] → Otvoriť úpravu profilu", "input": "Tlačidlo: Upraviť", "expected_result": "Zobrazí sa editačný formulár" },
  { "action": "[Administrácia profilu] → Zmeniť pozíciu a oddelenie", "input": "Pozícia: Sales Director, Oddelenie: Predaj", "expected_result": "Hodnoty sú zmenené vo formulári" },
  { "action": "[Administrácia profilu] → Uložiť zmeny", "input": "Tlačidlo: Uložiť", "expected_result": "Zmeny sú uložené, presmerovanie na detail" },
  { "action": "[Vyhľadávanie] → Vyhľadať zamestnanca", "input": "Hľadaný text: Peter Horváth", "expected_result": "Zobrazuje sa s pozíciou Sales Director" },
  { "action": "[Organizačná štruktúra] → Overiť priradenie", "input": "Rozbaliť oddelenie Predaj", "expected_result": "Peter Horváth je pod oddelením Predaj" }
]

expected_result: "Zmeny pozície a oddelenia zamestnanca 'Peter Horváth' sa okamžite prejavili na všetkých stránkach bez potreby manuálneho obnovenia"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

KEY VALIDATION RULES:
- If a test has fewer than 6 steps touching 3+ different pages, it's TOO SIMPLE
- Every test must end with cross-page validation (check multiple pages show consistent data)
- test_name, test_steps a expected_result MUSIA byť v slovenčine
- NO single-page tests, NO isolated feature tests`;
}

function buildModuleUserMessage(
  pageGroups: Map<string, PageGroup>,
  scenarioCountText: string
): string {
  let message = '═══════════════════════════════════════════════════════\n';
  message += 'DOSTUPNÉ STRÁNKY V TOMTO MODULE\n';
  message += '═══════════════════════════════════════════════════════\n\n';

  let pageNumber = 1;
  const pageNames: string[] = [];

  for (const [pageId, group] of pageGroups.entries()) {
    const pageTitle = group.pageName || extractPageTitle(pageId) || `Stránka ${pageNumber}`;
    pageNames.push(pageTitle);

    message += `${pageNumber}. [${pageTitle}]\n`;
    message += `   ID stránky: ${pageId}\n`;
    message += `   Dostupné funkcie:\n`;

    const uniqueTestNames = new Set(group.scenarios.map(s => s.scenario.test_name));
    const features = Array.from(uniqueTestNames).slice(0, 3);
    for (const testName of features) {
      message += `   • ${testName}\n`;
    }
    message += '\n';
    pageNumber++;
  }

  message += '═══════════════════════════════════════════════════════\n';
  message += 'YOUR TASK\n';
  message += '═══════════════════════════════════════════════════════\n\n';

  message += `Design EXACTLY ${scenarioCountText} integration test scenarios.\n\n`;

  message += `MANDATORY REQUIREMENTS FOR EACH SCENARIO:\n`;
  message += `1. Must touch AT LEAST 3-4 pages from the list above\n`;
  message += `2. Each step MUST start with [Page Name] → followed by action in Slovak\n`;
  message += `3. Simulate a complete business workflow (create → view → modify → search → verify)\n`;
  message += `4. End with validation steps that check multiple pages for data consistency\n\n`;

  message += `STEP-BY-STEP APPROACH:\n`;
  message += `Step 1: Choose a business process (e.g., "Complete employee lifecycle")\n`;
  message += `Step 2: Identify which pages you'll touch (minimum 3-4 from the list)\n`;
  message += `Step 3: Plan the navigation flow (how to move logically between pages)\n`;
  message += `Step 4: Write detailed test steps with [Page Name] → Action format\n`;
  message += `Step 5: Add validation steps at the end to check all pages\n\n`;

  message += `EXAMPLE WORKFLOW PATTERN:\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `Business Process: "Complete employee creation and verification"\n\n`;
  message += `Pages to touch (from your list):\n`;
  message += `  1. Organizational Structure - to select unit\n`;
  message += `  2. Employee Creation - to create employee\n`;
  message += `  3. Employee Detail - to verify and configure\n`;
  message += `  4. Employee Search - to search and validate\n`;
  message += `  5. Employee List - to verify in listing\n\n`;
  message += `Workflow steps:\n`;
  message += `  [Organizational Structure] → Vybrať organizačnú jednotku\n`;
  message += `  [Employee Creation] → Vytvoriť nového zamestnanca s údajmi\n`;
  message += `  [Employee Detail] → Overiť detail zamestnanca\n`;
  message += `  [Employee Detail] → Priradiť k organizačnej jednotke\n`;
  message += `  [Employee Search] → Vyhľadať novo vytvoreného zamestnanca\n`;
  message += `  [Employee List] → Overiť zobrazenie v zozname\n`;
  message += `  [Organizational Structure] → Vrátiť sa a overiť v štruktúre\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  message += `BUSINESS WORKFLOW IDEAS FOR THIS MODULE:\n`;
  message += `Based on the pages available, consider these workflows:\n`;
  message += `• Complete employee lifecycle (create → assign → configure → verify across all views)\n`;
  message += `• Employee data modification with propagation validation\n`;
  message += `• Organizational structure changes and employee reassignment\n`;
  message += `• Cross-page search and data consistency validation\n\n`;

  message += `OUTPUT FORMAT - STRICT JSON:\n`;
  message += `{\n`;
  message += `  "scenarios": [\n`;
  message += `    {\n`;
  message += `      "test_name": "Popis biznis procesu v slovenčine",\n`;
  message += `      "test_type": "functional",\n`;
  message += `      "scenario_classification": "happy_path" | "negative" | "edge_case",\n`;
  message += `      "preconditions": "Počiatočný stav v slovenčine",\n`;
  message += `      "test_steps": [\n`;
  message += `        { "action": "[Názov stránky] → Akcia v slovenčine", "input": "Vstupné údaje", "expected_result": "Očakávaný výsledok kroku" },\n`;
  message += `        { "action": "[Iná stránka] → Ďalšia akcia", "input": "Údaje", "expected_result": "Výsledok" }\n`;
  message += `      ],\n`;
  message += `      "expected_result": "Celkový výsledok testu v slovenčine",\n`;
  message += `      "priority": "critical" | "high" | "medium" | "low"\n`;
  message += `    }\n`;
  message += `  ]\n`;
  message += `}\n\n`;

  message += `KRITICKÁ VALIDÁCIA PRED ODPOVEĎOU:\n`;
  message += `☑ Vytvoril som presne ${scenarioCountText} scenárov?\n`;
  message += `☑ Každý scenár sa dotýka minimálne 3-4 RÔZNYCH stránok?\n`;
  message += `☑ Každý krok má action s [Názov stránky] → a obsahuje input a expected_result?\n`;
  message += `☑ Všetko (test_name, test_steps, expected_result) je v slovenčine?\n`;
  message += `☑ Každý scenár testuje kompletný biznis workflow?\n`;
  message += `☑ Použil som skutočné názvy stránok zo zoznamu vyššie?\n\n`;

  message += `Generate your ${scenarioCountText} module-level integration scenarios now:`;

  return message;
}

function extractPageTitle(pageId: string): string | null {
  // Try to extract readable title from page ID
  // Page IDs often contain the title in URL-encoded form
  const match = pageId.match(/pages\/\d+\/(.+)/);
  if (match) {
    try {
      // Decode URL-encoded title
      const title = decodeURIComponent(match[1].replace(/\+/g, ' '));
      // Clean up common patterns
      return title
        .replace(/%C4%8D/g, 'č')
        .replace(/%C3%A1/g, 'á')
        .replace(/Obr-OS\d+\s*-\s*PoC\s*-\s*/i, '')
        .substring(0, 50);
    } catch {
      return null;
    }
  }
  return null;
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
