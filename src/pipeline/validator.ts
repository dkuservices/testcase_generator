import { GeneratedTestScenario, TestStep, ValidationDetail } from '../models/test-scenario';
import { NormalizedInput } from '../models/specification-input';
import { analyzeNewConcepts } from '../utils/text-similarity';
import { createContextLogger } from '../utils/logger';
import { createLlmProvider } from '../llm/provider-factory';
import { ChatMessage } from '../llm/types';

export async function validateScenarios(
  scenarios: GeneratedTestScenario[],
  normalizedInput: NormalizedInput,
  jobId: string
): Promise<GeneratedTestScenario[]> {
  const contextLogger = createContextLogger({
    step: 'validation',
    job_id: jobId,
    parent_jira_issue_id: normalizedInput.metadata.parent_jira_issue_id,
  });

  contextLogger.debug('Starting scenario validation', { scenario_count: scenarios.length });

  const validatedScenarios: GeneratedTestScenario[] = [];

  for (const scenario of scenarios) {
    const validationIssues: string[] = [];

    validateRequiredFields(scenario, validationIssues);

    validateTestStepsClarity(scenario, validationIssues);

    validateNewFunctionality(scenario, normalizedInput, validationIssues);

    validateTraceability(scenario, normalizedInput, validationIssues);

    // Check if auto-correction is needed
    const needsAutoCorrection = Array.isArray(scenario.validation_notes) &&
      scenario.validation_notes.some((note: ValidationDetail) =>
        note.type === 'auto_correction_needed' && note.severity === 'critical'
      );

    if (needsAutoCorrection) {
      contextLogger.info('Attempting auto-correction for scenario with critical issues', {
        test_id: scenario.test_id,
        test_name: scenario.test_name,
      });

      try {
        const correctedScenario = await autoCorrectScenario(scenario, normalizedInput, contextLogger);

        if (correctedScenario) {
          // Re-validate the corrected scenario
          const revalidationIssues: string[] = [];
          validateNewFunctionality(correctedScenario, normalizedInput, revalidationIssues);

          if (revalidationIssues.length === 0) {
            correctedScenario.validation_status = 'validated';
            correctedScenario.validation_notes = 'Automaticky opravené - pôvodne obsahovalo príliš veľa konceptov mimo špecifikácie';

            contextLogger.info('Auto-correction successful', {
              test_id: correctedScenario.test_id,
              test_name: correctedScenario.test_name,
            });

            validatedScenarios.push(correctedScenario);
            continue;
          }
        }
      } catch (error: any) {
        contextLogger.warn('Auto-correction failed', {
          test_id: scenario.test_id,
          error: error.message,
        });
      }
    }

    if (validationIssues.length > 0) {
      scenario.validation_status = 'needs_review';

      // Merge string issues with structured notes
      const issueString = validationIssues.join('; ');
      if (Array.isArray(scenario.validation_notes)) {
        scenario.validation_notes = issueString;
      } else {
        scenario.validation_notes = scenario.validation_notes
          ? `${scenario.validation_notes}; ${issueString}`
          : issueString;
      }

      contextLogger.warn('Scenario failed validation', {
        test_id: scenario.test_id,
        test_name: scenario.test_name,
        issues: validationIssues,
      });
    } else {
      scenario.validation_status = 'validated';

      contextLogger.debug('Scenario passed validation', {
        test_id: scenario.test_id,
        test_name: scenario.test_name,
      });
    }

    validatedScenarios.push(scenario);
  }

  const validatedCount = validatedScenarios.filter(s => s.validation_status === 'validated').length;
  const needsReviewCount = validatedScenarios.filter(s => s.validation_status === 'needs_review').length;

  contextLogger.info('Validation completed', {
    total_scenarios: validatedScenarios.length,
    validated: validatedCount,
    needs_review: needsReviewCount,
  });

  return validatedScenarios;
}

