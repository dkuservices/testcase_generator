import { SpecificationInput, NormalizedInput } from '../models/specification-input';
import { stripHTMLTags } from '../utils/html-parser';
import { createContextLogger } from '../utils/logger';

export async function normalizeInput(input: SpecificationInput): Promise<NormalizedInput> {
  const contextLogger = createContextLogger({
    step: 'normalization',
    confluence_page_id: input.confluence_page_id,
    parent_jira_issue_id: input.metadata.parent_jira_issue_id,
  });

  contextLogger.debug('Starting input normalization');

  if (!input.title && !input.description && !input.acceptance_criteria) {
    contextLogger.error('All input fields are empty');
    throw new Error('Cannot normalize empty input - all fields are empty');
  }

  let normalizedTitle = cleanText(input.title);
  let normalizedDescription = cleanText(stripHTMLTags(input.description));
  let normalizedAcceptanceCriteria = cleanText(stripHTMLTags(input.acceptance_criteria));

  if (!normalizedAcceptanceCriteria && normalizedDescription) {
    contextLogger.warn('Empty acceptance criteria, using description as primary source');
    normalizedAcceptanceCriteria = normalizedDescription;
    normalizedDescription = '';
  }

  const textParts: string[] = [];

  if (normalizedTitle) {
    textParts.push(`Feature: ${normalizedTitle}`);
  }

  if (normalizedDescription) {
    textParts.push(`Description: ${normalizedDescription}`);
  }

  if (normalizedAcceptanceCriteria) {
    textParts.push(`Acceptance Criteria: ${normalizedAcceptanceCriteria}`);
  }

  let normalizedText = textParts.join('\n\n');

  normalizedText = removeDuplicateSentences(normalizedText);

  const normalizedInput: NormalizedInput = {
    normalized_text: normalizedText,
    metadata: input.metadata,
    original_input: input,
  };

  contextLogger.debug('Input normalization completed', {
    original_length: input.title.length + input.description.length + input.acceptance_criteria.length,
    normalized_length: normalizedText.length,
  });

  return normalizedInput;
}

function cleanText(text: string): string {
  if (!text) {
    return '';
  }

  let cleaned = text.replace(/\s+/g, ' ').trim();

  cleaned = cleaned.replace(/^(Description:|Acceptance Criteria:|Title:|Feature:)\s*/i, '');

  return cleaned;
}

function removeDuplicateSentences(text: string): string {
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);

  const uniqueSentences: string[] = [];
  const seen = new Set<string>();

  for (const sentence of sentences) {
    const normalized = sentence.toLowerCase().replace(/\s+/g, ' ');

    if (!seen.has(normalized)) {
      seen.add(normalized);
      uniqueSentences.push(sentence);
    }
  }

  return uniqueSentences.join('. ') + (uniqueSentences.length > 0 ? '.' : '');
}
