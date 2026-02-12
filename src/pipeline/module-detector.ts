/**
 * Module Detector
 * Uses LLM to automatically detect modules/milestones from document content
 */

import { DocumentPage, ChangeRequest, DocumentSection } from '../models/word-document';
import { createLlmProvider } from '../llm/provider-factory';
import { ChatMessage } from '../llm/types';
import { OllamaProvider } from '../llm/providers/ollama-provider';
import { ClaudeProvider } from '../llm/providers/claude-provider';
import { createContextLogger } from '../utils/logger';
import { generateTestId } from '../utils/uuid-generator';
import { flattenSections } from './word-parser';

interface PageDetectionResult {
  modules: DocumentPage[];
  success: boolean;
  error?: string;
}

/**
 * Detect modules and change requests from document sections using LLM
 */
export async function detectModules(
  sections: DocumentSection[],
  rawText: string,
  documentId: string
): Promise<PageDetectionResult> {
  const contextLogger = createContextLogger({
    step: 'module_detection',
    document_id: documentId,
  });

  contextLogger.info('Starting module detection', {
    sections_count: sections.length,
    text_length: rawText.length,
  });

  try {
    const provider = createLlmProvider();
    const profile = provider instanceof OllamaProvider
      ? provider.getPrimaryProfile()
      : provider instanceof ClaudeProvider
      ? provider.getPrimaryProfile()
      : {
          name: 'primary',
          model: 'gpt-4-turbo',
          temperature: 0.2,
          maxTokens: 4096
        };

    const formattedContent = flattenSections(sections);

    // Detect if this is a change request document (Evidenčný list)
    const isChangeRequestDoc =
      formattedContent.toLowerCase().includes('evidenčný list') ||
      formattedContent.toLowerCase().includes('evidencny list') ||
      /\b(TE|CR)[-_\s]*\d+/i.test(formattedContent) ||
      formattedContent.toLowerCase().includes('poradové číslo');

    const prompt = buildModuleDetectionPrompt(formattedContent, isChangeRequestDoc);

    // For large documents, increase maxTokens to ensure complete response
    const adjustedMaxTokens = Math.max(profile.maxTokens || 4096, 8192);

    const messages: ChatMessage[] = [
      { role: 'system', content: prompt.systemMessage },
      { role: 'user', content: prompt.userMessage }
    ];

    contextLogger.debug('Invoking LLM for module detection', {
      provider: provider.name,
      model: profile.model,
      content_length: formattedContent.length,
      max_tokens: adjustedMaxTokens,
    });

    const response = await provider.generateCompletion(messages, {
      model: profile.model,
      temperature: profile.temperature,
      maxTokens: adjustedMaxTokens,
      responseFormat: 'json'
    });

    if (!response.content) {
      throw new Error('Empty response from LLM');
    }

    let parsedResponse: any;
    try {
      parsedResponse = JSON.parse(response.content);

      // Debug logging: Log the full parsed response structure
      contextLogger.debug('LLM response parsed successfully', {
        response_keys: Object.keys(parsedResponse),
        response_structure: JSON.stringify(parsedResponse).substring(0, 1000),
      });
    } catch (error) {
      contextLogger.error('Failed to parse LLM JSON response', {
        error: (error as Error).message,
        raw_content: response.content.substring(0, 1000),
      });
      throw new Error('Invalid JSON response from LLM');
    }

    const rawModules = extractModulesFromResponse(parsedResponse);

    // Debug logging: Log extraction results
    contextLogger.debug('Modules extracted from response', {
      raw_modules_count: rawModules.length,
      raw_modules_sample: rawModules.length > 0 ? JSON.stringify(rawModules[0]).substring(0, 500) : 'empty',
    });

    // Check if raw modules have change requests before normalization
    if (rawModules.length > 0) {
      const rawModulesWithEmptyCRs = rawModules.filter(m => {
        const crs = m.change_requests || m.changeRequests || m.changes || m.requirements || [];
        return !Array.isArray(crs) || crs.length === 0;
      });

      if (rawModulesWithEmptyCRs.length > 0) {
        contextLogger.warn('LLM returned modules with empty change requests', {
          modules_with_empty_crs: rawModulesWithEmptyCRs.length,
          total_modules: rawModules.length,
          sample_module_keys: rawModules[0] ? Object.keys(rawModules[0]) : [],
          sample_module_data: rawModules[0] ? JSON.stringify(rawModules[0]).substring(0, 800) : 'empty',
        });
      }
    }

    const modules = normalizeDocumentPages(rawModules);

    // Debug logging: Log normalization results
    const emptyChangeRequestsCount = modules.filter(m => m.change_requests.length === 0).length;
    const emptyDescriptionsCount = modules.filter(m => !m.description || m.description.length === 0).length;
    const filteredOutCount = rawModules.length - modules.length;

    // Detect if fallback was used (modules that had empty CRs in raw but have CRs after normalization)
    const fallbackUsedCount = rawModules.filter((raw, idx) => {
      const rawCRs = raw.change_requests || raw.changeRequests || raw.changes || raw.requirements || [];
      const normalizedModule = modules[idx];
      return (!Array.isArray(rawCRs) || rawCRs.length === 0) && normalizedModule && normalizedModule.change_requests.length > 0;
    }).length;

    if (fallbackUsedCount > 0) {
      contextLogger.info('Fallback change_request creation was used', {
        modules_with_fallback_crs: fallbackUsedCount,
        hint: 'LLM returned empty change_requests, fallback created from module description',
      });
    }

    contextLogger.info('Module detection completed', {
      raw_modules_count: rawModules.length,
      pages_count: modules.length,
      filtered_out: filteredOutCount,
      total_change_requests: modules.reduce((sum, m) => sum + m.change_requests.length, 0),
      pages_with_empty_change_requests: emptyChangeRequestsCount,
      pages_with_empty_descriptions: emptyDescriptionsCount,
      fallback_crs_created: fallbackUsedCount,
    });

    // Log warning if modules were filtered out
    if (filteredOutCount > 0) {
      contextLogger.warn('Some modules were filtered out during normalization', {
        filtered_out_count: filteredOutCount,
        reason: 'Modules had no meaningful name, no description, and no change requests',
        hint: 'LLM may not be extracting content properly from this document format',
      });
    }

    // Log warning if all modules have empty change requests
    if (modules.length > 0 && emptyChangeRequestsCount === modules.length) {
      contextLogger.warn('ALL modules have empty change requests - LLM may not be extracting requirements properly', {
        document_content_length: formattedContent.length,
        modules_detected: modules.length,
        hint: 'Check if document format is incompatible or LLM prompt needs adjustment',
      });
    }

    // Critical: If no valid modules remain after filtering
    if (rawModules.length > 0 && modules.length === 0) {
      contextLogger.error('All detected modules were filtered out - no valid content extracted', {
        raw_modules_count: rawModules.length,
        document_content_length: formattedContent.length,
      });
    }

    return {
      modules,
      success: true,
    };

  } catch (error: any) {
    contextLogger.error('Module detection failed', {
      error: error.message,
    });

    return {
      modules: [],
      success: false,
      error: error.message,
    };
  }
}