function validateRequiredFields(scenario: GeneratedTestScenario, issues: string[]): void {
  if (!scenario.test_name || scenario.test_name.trim().length === 0) {
    issues.push('Chýba názov testu (test_name)');
  }

  // Validate description (goal)
  if (!scenario.description || scenario.description.trim().length === 0) {
    issues.push('Chýba popis/cieľ testu (description)');
  }

  if (!scenario.test_type || !['functional', 'regression', 'smoke'].includes(scenario.test_type)) {
    issues.push('Neplatný alebo chýbajúci typ testu (test_type)');
  }

  if (!scenario.scenario_classification || !['happy_path', 'negative', 'edge_case'].includes(scenario.scenario_classification)) {
    issues.push('Neplatná alebo chýbajúca klasifikácia scenára (scenario_classification)');
  }

  // Validate preconditions as array
  if (!scenario.preconditions || !Array.isArray(scenario.preconditions) || scenario.preconditions.length === 0) {
    issues.push('Chýbajúce alebo prázdne predpoklady (preconditions)');
  }

  // Validate test_steps as array of TestStep objects
  if (!scenario.test_steps || !Array.isArray(scenario.test_steps) || scenario.test_steps.length === 0) {
    issues.push('Chýbajúce alebo prázdne kroky testu (test_steps)');
  } else {
    // Validate each step has required fields
    for (let i = 0; i < scenario.test_steps.length; i++) {
      const step = scenario.test_steps[i];
      if (!isValidTestStep(step)) {
        issues.push(`Krok ${i + 1}: chýbajú povinné polia (akcia, očakávaný výsledok)`);
      }
    }
  }

  if (!scenario.priority || !['critical', 'high', 'medium', 'low'].includes(scenario.priority)) {
    issues.push('Neplatná alebo chýbajúca priorita');
  }

  // Validate automation_status
  if (!scenario.automation_status || !['ready_for_automation', 'automation_not_needed'].includes(scenario.automation_status)) {
    issues.push('Neplatný alebo chýbajúci stav automatizácie (automation_status)');
  }

  // Validate test_repository_folder
  if (!scenario.test_repository_folder || scenario.test_repository_folder.trim().length === 0) {
    issues.push('Chýba priečinok v repozitári testov (test_repository_folder)');
  }
}

/**
 * Validates that a test step has the required structure
 */
function isValidTestStep(step: any): step is TestStep {
  return (
    step &&
    typeof step === 'object' &&
    typeof step.action === 'string' &&
    step.action.trim().length > 0 &&
    typeof step.expected_result === 'string'
    // Note: input can be empty string, so we don't validate it
  );
}

function validateTestStepsClarity(scenario: GeneratedTestScenario, issues: string[]): void {
  if (!scenario.test_steps || !Array.isArray(scenario.test_steps)) {
    return;
  }

  const fieldNamesSk: Record<string, string> = {
    action: 'akcia',
    input: 'vstup',
    expected_result: 'očakávaný výsledok',
  };

  for (let i = 0; i < scenario.test_steps.length; i++) {
    const step = scenario.test_steps[i];
    const stepNum = step.step_number || i + 1;

    // Validate action field
    if (!step.action || step.action.trim().length < 10) {
      issues.push(`Krok ${stepNum}: akcia je príliš krátka (menej ako 10 znakov)`);
    }

    if (step.action && !containsVerb(step.action)) {
      issues.push(`Krok ${stepNum}: akcia neobsahuje akčné sloveso`);
    }

    // Validate expected_result field
    if (!step.expected_result || step.expected_result.trim().length === 0) {
      issues.push(`Krok ${stepNum}: chýba očakávaný výsledok`);
    }

    // Check for placeholders in action, input, and expected_result
    const placeholderPatterns = ['TODO', 'TBD', '[insert', '...', 'xxx'];
    const fieldsToCheck = [
      { name: 'action', value: step.action || '' },
      { name: 'input', value: step.input || '' },
      { name: 'expected_result', value: step.expected_result || '' },
    ];

    for (const field of fieldsToCheck) {
      for (const pattern of placeholderPatterns) {
        if (field.value.toLowerCase().includes(pattern.toLowerCase())) {
          issues.push(`Krok ${stepNum}: ${fieldNamesSk[field.name]} obsahuje zástupný text: "${pattern}"`);
        }
      }
    }
  }
}

