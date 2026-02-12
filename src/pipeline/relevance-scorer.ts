/**
 * Relevance Scorer
 * Scores document chunks against change requests for relevance
 */

import { DocumentChunk } from '../utils/document-chunker';
import { ChangeRequest } from '../models/word-document';
import { calculateSimilarity, extractKeywords } from '../utils/text-similarity';
import { getAllChunks } from '../storage/chunk-store';
import chunkingConfig from '../../config/chunking.json';
import logger from '../utils/logger';

export interface RelevanceScore {
  chunk_id: string;
  score: number;           // 0.0 - 1.0
  matched_keywords: string[];
  heading_match_score: number;
  content_match_score: number;
}

export interface ScoredChunk extends DocumentChunk {
  relevance_score: RelevanceScore;
}

/**
 * Score a single chunk against a change request
 */
export function scoreChunkRelevance(
  chunk: DocumentChunk,
  changeRequest: ChangeRequest
): RelevanceScore {
  // Extract keywords from change request
  const crText = [
    changeRequest.title,
    changeRequest.description,
    ...changeRequest.acceptance_criteria,
    ...changeRequest.affected_areas,
  ].join(' ');

  const crKeywords = extractKeywords(crText);

  // Calculate heading match score
  const headingKeywords = extractKeywords(chunk.heading);
  const headingMatchCount = headingKeywords.filter(kw =>
    crKeywords.some(crKw => calculateSimilarity(kw, crKw) > 0.7)
  ).length;
  const headingMatchScore = headingKeywords.length > 0
    ? headingMatchCount / headingKeywords.length
    : 0;

  // Calculate content keyword overlap
  const matchedKeywords: string[] = [];
  for (const chunkKw of chunk.keywords) {
    for (const crKw of crKeywords) {
      if (calculateSimilarity(chunkKw, crKw) > 0.7) {
        matchedKeywords.push(chunkKw);
        break;
      }
    }
  }

  const keywordMatchScore = chunk.keywords.length > 0
    ? matchedKeywords.length / chunk.keywords.length
    : 0;

  // Calculate content similarity (full text)
  const contentSimilarity = calculateSimilarity(
    chunk.content.substring(0, 2000), // Limit for performance
    crText.substring(0, 2000)
  );

  // Combine scores with weights
  // Heading match is weighted higher as it indicates section relevance
  const contentMatchScore = (keywordMatchScore * 0.6 + contentSimilarity * 0.4);
  const finalScore = (headingMatchScore * 0.4 + contentMatchScore * 0.6);

  return {
    chunk_id: chunk.chunk_id,
    score: Math.min(1, Math.max(0, finalScore)),
    matched_keywords: [...new Set(matchedKeywords)],
    heading_match_score: headingMatchScore,
    content_match_score: contentMatchScore,
  };
}

/**
 * Score all chunks against multiple change requests
 * Returns combined score (max score across all change requests)
 */
export function scoreChunksAgainstChangeRequests(
  chunks: DocumentChunk[],
  changeRequests: ChangeRequest[]
): ScoredChunk[] {
  return chunks.map(chunk => {
    // Score against each change request, take the max
    let bestScore: RelevanceScore = {
      chunk_id: chunk.chunk_id,
      score: 0,
      matched_keywords: [],
      heading_match_score: 0,
      content_match_score: 0,
    };

    for (const cr of changeRequests) {
      const score = scoreChunkRelevance(chunk, cr);
      if (score.score > bestScore.score) {
        bestScore = score;
      }
    }

    return {
      ...chunk,
      relevance_score: bestScore,
    };
  });
}

/**
 * Select most relevant chunks up to token limit
 */
export function selectRelevantChunks(
  scoredChunks: ScoredChunk[],
  maxTokens: number = chunkingConfig.max_context_tokens,
  minScore: number = chunkingConfig.min_relevance_score,
  maxChunks: number = chunkingConfig.max_chunks_per_request
): ScoredChunk[] {
  // Filter by minimum score
  const filteredChunks = scoredChunks.filter(c => c.relevance_score.score >= minScore);

  // Sort by score descending
  const sortedChunks = [...filteredChunks].sort(
    (a, b) => b.relevance_score.score - a.relevance_score.score
  );

  // Select chunks up to token limit and max count
  const selectedChunks: ScoredChunk[] = [];
  let totalTokens = 0;

  for (const chunk of sortedChunks) {
    if (selectedChunks.length >= maxChunks) {
      break;
    }

    if (totalTokens + chunk.estimated_tokens > maxTokens) {
      continue; // Skip this chunk, try next
    }

    selectedChunks.push(chunk);
    totalTokens += chunk.estimated_tokens;
  }

  logger.info('Selected relevant chunks', {
    total_chunks: scoredChunks.length,
    filtered_chunks: filteredChunks.length,
    selected_chunks: selectedChunks.length,
    total_tokens: totalTokens,
    max_tokens: maxTokens,
  });

  return selectedChunks;
}

/**
 * Main function: Get relevant chunks for a document and change requests
 */
export async function getRelevantChunksForChangeRequests(
  documentId: string,
  changeRequests: ChangeRequest[],
  options?: {
    maxTokens?: number;
    minScore?: number;
    maxChunks?: number;
  }
): Promise<ScoredChunk[]> {
  // Load all chunks for document
  const chunks = await getAllChunks(documentId);

  if (chunks.length === 0) {
    logger.warn('No chunks found for document', { document_id: documentId });
    return [];
  }

  // Score chunks
  const scoredChunks = scoreChunksAgainstChangeRequests(chunks, changeRequests);

  // Select relevant chunks
  const selectedChunks = selectRelevantChunks(
    scoredChunks,
    options?.maxTokens ?? chunkingConfig.max_context_tokens,
    options?.minScore ?? chunkingConfig.min_relevance_score,
    options?.maxChunks ?? chunkingConfig.max_chunks_per_request
  );

  return selectedChunks;
}

/**
 * Build context string from selected chunks
 */
export function buildContextFromChunks(chunks: ScoredChunk[]): string {
  if (chunks.length === 0) {
    return '';
  }

  const parts: string[] = [];
  parts.push('## PRÍRUČKA - RELEVANTNÉ SEKCIE:\n');

  for (const chunk of chunks) {
    parts.push(`### ${chunk.heading}`);
    parts.push(`[Relevancia: ${Math.round(chunk.relevance_score.score * 100)}%]`);
    parts.push('');
    parts.push(chunk.content);
    parts.push('\n---\n');
  }

  return parts.join('\n');
}