function buildModuleDetectionPrompt(content: string, isChangeRequestDoc: boolean = false): { systemMessage: string; userMessage: string } {
  // Simplified prompt for change request documents
  if (isChangeRequestDoc) {
    const systemMessage = `Si expertný analytik zmenových požiadaviek.

TENTO DOKUMENT JE EVIDENČNÝ LIST ZMENY - vytvor PRESNE 1 MODUL.

Tvoja úloha:
1. Nájdi "Názov požiadavky" alebo "Popis požiadavky" → to je NÁZOV MODULU
2. Nájdi popis zmeny → to je DESCRIPTION change_requestu
3. Nájdi "Zmena sa dotkne:" alebo "Dopad na:" alebo "Ovplyvnené oblasti:" → to je AFFECTED_AREAS (nie samostatné moduly!)
4. Vytvor JEDEN modul s JEDNOU change_request

Odpovedz VÝHRADNE platným JSON vo formáte:
{
  "modules": [
    {
      "name": "Názov zmeny z dokumentu",
      "description": "Popis zmeny",
      "priority": "medium",
      "change_requests": [
        {
          "title": "Implementácia zmeny [názov]",
          "description": "Detailný popis čo sa má zmeniť",
          "acceptance_criteria": ["Kritérium 1", "Kritérium 2"],
          "affected_areas": ["databáza", "backend", "frontend"]
        }
      ]
    }
  ]
}`;

    const userMessage = `Analyzuj tento EVIDENČNÝ LIST ZMENY a vytvor JEDEN modul s JEDNOU change_request.

⚠️ POZOR: Sekcia "Zmena sa dotkne:" obsahuje AFFECTED AREAS, nie samostatné moduly!

---
${content}
---

Vráť JSON s JEDNÝM modulom.`;

    return { systemMessage, userMessage };
  }

  // Original prompt for system documents
  const systemMessage = `Si expertný analytik softvérových požiadaviek a špecifikácií.

Tvoja úloha je analyzovať dokument a identifikovať:

1. **Moduly/Míľniky/Kapitoly** - logické celky, oblasti funkcionalít alebo fázy projektu
2. **Požiadavky na testovanie** - konkrétne zmeny, funkcionality, požiadavky alebo technické špecifikácie v rámci každého modulu

TYPY DOKUMENTOV, KTORÉ DOKÁŽEŠ SPRACOVAŤ:
- Zmenové požiadavky (change requests)
- Technické špecifikácie
- Funkčné požiadavky
- Požiadavky na systém (system requirements)
- Architektúrne dokumenty
- Feature description dokumenty

KRITICKÉ ROZLÍŠENIE:
1. **ZMENOVÝ DOKUMENT** (vytvor 1 modul s 1+ change_requests):
   - Názov obsahuje: "Evidenčný list", "Požiadavka na zmenu", "TE_XX", "CR-XXX"
   - Popisuje JEDNU KONKRÉTNU ZMENU
   - Má sekciu "Zmena sa dotkne:", "Dopad na:", "Ovplyvnené oblasti:" → to sú AFFECTED AREAS jednej zmeny, NIE samostatné moduly!
   - PRÍKLAD: "TE_41: Zvýšenie počtu znakov" → 1 modul s názvom zmeny, 1 change_request s affected_areas

2. **SYSTÉMOVÝ DOKUMENT** (vytvor viacero modulov):
   - Popisuje celý systém s viacerými funkciami
   - Každá funkcia je samostatný modul

Pre každý modul určíš:
- **Názov modulu** - ABSOLÚTNE KRITICKÉ: Názov MUSÍ presne vystihnúť obsah modulu. Názov musí byť unikátny a opisný.

  ✅ SPRÁVNE príklady (použiť len ako inšpiráciu, nie kopírovať):
  - "Správa používateľských účtov a oprávnení"
  - "Integrácia platobnej brány PayPal"
  - "Reportovací modul pre finančný manažment"
  - "Vizualizácia haš hodnôt v tabuľke"
  - "Funkcia hromadného importu dát"
  - "Transformácia metrík medzi triedami"
  - "Autentifikácia a autorizácia používateľov"

  ❌ NESPRÁVNE príklady (NIKDY nepoužívať):
  - "Modul 1", "Modul 2", "Modul 3"
  - "M1", "M2", "M-01"
  - "Zmeny", "Úpravy", "Nová funkcionalita"
  - "Fáza 1", "Milestone 1"
  - "Všeobecné zmeny"
  - "Dokument XY"
  - "Kapitola 1", "Chapter 1"

  PRAVIDLÁ PRE NÁZOV:
  - Musí obsahovať konkrétnu funkcionalitu alebo oblasť (nie len "modul")
  - Musí byť v slovenčine
  - Musí byť zrozumiteľný aj pre netechnických čitateľov
  - Musí byť unikátny - každý modul má iný názov
  - Ak si neistý, odvoď názov z hlavnej funkcionality v module

- **Popis modulu** - POVINNÝ. Stručný popis (1-3 vety) vysvetľujúci účel a rozsah modulu
- **Prioritu** (critical, high, medium, low)
- **Zoznam požiadaviek** (change_requests) - AJ KEĎ DOKUMENT NEOBSAHUJE EXPLICITNÉ "ZMENY"

Pre každú požiadavku/funkcionalitu určíš:
- **Názov/Titulok** - Jasný a konkrétny názov (nie "Zmena 1", ale napr. "Validácia vstupných dát", "Výpočet agregovaných metrik")
- **Detailný popis** - Čo presne sa má implementovať/testovať. Aj keď dokument nehovorí o "zmenách", opíš funkcionalitu alebo požiadavku.
- **Akceptačné kritériá** - Ak sú uvedené, použi ich. Ak nie, odvoď logické kritériá z popisu (napr. "Systém musí správne transformovať metriky", "Údaje musia byť validované pred uložením")
- **Ovplyvnené oblasti** - Komponenty, moduly alebo časti systému, ktoré sú ovplyvnené

DÔLEŽITÉ PRAVIDLÁ:
- Identifikuj VŠETKY funkcionality, požiadavky alebo zmeny v dokumente
- Každá podstatná funkcionalita musí byť zachytená ako samostatná požiadavka
- Ak dokument nemá explicitné moduly/kapitoly, vytvor logické skupiny podľa funkčnej oblasti
- NIKDY nepoužívaj generické názvy ako "Modul 1", "Zmeny", "Funkcionalita"
- Buď dôkladný - žiadna funkcionalita nesmie byť vynechaná
- Popis modulu je POVINNÝ - vždy vysvetli, čo modul rieši
- Ak dokument je technická špecifikácia bez explicitných "zmien", stále identifikuj funkcionality na testovanie
- Každý modul MUSÍ mať aspoň jednu požiadavku (change_request) - aj keď to nie je "zmena" ale požiadavka/funkcionalita

FLEXIBILNÁ INTERPRETÁCIA:
- "Change request" = zmenová požiadavka, funkcionalita, požiadavka, feature, špecifikácia
- Aj technické dokumenty bez explicitných "zmien" obsahujú funkcionality na testovanie
- Aj keď dokument opisuje len "ako to funguje", stále identifikuj testovateľné aspekty

Odpovedz VÝHRADNE platným JSON vo formáte:
{
  "modules": [
    {
      "name": "Výstižný názov modulu",
      "description": "Stručný popis účelu a rozsahu modulu.",
      "priority": "high",
      "change_requests": [
        {
          "title": "Konkrétny názov požiadavky/funkcionality",
          "description": "Detailný popis požiadavky alebo funkcionality",
          "acceptance_criteria": ["Kritérium 1", "Kritérium 2"],
          "affected_areas": ["Oblast 1", "Oblast 2"]
        }
      ]
    }
  ]
}`;

  const userMessage = `Analyzuj nasledujúci dokument a identifikuj všetky moduly a testovateľné požiadavky/funkcionality.

DÔLEŽITÉ ROZLÍŠENIE:

Ak dokument obsahuje:
- "Evidenčný list požiadavky na zmenu"
- Poradové číslo (TE_XX, CR-XXX)
- Sekciu "Názov požiadavky"
- Sekciu "Zmena sa dotkne" alebo "Dopad na"

→ Toto je ZMENOVÝ DOKUMENT. Vytvor PRESNE 1 MODUL:

PRÍKLAD SPRÁVNEJ ODPOVEDE PRE ZMENOVÝ DOKUMENT:
{
  "modules": [
    {
      "name": "[Názov požiadavky z dokumentu]",
      "description": "[Popis z dokumentu]",
      "priority": "medium",
      "change_requests": [
        {
          "title": "Implementácia zmeny [názov]",
          "description": "[Celý popis zmeny z dokumentu]",
          "acceptance_criteria": ["[Kritérium 1]", "[Kritérium 2]"],
          "affected_areas": ["[Oblasti z 'Zmena sa dotkne']"]
        }
      ]
    }
  ]
}

POZOR: "Zmena sa dotkne: databáza, backend, frontend" → to ide do AFFECTED_AREAS, NIE ako samostatné moduly!

---
${content}
---

Vráť kompletný zoznam modulov a ich požiadaviek v JSON formáte. Každý modul MUSÍ mať aspoň jednu požiadavku (change_request).`;

  return { systemMessage, userMessage };
}

