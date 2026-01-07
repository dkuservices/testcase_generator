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
    'this', 'that', 'these', 'those', 'with', 'from', 'have', 'been',
    'will', 'would', 'could', 'should', 'must', 'shall', 'can', 'may',
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can',
    'about', 'also', 'into', 'than', 'them', 'then', 'there', 'when',
    'where', 'which', 'while', 'with', 'your'
  ]);

  const keywords = words.filter(word => !stopWords.has(word));

  const uniqueKeywords = Array.from(new Set(keywords));

  return uniqueKeywords;
}

export function containsNewConcepts(sourceText: string, targetText: string, threshold: number = 0.3): boolean {
  const sourceKeywords = new Set(extractKeywords(sourceText));
  const targetKeywords = extractKeywords(targetText);

  const allowedTestingTerms = new Set([
    'login', 'navigate', 'click', 'enter', 'submit', 'verify', 'check',
    'open', 'close', 'select', 'input', 'output', 'error', 'message',
    'button', 'field', 'form', 'page', 'screen', 'display', 'show',
    'valid', 'invalid', 'success', 'fail', 'test', 'user', 'system'
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

  return newConceptRatio > threshold;
}
