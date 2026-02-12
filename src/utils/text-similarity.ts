import stringSimilarity from 'string-similarity';

export function calculateSimilarity(str1: string, str2: string): number {
  return stringSimilarity.compareTwoStrings(str1.toLowerCase(), str2.toLowerCase());
}

export function findBestMatch(mainString: string, targetStrings: string[]): {
  bestMatch: string;
  bestMatchIndex: number;
  rating: number;
} {
  const result = stringSimilarity.findBestMatch(mainString.toLowerCase(), targetStrings.map(s => s.toLowerCase()));
  return {
    bestMatch: targetStrings[result.bestMatchIndex],
    bestMatchIndex: result.bestMatchIndex,
    rating: result.bestMatch.rating,
  };
}

export function extractKeywords(text: string): string[] {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3);

  const stopWords = new Set([
    // English stop words
    'this', 'that', 'these', 'those', 'with', 'from', 'have', 'been',
    'will', 'would', 'could', 'should', 'must', 'shall', 'can', 'may',
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can',
    'about', 'also', 'into', 'than', 'them', 'then', 'there', 'when',
    'where', 'which', 'while', 'with', 'your',
    // Slovak stop words
    'tento', 'táto', 'toto', 'tieto', 'tých', 'toho', 'tejto',
    'bude', 'budú', 'budeme', 'môže', 'môžu', 'musí', 'musia',
    'alebo', 'ale', 'nie', 'všetky', 'každý', 'každá', 'každé',
    'pre', 'pri', 'pod', 'nad', 'pred', 'medzi',
    'ktorý', 'ktorá', 'ktoré', 'ktorí', 'ktorých',
    'jeho', 'jej', 'ich', 'naša', 'naše', 'váš', 'vaša', 'vaše'
  ]);

  const keywords = words.filter(word => !stopWords.has(word));

  const uniqueKeywords = Array.from(new Set(keywords));

  return uniqueKeywords;
}

export interface NewConceptsAnalysis {
  hasNewConcepts: boolean;
  newConceptRatio: number;
  newKeywords: string[];
  totalKeywords: number;
}

/**
 * Analyze text for new concepts not in source
 * Returns detailed analysis including which keywords are new
 */
