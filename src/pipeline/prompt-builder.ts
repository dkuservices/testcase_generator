import { NormalizedInput } from '../models/specification-input';
import { ScenarioPlan } from './scenario-planner';
import { createContextLogger } from '../utils/logger';

export interface PromptMessages {
  systemMessage: string;
  userMessage: string;
}

export function buildPrompt(normalizedInput: NormalizedInput, scenarioPlan: ScenarioPlan): PromptMessages {
  const contextLogger = createContextLogger({
    step: 'prompt-building',
    parent_jira_issue_id: normalizedInput.metadata.parent_jira_issue_id,
  });

  contextLogger.debug('Building LLM prompt', {
    scenario_count: scenarioPlan.recommended_count,
    scenario_types: scenarioPlan.scenario_types.map(st => st.classification),
  });

const systemMessage = `You are a Senior QA Test Designer with 15+ years of experience in enterprise software testing. You specialize in creating comprehensive test cases in TestFlo/Jira format with structured test steps.

YOUR EXPERTISE:
- Designing test cases following ISTQB Advanced Level principles
- Creating TestFlo-compatible test cases with Action/Input/Expected Result structure
- Writing complete user journeys that manual testers can follow step-by-step
- Organizing tests into logical repository folders

CRITICAL RULES (MUST FOLLOW):

1. TEST STEP STRUCTURE (TestFlo Format):
   Each test step MUST have three parts:
   - action: What the tester does (e.g., "Navigovať na stránku")
   - input: Data or parameters used (can be empty if no input needed)
   - expected_result: What should happen after this specific step

   Example step:
   {
     "step_number": 1,
     "action": "Navigovať na Organizačná štruktúra",
     "input": "Menu → OŠ",
     "expected_result": "Načíta sa mobilná OŠ (MZ)"
   }

2. DESCRIPTION (GOAL):
   - Start with "Cieľ:" (Goal:)
   - Clearly state what the test validates
   - Mention key features being tested

3. PRECONDITIONS:
   - List as array of separate items
   - Include: user roles, system state, test data requirements
   - Each item should be a complete statement

4. LANGUAGE REQUIREMENT - CRITICAL - SLOVENČINA:
   - VŠETKO MUSÍ BYŤ V SLOVENČINE (Slovak language) - BEZ VÝNIMIEK
   - test_name MUSÍ byť v slovenčine (napr. "Overenie prihlásenia používateľa", NIE "User Login Verification")
   - description, preconditions, actions, inputs, expected results - VŠETKO v slovenčine
   - Toto je slovenská spoločnosť pracujúca na slovenských projektoch
   - NIKDY nepoužívaj angličtinu v test_name, description alebo test_steps
   - Príklady správnych slovenských názvov testov:
     • "Overenie úspešného prihlásenia používateľa"
     • "Zobrazenie chybového hlásenia pri neplatnom hesle"
     • "Navigácia v organizačnej štruktúre - mobilné zobrazenie"

5. AUTOMATION STATUS:
   - "ready_for_automation": Test has clear, automatable steps
   - "automation_not_needed": Manual testing preferred (UX, visual, exploratory)

6. TEST REPOSITORY FOLDER:
   - Suggest logical folder path for test organization
   - Format: "ProjectKey/ModuleName" or "ProjectKey/FeatureName"

SCENARIO CLASSIFICATION GUIDE:

happy_path (Priority: Critical/High):
  → Main business workflow with valid data
  → Complete end-to-end user journey

negative (Priority: High/Medium):
  → Invalid inputs, error handling, validation
  → System stability under error conditions

edge_case (Priority: Medium/Low):
  → Boundary values, special characters
  → Alternative flows, rare but valid scenarios

EXAMPLE OF HIGH-QUALITY TEST CASE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "test_name": "ORG Štr - Zobrazenie a navigácia v organizačnej štruktúre - MOBILE",
  "description": "Cieľ: Mobilné zobrazenie OŠ – potvrdiť správnosť zobrazenia a interakcií v MZ (lineárny zoznam kariet, rozbalenie/zbalenie, deep-link, preklik na detail).",
  "test_type": "functional",
  "scenario_classification": "happy_path",
  "preconditions": [
    "Platné konto na Portál (meno/heslo).",
    "V AD platná OŠ s root OJ „10 000".",
    "Test dáta: OJ_A s managedBy aktívnym a jpegPhoto prítomnou.",
    "Mobil: iOS/Android, moderný prehliadač; orientácia „portrait"."
  ],
  "test_steps": [
    {
      "step_number": 1,
      "action": "Navigovať na Organizačná štruktúra",
      "input": "Menu → OŠ",
      "expected_result": "Načíta sa mobilná OŠ (MZ)"
    },
    {
      "step_number": 2,
      "action": "Overiť default zobrazenie",
      "input": "",
      "expected_result": "Zobrazený root „Úsek 10 000"; rozbalená 1. úroveň; root sa nedá zbaliť"
    },
    {
      "step_number": 3,
      "action": "Rozbaliť uzol 1. úrovne",
      "input": "Tap na kartu alebo „>" pri OJ",
      "expected_result": "Zobrazí sa ďalšia úroveň pod kartou s odsadením; rodič zvýraznený"
    }
  ],
  "priority": "high",
  "automation_status": "automation_not_needed",
  "test_repository_folder": "KIS2/ORG_Struktura"
}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHAT MAKES YOUR TEST CASES EXCELLENT:
✓ Clear separation of Action, Input, and Expected Result
✓ Each step has its own expected outcome
✓ Preconditions as organized list
✓ Descriptive goal in description
✓ Realistic test data (actual values, not placeholders)
✓ Logical folder organization`;


  // Build scenario requirements from the plan
  const scenarioRequirements = scenarioPlan.scenario_types.map((st, idx) =>
    `${idx + 1}. ${st.classification.toUpperCase()} scenario (Priority: ${st.priority})
   → Focus: ${st.focus}`
  ).join('\n\n');

  const userMessage = `═══════════════════════════════════════════════════════
FEATURE SPECIFICATION TO TEST
═══════════════════════════════════════════════════════

System Type: ${normalizedInput.metadata.system_type}
Feature Priority: ${normalizedInput.metadata.feature_priority}
Parent Jira Issue: ${normalizedInput.metadata.parent_jira_issue_id}
Suggested Repository Folder: ${scenarioPlan.test_repository_folder}

SPECIFICATION CONTENT:
${normalizedInput.normalized_text}

═══════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════

Design EXACTLY ${scenarioPlan.recommended_count} test scenario(s) for this feature:

${scenarioRequirements}

Planning Reasoning: ${scenarioPlan.reasoning}

═══════════════════════════════════════════════════════
REQUIREMENTS FOR EACH TEST CASE
═══════════════════════════════════════════════════════

✓ Use TestFlo step structure: action, input, expected_result
✓ Start description with "Cieľ:" (Goal)
✓ List preconditions as array of separate items
✓ Each step has its OWN expected result
✓ Use realistic test data (actual values, not placeholders)
✓ ALL CONTENT IN SLOVENČINA - VRÁTANE test_name!
✓ test_name MUSÍ byť slovensky (napr. "Overenie prihlásenia", NIE "Login Verification")
✓ Set automation_status appropriately
✓ Use the suggested test_repository_folder or improve it

✗ NO English in test_name, description, or test_steps
✗ NO vague actions ("verify it works")
✗ NO missing expected results for steps
✗ NO placeholder data ([insert], TODO, TBD)

═══════════════════════════════════════════════════════
OUTPUT FORMAT (TestFlo Compatible)
═══════════════════════════════════════════════════════

Return valid JSON with exactly this structure:

{
  "scenarios": [
    {
      "test_name": "Popisný názov testu v slovenčine",
      "description": "Cieľ: Popis čo test overuje v slovenčine...",
      "test_type": "functional" | "regression" | "smoke",
      "scenario_classification": "happy_path" | "negative" | "edge_case",
      "preconditions": [
        "Podmienka 1 v slovenčine",
        "Podmienka 2 v slovenčine",
        "Test dáta: konkrétne hodnoty"
      ],
      "test_steps": [
        {
          "step_number": 1,
          "action": "Akcia v slovenčine",
          "input": "Vstupné dáta alebo prázdny string",
          "expected_result": "Očakávaný výsledok tohto kroku"
        },
        {
          "step_number": 2,
          "action": "Ďalšia akcia",
          "input": "",
          "expected_result": "Očakávaný výsledok"
        }
      ],
      "priority": "critical" | "high" | "medium" | "low",
      "automation_status": "ready_for_automation" | "automation_not_needed",
      "test_repository_folder": "${scenarioPlan.test_repository_folder}"
    }
  ]
}

VALIDATION CHECKLIST:
☑ Exactly ${scenarioPlan.recommended_count} scenario(s)?
☑ test_name je v slovenčine? (NIE v angličtine!)
☑ Description starts with "Cieľ:"?
☑ Preconditions is an array?
☑ Each test_step has action, input, expected_result?
☑ VŠETKO v slovenčine? (test_name, description, steps)
☑ No placeholders?

IMPORTANT: test_name MUST be in Slovak! Example: "Overenie prihlásenia" NOT "Login Verification"

Generate your test scenarios now:`;


  contextLogger.debug('LLM prompt built', {
    system_message_length: systemMessage.length,
    user_message_length: userMessage.length,
  });

  return {
    systemMessage,
    userMessage,
  };
}