function containsVerb(text: string): boolean {
  // Slovak action verbs for test steps validation
  const commonActionVerbs = [
    // Slovak verbs
    'kliknúť', 'klikni', 'kliknite', 'kliknem', 'klikne', 'kliknutie',
    'zadať', 'zadaj', 'zadajte', 'zadam', 'zadá', 'zadanie',
    'vybrať', 'vyber', 'vyberte', 'vyberiem', 'vyberie', 'výber',
    'otvoriť', 'otvor', 'otvorte', 'otvorím', 'otvorí', 'otvorenie',
    'zatvoriť', 'zatvor', 'zatvorte', 'zatvorím', 'zatvorí', 'zatvorenie',
    'navigovať', 'naviguj', 'navigujte', 'navigujem', 'naviguje', 'navigácia',
    'overiť', 'over', 'overte', 'overím', 'overí', 'overenie',
    'skontrolovať', 'skontroluj', 'skontrolujte', 'skontrolujem', 'skontroluje', 'kontrola',
    'odoslať', 'odošli', 'odošlite', 'odošlem', 'odošle', 'odoslanie',
    'vstup', 'vstúpiť', 'vstúp', 'vstúpte', 'vstúpim', 'vstúpi',
    'vyplniť', 'vyplň', 'vyplňte', 'vyplním', 'vyplní', 'vyplnenie',
    'zvoliť', 'zvoľ', 'zvoľte', 'zvolím', 'zvolí', 'voľba',
    'stlačiť', 'stlač', 'stlačte', 'stlačím', 'stlačí', 'stlačenie',
    'ťuknúť', 'ťukni', 'ťuknite', 'ťuknem', 'ťukne', 'ťuknutie',
    'písať', 'píš', 'píšte', 'píšem', 'píše', 'písanie', 'napísať',
    'zobraziť', 'zobraz', 'zobrazte', 'zobrazím', 'zobrazí', 'zobrazenie',
    'vymazať', 'vymaž', 'vymažte', 'vymažem', 'vymaže', 'vymazanie', 'zmazať',
    'vytvoriť', 'vytvor', 'vytvorte', 'vytvorím', 'vytvorí', 'vytvorenie',
    'aktualizovať', 'aktualizuj', 'aktualizujte', 'aktualizujem', 'aktualizuje', 'aktualizácia',
    'vyhľadať', 'vyhľadaj', 'vyhľadajte', 'vyhľadám', 'vyhľadá', 'vyhľadávanie', 'hľadať',
    'nájsť', 'nájdi', 'nájdite', 'nájdem', 'nájde', 'nájdenie', 'hľadanie',
    'filtrovať', 'filtruj', 'filtrujte', 'filtrujem', 'filtruje', 'filtrovanie',
    'zoradiť', 'zoraď', 'zoraďte', 'zoradím', 'zoradí', 'zoradenie', 'triediť',
    'stiahnuť', 'stiahni', 'stiahnite', 'stiahnem', 'stiahne', 'stiahnutie',
    'nahrať', 'nahraj', 'nahrajte', 'nahrám', 'nahrá', 'nahrávanie', 'nahratie',
    'uložiť', 'ulož', 'uložte', 'uložím', 'uloží', 'uloženie',
    'zrušiť', 'zruš', 'zrušte', 'zruším', 'zruší', 'zrušenie',
    'potvrdiť', 'potvrď', 'potvrďte', 'potvrdím', 'potvrdí', 'potvrdenie',
    'prihlásiť', 'prihlás', 'prihláste', 'prihlásim', 'prihlási', 'prihlásenie',
    'odhlásiť', 'odhlás', 'odhláste', 'odhlásim', 'odhlási', 'odhlásenie',
    'podpísať', 'podpíš', 'podpíšte', 'podpíšem', 'podpíše', 'podpisovanie',
    'validovať', 'validuj', 'validujte', 'validujem', 'validuje', 'validácia',
    'testovať', 'testuj', 'testujte', 'testujem', 'testuje', 'testovanie',
    'zabezpečiť', 'zabezpeč', 'zabezpečte', 'zabezpečím', 'zabezpečí', 'zabezpečenie',
    'čakať', 'čakaj', 'čakajte', 'čakám', 'čaká', 'čakanie', 'počkať',
    'posunúť', 'posuň', 'posuňte', 'posuniem', 'posunie', 'posunutie', 'scrollovať',
    'prejsť', 'prejdi', 'prejdite', 'prejdem', 'prejde', 'prechod',
    'presunúť', 'presuň', 'presuňte', 'presuniem', 'presunie', 'presunutie',
    'pustiť', 'pusti', 'pustite', 'pustím', 'pustí', 'pustenie',
    // Common English verbs kept for backwards compatibility
    'click', 'enter', 'select', 'open', 'close', 'navigate', 'verify', 'check',
    'submit', 'input', 'fill', 'choose', 'press', 'tap', 'type', 'view',
    'delete', 'create', 'update', 'search', 'filter', 'sort', 'download',
    'upload', 'save', 'cancel', 'confirm', 'login', 'logout', 'sign',
    'validate', 'test', 'ensure', 'wait', 'scroll', 'hover', 'drag', 'drop'
  ];

  const lowerText = text.toLowerCase();
  return commonActionVerbs.some(verb => lowerText.includes(verb));
}

