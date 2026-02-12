/**
 * Document Chunker
 * Splits large documents into manageable chunks for LLM processing
 */

import { DocumentSection } from '../models/word-document';
import { extractKeywords } from './text-similarity';
import chunkingConfig from '../../config/chunking.json';

export interface DocumentChunk {
  chunk_id: string;
  document_id: string;
  section_path: string[];      // ["Kapitola 1", "Sekcia 1.1"]
  heading: string;
  content: string;
  char_count: number;
  estimated_tokens: number;
  keywords: string[];
}

export interface ChunkedDocument {
  document_id: string;
  filename: string;
  total_chunks: number;
  total_chars: number;
  total_estimated_tokens: number;
  chunks: DocumentChunk[];
  chunked_at: string;
}

export interface ChunkOptions {
  targetTokens?: number;
  maxTokens?: number;
  overlapTokens?: number;
  charsPerToken?: number;
}

/**
 * Estimate token count from text
 * Rough estimate: ~4 characters = 1 token for mixed content
 */
export function estimateTokens(text: string, charsPerToken: number = chunkingConfig.chars_per_token): number {
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Estimate character count from tokens
 */
export function tokensToChars(tokens: number, charsPerToken: number = chunkingConfig.chars_per_token): number {
  return tokens * charsPerToken;
}

/**
 * Generate unique chunk ID
 */
function generateChunkId(documentId: string, index: number): string {
  return `${documentId}_chunk_${String(index).padStart(4, '0')}`;
}

/**
 * Split text into chunks at natural boundaries (paragraphs, sentences)
 */
function splitTextAtBoundaries(
  text: string,
  maxChars: number,
  overlapChars: number
): string[] {
  const chunks: string[] = [];
  let currentPos = 0;

  while (currentPos < text.length) {
    let endPos = currentPos + maxChars;

    if (endPos >= text.length) {
      // Last chunk - take everything remaining
      chunks.push(text.substring(currentPos).trim());
      break;
    }

    // Try to find a good break point (paragraph, then sentence, then word)
    let breakPoint = endPos;

    // Look for paragraph break (\n\n) within last 20% of chunk
    const searchStart = currentPos + Math.floor(maxChars * 0.8);
    const searchText = text.substring(searchStart, endPos);

    const paragraphBreak = searchText.lastIndexOf('\n\n');
    if (paragraphBreak !== -1) {
      breakPoint = searchStart + paragraphBreak + 2;
    } else {
      // Look for sentence break (. or ? or !)
      const sentenceMatch = searchText.match(/[.!?]\s+(?=[A-ZČĎÉÍĽŇÓŔŠŤÚÝŽ])/g);
      if (sentenceMatch) {
        const lastSentenceEnd = searchText.lastIndexOf(sentenceMatch[sentenceMatch.length - 1]);
        if (lastSentenceEnd !== -1) {
          breakPoint = searchStart + lastSentenceEnd + sentenceMatch[sentenceMatch.length - 1].length;
        }
      } else {
        // Look for word break
        const lastSpace = text.substring(currentPos, endPos).lastIndexOf(' ');
        if (lastSpace !== -1 && lastSpace > maxChars * 0.5) {
          breakPoint = currentPos + lastSpace + 1;
        }
      }
    }

    chunks.push(text.substring(currentPos, breakPoint).trim());

    // Move to next position with overlap
    currentPos = breakPoint - overlapChars;
    if (currentPos < 0) currentPos = 0;
  }

  return chunks.filter(c => c.length > 0);
}

/**
 * Create chunk from section
 */
function createChunkFromSection(
  section: DocumentSection,
  documentId: string,
  chunkIndex: number,
  sectionPath: string[],
  options: Required<ChunkOptions>
): DocumentChunk {
  const content = section.content;
  const heading = section.heading || sectionPath[sectionPath.length - 1] || 'Bez názvu';

  return {
    chunk_id: generateChunkId(documentId, chunkIndex),
    document_id: documentId,
    section_path: sectionPath,
    heading,
    content,
    char_count: content.length,
    estimated_tokens: estimateTokens(content, options.charsPerToken),
    keywords: extractKeywords(heading + ' ' + content),
  };
}

/**
 * Process section recursively, creating chunks
 */
function processSectionRecursively(
  section: DocumentSection,
  documentId: string,
  chunks: DocumentChunk[],
  sectionPath: string[],
  options: Required<ChunkOptions>
): void {
  const currentPath = [...sectionPath, section.heading];
  const contentTokens = estimateTokens(section.content, options.charsPerToken);

  if (contentTokens <= options.maxTokens) {
    // Section fits in one chunk
    if (section.content.trim().length > 0) {
      chunks.push(createChunkFromSection(
        section,
        documentId,
        chunks.length,
        currentPath,
        options
      ));
    }
  } else {
    // Section too large - split into sub-chunks
    const maxChars = tokensToChars(options.maxTokens, options.charsPerToken);
    const overlapChars = tokensToChars(options.overlapTokens, options.charsPerToken);

    const subChunks = splitTextAtBoundaries(section.content, maxChars, overlapChars);

    for (let i = 0; i < subChunks.length; i++) {
      const subChunk = subChunks[i];
      const subHeading = section.heading + (subChunks.length > 1 ? ` (časť ${i + 1}/${subChunks.length})` : '');

      chunks.push({
        chunk_id: generateChunkId(documentId, chunks.length),
        document_id: documentId,
        section_path: [...currentPath, `časť ${i + 1}`],
        heading: subHeading,
        content: subChunk,
        char_count: subChunk.length,
        estimated_tokens: estimateTokens(subChunk, options.charsPerToken),
        keywords: extractKeywords(subHeading + ' ' + subChunk),
      });
    }
  }

  // Process subsections
  for (const subsection of section.subsections || []) {
    processSectionRecursively(subsection, documentId, chunks, currentPath, options);
  }
}

/**
 * Chunk raw text without section structure
 */
function chunkRawText(
  rawText: string,
  documentId: string,
  options: Required<ChunkOptions>
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const maxChars = tokensToChars(options.targetTokens, options.charsPerToken);
  const overlapChars = tokensToChars(options.overlapTokens, options.charsPerToken);

  const textChunks = splitTextAtBoundaries(rawText, maxChars, overlapChars);

  for (let i = 0; i < textChunks.length; i++) {
    const content = textChunks[i];
    const heading = `Sekcia ${i + 1}`;

    chunks.push({
      chunk_id: generateChunkId(documentId, i),
      document_id: documentId,
      section_path: [heading],
      heading,
      content,
      char_count: content.length,
      estimated_tokens: estimateTokens(content, options.charsPerToken),
      keywords: extractKeywords(content),
    });
  }

  return chunks;
}

/**
 * Main function: Chunk a document into manageable pieces
 */
export function chunkDocument(
  sections: DocumentSection[],
  rawText: string,
  documentId: string,
  filename: string,
  options?: ChunkOptions
): ChunkedDocument {
  const opts: Required<ChunkOptions> = {
    targetTokens: options?.targetTokens ?? chunkingConfig.chunk_target_tokens,
    maxTokens: options?.maxTokens ?? chunkingConfig.chunk_max_tokens,
    overlapTokens: options?.overlapTokens ?? chunkingConfig.chunk_overlap_tokens,
    charsPerToken: options?.charsPerToken ?? chunkingConfig.chars_per_token,
  };

  const chunks: DocumentChunk[] = [];

  if (sections && sections.length > 0) {
    // Document has sections - chunk by section
    for (const section of sections) {
      processSectionRecursively(section, documentId, chunks, [], opts);
    }
  } else if (rawText && rawText.length > 0) {
    // No sections - chunk raw text
    chunks.push(...chunkRawText(rawText, documentId, opts));
  }

  // Calculate totals
  const totalChars = chunks.reduce((sum, c) => sum + c.char_count, 0);
  const totalTokens = chunks.reduce((sum, c) => sum + c.estimated_tokens, 0);

  return {
    document_id: documentId,
    filename,
    total_chunks: chunks.length,
    total_chars: totalChars,
    total_estimated_tokens: totalTokens,
    chunks,
    chunked_at: new Date().toISOString(),
  };
}

/**
 * Check if a document should be chunked based on size
 */
export function shouldChunkDocument(textLength: number): boolean {
  const maxDirectContextChars = tokensToChars(chunkingConfig.max_context_tokens);
  return textLength > maxDirectContextChars;
}

/**
 * Get chunking configuration
 */
export function getChunkingConfig() {
  return { ...chunkingConfig };
}