export function analyzeNewConcepts(sourceText: string, targetText: string, threshold: number = 0.3): NewConceptsAnalysis {
  const sourceKeywords = new Set(extractKeywords(sourceText));
  const targetKeywords = extractKeywords(targetText);

  const allowedTestingTerms = new Set([
    // English testing terms
    'login', 'navigate', 'click', 'enter', 'submit', 'verify', 'check',
    'open', 'close', 'select', 'input', 'output', 'error', 'message',
    'button', 'field', 'form', 'page', 'screen', 'display', 'show',
    'valid', 'invalid', 'success', 'fail', 'test', 'user', 'system',

    // Slovak testing terms - verbs
    'kliknúť', 'klikni', 'kliknite', 'kliknem', 'klikne', 'kliknutie',
    'zadať', 'zadaj', 'zadajte', 'zadam', 'zadá', 'zadanie',
    'vybrať', 'vyber', 'vyberte', 'vyberiem', 'vyberie', 'výber',
    'otvoriť', 'otvor', 'otvorte', 'otvorím', 'otvorí', 'otvorenie',
    'zatvoriť', 'zatvor', 'zatvorte', 'zatvorím', 'zatvorí', 'zatvorenie',
    'navigovať', 'naviguj', 'navigujte', 'navigujem', 'naviguje', 'navigácia',
    'overiť', 'over', 'overte', 'overím', 'overí', 'overenie',
    'skontrolovať', 'skontroluj', 'skontrolujte', 'skontrolujem', 'skontroluje', 'kontrola',
    'odoslať', 'odošli', 'odošlite', 'odošlem', 'odošle', 'odoslanie',
    'vstúpiť', 'vstúp', 'vstúpte', 'vstúpim', 'vstúpi', 'vstup',
    'vyplniť', 'vyplň', 'vyplňte', 'vyplním', 'vyplní', 'vyplnenie',
    'zvoliť', 'zvoľ', 'zvoľte', 'zvolím', 'zvolí', 'voľba',
    'stlačiť', 'stlač', 'stlačte', 'stlačím', 'stlačí', 'stlačenie',
    'ťuknúť', 'ťukni', 'ťuknite', 'ťuknem', 'ťukne', 'ťuknutie',
    'písať', 'píš', 'píšte', 'píšem', 'píše', 'písanie', 'napísať',
    'zobraziť', 'zobraz', 'zobrazte', 'zobrazím', 'zobrazí', 'zobrazenie',
    'vymazať', 'vymaž', 'vymažte', 'vymažem', 'vymaže', 'vymazanie', 'zmazať',
    'vytvoriť', 'vytvor', 'vytvorte', 'vytvorím', 'vytvorí', 'vytvorenie',
    'aktualizovať', 'aktualizuj', 'aktualizujte', 'aktualizujem', 'aktualizuje', 'aktualizácia',
    'potvrdiť', 'potvrď', 'potvrďte', 'potvrdím', 'potvrdí', 'potvrdenie',
    'zrušiť', 'zruš', 'zrušte', 'zrušim', 'zruší', 'zrušenie',
    'uložiť', 'ulož', 'uložte', 'uložím', 'uloží', 'uloženie',
    'načítať', 'načítaj', 'načítajte', 'načítam', 'načíta', 'načítanie',
    'hľadať', 'hľadaj', 'hľadajte', 'hľadám', 'hľadá', 'hľadanie', 'vyhľadať', 'vyhľadaj', 'vyhľadávanie',
    'nájsť', 'nájdi', 'nájdite', 'nájdem', 'nájde', 'nájdenie',
    'kontrolovať', 'kontroluj',
    'prejsť', 'prejdi', 'prejdite', 'prejdem', 'prejde', 'prechod',
    'spustiť', 'spusti', 'spustite', 'spustím', 'spustí', 'spustenie',
    'prihlásiť', 'prihlás', 'prihláste', 'prihlásim', 'prihlási', 'prihlásenie',
    'odhlásiť', 'odhlás', 'odhláste', 'odhlásim', 'odhlási', 'odhlásenie',

    // Slovak testing terms - nouns
    'tlačidlo', 'tlačítko',
    'pole', 'políčko',
    'formulár',
    'stránka', 'obrazovka',
    'zobrazenie',
    'chyba', 'chybové', 'chybový',
    'hlásenie', 'hlásenia',
    'používateľ', 'užívateľ',
    'systém',
    'tabuľka', 'zoznam',
    'hodnota', 'údaj', 'data',
    'záznam', 'položka',
    'ponuka',
    'okno', 'dialóg',
    'heslo',
    'meno', 'názov',
    'krok',
    'testovací', 'testovacie',
    'validácia',
    'tooltip', 'nápoveda',
    // Domain-specific terms (banking, admin)
    'portál', 'interný', 'externý', 'zberový',
    'správa', 'administrácia', 'správcovia', 'administrátori',
    'číselník', 'číselníky', 'číselníka', 'číselníkov',
    'prvok', 'prvku', 'prvkov', 'prvky',
    'hierarchia', 'hierarchie', 'hierarchií',
    'zoskupenie', 'zoskupenia', 'zoskupení',
    'alias', 'aliasy', 'aliasov',
    'backend', 'frontend', 'databáza', 'databázy',
    'import', 'export', 'docimp',
    'výkaz', 'výkazy', 'výkazov',
    'modul', 'modulu', 'modulov', 'moduly'
  ]);

  const newKeywords = targetKeywords.filter(keyword => {
    if (allowedTestingTerms.has(keyword)) {
      return false;
    }

    if (sourceKeywords.has(keyword)) {
      return false;
    }

    for (const sourceKeyword of sourceKeywords) {
      if (calculateSimilarity(keyword, sourceKeyword) > 0.8) {
        return false;
      }
    }

    return true;
  });

  const newConceptRatio = newKeywords.length / Math.max(targetKeywords.length, 1);

  return {
    hasNewConcepts: newConceptRatio > threshold,
    newConceptRatio,
    newKeywords,
    totalKeywords: targetKeywords.length,
  };
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use analyzeNewConcepts instead
 */
export function containsNewConcepts(sourceText: string, targetText: string, threshold: number = 0.3): boolean {
  return analyzeNewConcepts(sourceText, targetText, threshold).hasNewConcepts;
}