function extractModulesFromResponse(parsedResponse: any): any[] {
  if (Array.isArray(parsedResponse)) {
    return parsedResponse;
  }

  if (!parsedResponse || typeof parsedResponse !== 'object') {
    return [];
  }

  const candidate = parsedResponse as Record<string, any>;

  // Check if we have a top-level "modules" array (expected structure)
  const direct = candidate.modules || candidate.milestones || candidate.data || candidate.items;

  if (Array.isArray(direct)) {
    return direct;
  }

  // SPECIAL CASE: LLM returned a single module object without wrapping it in "modules" array
  // Check if the object looks like a module (has module_name/name AND change_requests)
  const hasModuleName = Boolean(candidate.module_name || candidate.name || candidate.title);
  const hasChangeRequests = Array.isArray(candidate.change_requests || candidate.changeRequests || candidate.changes || candidate.requirements);

  if (hasModuleName && hasChangeRequests) {
    // Normalize the field names to match what normalizeDocumentPages expects
    const normalizedModule = {
      name: candidate.module_name || candidate.name || candidate.title,
      description: candidate.module_description || candidate.description || '',
      priority: candidate.priority || 'medium',
      change_requests: candidate.change_requests || candidate.changeRequests || candidate.changes || candidate.requirements || [],
    };

    // Wrap the single module in an array
    return [normalizedModule];
  }

  // Fallback: look for any array (keep existing behavior for backwards compatibility)
  for (const value of Object.values(candidate)) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function normalizeDocumentPages(rawModules: any[]): DocumentPage[] {
  return rawModules.map((raw, _index) => {
    const moduleId = generateTestId();
    const pageId = generateTestId();

    // Normalize priority
    const priorityRaw = String(raw.priority ?? '').toLowerCase();
    const priority = priorityRaw === 'critical' || priorityRaw === 'p1' ? 'critical'
      : priorityRaw === 'high' || priorityRaw === 'p2' ? 'high'
      : priorityRaw === 'low' || priorityRaw === 'p4' ? 'low'
      : 'medium';

    // Normalize change requests
    const rawChangeRequests = raw.change_requests || raw.changeRequests || raw.changes || raw.requirements || [];
    let changeRequests: ChangeRequest[] = rawChangeRequests.map((cr: any) => {
      return {
        id: generateTestId(),
        title: String(cr.title ?? cr.change_title ?? cr.requirement_name ?? cr.name ?? '').trim(),
        description: String(cr.description ?? cr.change_description ?? cr.detail ?? '').trim(),
        acceptance_criteria: normalizeStringArray(cr.acceptance_criteria ?? cr.acceptanceCriteria ?? cr.criteria ?? []),
        affected_areas: normalizeStringArray(cr.affected_areas ?? cr.affectedAreas ?? cr.areas ?? cr.impacted_areas ?? []),
      };
    }).filter((cr: ChangeRequest) => cr.title.length > 0);

    // FALLBACK: If LLM returned empty change_requests but module has name and description,
    // create a change_request from the module's own data
    const rawName = String(raw.name ?? raw.title ?? '').trim();
    const rawDescription = String(raw.description ?? '').trim();

    if (changeRequests.length === 0 && rawName && rawDescription && rawDescription.length > 20) {
      // Create fallback change_request from module info
      changeRequests = [{
        id: generateTestId(),
        title: `Implementácia: ${rawName}`,
        description: rawDescription,
        acceptance_criteria: extractAcceptanceCriteriaFromDescription(rawDescription),
        affected_areas: normalizeStringArray(raw.affected_areas ?? raw.affectedAreas ?? raw.areas ?? []),
      }];
    }

    // Get raw name
    let name = String(raw.name ?? raw.title ?? '').trim();

    // Check for generic/bad names and try to improve them
    // Expanded patterns to catch more generic names
    const genericNamePatterns = /^(modul\s*\d*|m\d+|m-\d+|zmeny?|úpravy?|funkcionalita|fáza\s*\d*|milestone\s*\d*|phase\s*\d*|všeobecné?|dokument|kapitola\s*\d*|chapter\s*\d*)$/i;
    const hasGenericName = !name || genericNamePatterns.test(name) || /^[Mm]odul\s+\d+/.test(name);

    if (hasGenericName) {
      // Intelligent name derivation strategy

      // Strategy 1: Use first change request title if descriptive
      if (changeRequests.length > 0 && changeRequests[0].title && changeRequests[0].title.length > 10) {
        name = changeRequests[0].title;
      }
      // Strategy 2: Combine multiple change request titles if they're related
      else if (changeRequests.length > 1) {
        const titles = changeRequests.slice(0, 2).map(cr => cr.title).filter(t => t.length > 5);
        if (titles.length > 0) {
          name = titles.join(' a ');
        }
      }
      // Strategy 3: Extract from description
      else if (raw.description && raw.description.length > 20) {
        // Take first meaningful sentence from description
        const desc = String(raw.description).trim();
        const firstSentence = desc.split(/[.!?]/)[0];
        if (firstSentence && firstSentence.length > 10 && firstSentence.length < 100) {
          name = firstSentence.trim();
        }
      }

      // Fallback: Mark as invalid - will be filtered out
      if (!name || genericNamePatterns.test(name)) {
        // Don't create a module if we can't derive a meaningful name
        // This indicates the module has no useful content
        return null;
      }
    }

    // Get description, generate fallback if empty
    let description = String(raw.description ?? '').trim();
    if (!description && changeRequests.length > 0) {
      // Generate description from change requests
      const crTitles = changeRequests.slice(0, 3).map(cr => cr.title).join(', ');
      description = `Obsahuje zmenove poziadavky: ${crTitles}${changeRequests.length > 3 ? ` a ${changeRequests.length - 3} dalsich` : ''}`;
    }

    // If module has no name, no description, and no change requests, it's useless
    if (!name || (description.length === 0 && changeRequests.length === 0)) {
      return null;
    }

    return {
      module_id: moduleId,
      page_id: pageId,
      name,
      description,
      change_requests: changeRequests,
      priority: priority as DocumentPage['priority'],
    };
  })
  .filter((module: DocumentPage | null): module is DocumentPage => module !== null)
  .filter((module: DocumentPage) => module.name.length > 0);
}

function normalizeStringArray(input: any): string[] {
  if (Array.isArray(input)) {
    return input.map(item => String(item).trim()).filter(Boolean);
  }
  if (typeof input === 'string' && input.trim()) {
    return input.split(/[\n\r]+|[;,]/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Extract acceptance criteria from description text
 * Looks for numbered lists, bullet points, or sentences starting with "musí", "má", etc.
 */
function extractAcceptanceCriteriaFromDescription(description: string): string[] {
  const criteria: string[] = [];

  // Split into sentences/lines
  const lines = description.split(/[\n\r]+|(?<=[.!?])\s+/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 10) continue;

    // Look for numbered items (1., 2., etc.) or bullet points (-, *, •)
    const isNumbered = /^\d+[.)]\s*/.test(trimmed);
    const isBullet = /^[-*•]\s*/.test(trimmed);

    // Look for requirement keywords
    const hasRequirementKeyword = /\b(musí|má|musia|majú|bude|budú|treba|potrebné|vyžaduje|umožní|zabezpečí|podporuje|validuje)\b/i.test(trimmed);

    if (isNumbered || isBullet || hasRequirementKeyword) {
      // Clean up the line
      const cleaned = trimmed
        .replace(/^\d+[.)]\s*/, '')
        .replace(/^[-*•]\s*/, '')
        .trim();

      if (cleaned.length > 10 && cleaned.length < 300) {
        criteria.push(cleaned);
      }
    }
  }

  // If no criteria found, create generic ones from the description
  if (criteria.length === 0) {
    // Extract key action from description
    const firstSentence = description.split(/[.!?]/)[0]?.trim();
    if (firstSentence && firstSentence.length > 15) {
      criteria.push(`Zmena je implementovaná podľa špecifikácie`);
      criteria.push(`Existujúca funkcionalita zostáva neovplyvnená`);
      criteria.push(`Zmena je otestovaná na všetkých ovplyvnených oblastiach`);
    }
  }

  // Limit to max 5 criteria
  return criteria.slice(0, 5);
}