function validateNewFunctionality(
  scenario: GeneratedTestScenario,
  normalizedInput: NormalizedInput,
  issues: string[]
): void {
  const sourceText = normalizedInput.normalized_text;
  const problematicSteps: number[] = [];
  let highestRatio = 0;

  // Check each test step individually for new concepts
  scenario.test_steps.forEach((step, index) => {
    const stepText = `${step.action} ${step.input} ${step.expected_result}`;
    const analysis = analyzeNewConcepts(sourceText, stepText, 0.3);

    if (analysis.hasNewConcepts) {
      problematicSteps.push(index + 1); // 1-indexed for user display
      highestRatio = Math.max(highestRatio, analysis.newConceptRatio);
    }
  });

  // If any steps have new concepts, report them
  if (problematicSteps.length > 0) {
    if (problematicSteps.length === 1) {
      issues.push(`Krok ${problematicSteps[0]} zavádza nové koncepty, ktoré sa nenachádzajú v špecifikácii`);
    } else {
      issues.push(`Kroky ${problematicSteps.join(', ')} zavádzajú nové koncepty, ktoré sa nenachádzajú v špecifikácii`);
    }

    // Mark for auto-correction if ratio is very high (>60% new concepts)
    if (highestRatio > 0.6) {
      issues.push(`KRITICKÉ: ${Math.round(highestRatio * 100)}% obsahu je mimo špecifikácie - scenár vyžaduje automatickú opravu`);

      // Add metadata for auto-correction
      if (!Array.isArray(scenario.validation_notes)) {
        scenario.validation_notes = [];
      }

      (scenario.validation_notes as ValidationDetail[]).push({
        type: 'auto_correction_needed',
        severity: 'critical',
        ratio: highestRatio,
        problematic_steps: problematicSteps,
      });
    }
  }
}

/**
 * Attempt to automatically correct a scenario that contains too many new concepts
 * Uses LLM to rewrite test steps using only concepts from the specification
 */
async function autoCorrectScenario(
  scenario: GeneratedTestScenario,
  normalizedInput: NormalizedInput,
  contextLogger: ReturnType<typeof createContextLogger>
): Promise<GeneratedTestScenario | null> {
  try {
    const provider = createLlmProvider();

    const systemMessage = `Si expertný tester ktorý opravuje testovacie scenáre.

TVOJA ÚLOHA: Prepíš kroky testu TAK, ABY POUŽÍVALI LEN KONCEPTY A TERMINOLÓGIU ZO ŠPECIFIKÁCIE.

PRAVIDLÁ:
1. Test musí zostať funkčne identický - testovať to isté
2. Použi LEN slová, termíny a koncepty zo špecifikácie
3. NEPOUŽÍVAJ nové funkcionality, ktoré nie sú v špecifikácii
4. Zachovaj počet krokov
5. Zachovaj štruktúru: akcia, vstup, očakávaný výsledok
6. Všetky kroky musia byť v slovenčine

Vráť opravené kroky v JSON formáte:
{
  "test_steps": [
    {
      "step_number": 1,
      "action": "akcia v slovenčine",
      "input": "vstupné údaje",
      "expected_result": "očakávaný výsledok"
    }
  ]
}`;

    const userMessage = `ŠPECIFIKÁCIA:
---
${normalizedInput.normalized_text}
---

PÔVODNÝ SCENÁR (OBSAHUJE PRÍLIŠ VEĽA NOVÝCH KONCEPTOV):
Názov: ${scenario.test_name}
Cieľ: ${scenario.description}

Pôvodné kroky:
${scenario.test_steps.map((step, idx) => `${idx + 1}. Akcia: ${step.action}
   Vstup: ${step.input}
   Očakávaný výsledok: ${step.expected_result}`).join('\n\n')}

ÚLOHA: Prepíš kroky testu tak, aby používali LEN terminológiu a koncepty zo špecifikácie. Test musí zostať funkčne rovnaký, len musí byť opísaný slovami zo špecifikácie.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ];

    contextLogger.debug('Invoking LLM for auto-correction', {
      test_id: scenario.test_id,
    });

    const response = await provider.generateCompletion(messages, {
      temperature: 0.1, // Very low temperature for precise correction
      maxTokens: 2048,
      responseFormat: 'json',
    });

    if (!response.content) {
      throw new Error('Empty response from LLM');
    }

    const correctedData = JSON.parse(response.content);

    if (!correctedData.test_steps || !Array.isArray(correctedData.test_steps)) {
      throw new Error('Invalid correction response structure');
    }

    // Create corrected scenario
    const correctedScenario: GeneratedTestScenario = {
      ...scenario,
      test_steps: correctedData.test_steps.map((step: any, idx: number) => ({
        step_number: idx + 1,
        action: String(step.action || '').trim(),
        input: String(step.input || '').trim(),
        expected_result: String(step.expected_result || step.expected || '').trim(),
      })),
    };

    // Validate that corrected steps have actual content
    const emptySteps = correctedScenario.test_steps.filter(
      step => !step.action || !step.expected_result
    );

    if (emptySteps.length > 0) {
      throw new Error(
        `Auto-correction returned ${emptySteps.length} steps with missing action or expected_result`
      );
    }

    contextLogger.info('Scenario auto-corrected', {
      test_id: scenario.test_id,
      original_steps: scenario.test_steps.length,
      corrected_steps: correctedScenario.test_steps.length,
    });

    return correctedScenario;

  } catch (error: any) {
    contextLogger.error('Auto-correction failed', {
      test_id: scenario.test_id,
      error: error.message,
    });
    return null;
  }
}

function validateTraceability(
  scenario: GeneratedTestScenario,
  normalizedInput: NormalizedInput,
  issues: string[]
): void {
  if (scenario.parent_jira_issue_id !== normalizedInput.metadata.parent_jira_issue_id) {
    issues.push('ID nadradeného Jira issue sa nezhoduje so vstupnými metadátami');
  }

  if (!scenario.traceability.source_confluence_page_id) {
    issues.push('Chýba ID zdrojovej Confluence stránky v sledovateľnosti');
  }

  if (!scenario.traceability.generated_at) {
    issues.push('Chýba časová pečiatka generovania v sledovateľnosti');
  } else {
    try {
      new Date(scenario.traceability.generated_at);
    } catch {
      issues.push('Neplatná časová pečiatka ISO 8601 v generated_at');
    }
  }
}
