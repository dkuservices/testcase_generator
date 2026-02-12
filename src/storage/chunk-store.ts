/**
 * Chunk Store
 * Storage and retrieval for document chunks
 */

import fs from 'fs/promises';
import path from 'path';
import { ChunkedDocument, DocumentChunk } from '../utils/document-chunker';
import logger from '../utils/logger';

const CHUNKS_DIR = 'data/chunks';

/**
 * Ensure chunks directory exists
 */
async function ensureChunksDir(): Promise<string> {
  await fs.mkdir(CHUNKS_DIR, { recursive: true });
  return CHUNKS_DIR;
}

/**
 * Get directory for a specific document's chunks
 */
async function getDocumentChunksDir(documentId: string): Promise<string> {
  const dir = path.join(CHUNKS_DIR, documentId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Save chunked document metadata and chunks
 */
export async function saveChunkedDocument(chunkedDoc: ChunkedDocument): Promise<void> {
  const dir = await getDocumentChunksDir(chunkedDoc.document_id);

  // Save metadata (without chunks array for smaller file)
  const metadata = {
    document_id: chunkedDoc.document_id,
    filename: chunkedDoc.filename,
    total_chunks: chunkedDoc.total_chunks,
    total_chars: chunkedDoc.total_chars,
    total_estimated_tokens: chunkedDoc.total_estimated_tokens,
    chunked_at: chunkedDoc.chunked_at,
  };

  await fs.writeFile(
    path.join(dir, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf-8'
  );

  // Save individual chunks
  for (const chunk of chunkedDoc.chunks) {
    const chunkFile = path.join(dir, `${chunk.chunk_id}.json`);
    await fs.writeFile(chunkFile, JSON.stringify(chunk, null, 2), 'utf-8');
  }

  logger.info('Chunked document saved', {
    document_id: chunkedDoc.document_id,
    total_chunks: chunkedDoc.total_chunks,
    total_tokens: chunkedDoc.total_estimated_tokens,
  });
}

/**
 * Load chunked document metadata
 */
export async function getChunkedDocumentMetadata(documentId: string): Promise<Omit<ChunkedDocument, 'chunks'> | null> {
  try {
    const dir = path.join(CHUNKS_DIR, documentId);
    const metadataPath = path.join(dir, 'metadata.json');
    const content = await fs.readFile(metadataPath, 'utf-8');
    return JSON.parse(content);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Load a specific chunk
 */
export async function getChunk(documentId: string, chunkId: string): Promise<DocumentChunk | null> {
  try {
    const dir = path.join(CHUNKS_DIR, documentId);
    const chunkPath = path.join(dir, `${chunkId}.json`);
    const content = await fs.readFile(chunkPath, 'utf-8');
    return JSON.parse(content);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Load all chunks for a document
 */
export async function getAllChunks(documentId: string): Promise<DocumentChunk[]> {
  try {
    const dir = path.join(CHUNKS_DIR, documentId);
    const files = await fs.readdir(dir);

    const chunks: DocumentChunk[] = [];

    for (const file of files) {
      if (file.endsWith('.json') && file !== 'metadata.json') {
        const chunkPath = path.join(dir, file);
        const content = await fs.readFile(chunkPath, 'utf-8');
        chunks.push(JSON.parse(content));
      }
    }

    // Sort by chunk_id to maintain order
    chunks.sort((a, b) => a.chunk_id.localeCompare(b.chunk_id));

    return chunks;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Load full chunked document with all chunks
 */
export async function getChunkedDocument(documentId: string): Promise<ChunkedDocument | null> {
  const metadata = await getChunkedDocumentMetadata(documentId);
  if (!metadata) {
    return null;
  }

  const chunks = await getAllChunks(documentId);

  return {
    ...metadata,
    chunks,
  };
}

/**
 * Check if document has been chunked
 */
export async function isDocumentChunked(documentId: string): Promise<boolean> {
  const metadata = await getChunkedDocumentMetadata(documentId);
  return metadata !== null;
}

/**
 * Delete all chunks for a document
 */
export async function deleteChunks(documentId: string): Promise<number> {
  try {
    const dir = path.join(CHUNKS_DIR, documentId);
    const files = await fs.readdir(dir);

    for (const file of files) {
      await fs.unlink(path.join(dir, file));
    }

    await fs.rmdir(dir);

    logger.info('Chunks deleted', {
      document_id: documentId,
      files_deleted: files.length,
    });

    return files.length;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
}

/**
 * Get chunks summary (for UI display)
 */
export async function getChunksSummary(documentId: string): Promise<{
  total_chunks: number;
  total_tokens: number;
  chunks_preview: Array<{
    chunk_id: string;
    heading: string;
    estimated_tokens: number;
  }>;
} | null> {
  const metadata = await getChunkedDocumentMetadata(documentId);
  if (!metadata) {
    return null;
  }

  const chunks = await getAllChunks(documentId);

  return {
    total_chunks: metadata.total_chunks,
    total_tokens: metadata.total_estimated_tokens,
    chunks_preview: chunks.map(c => ({
      chunk_id: c.chunk_id,
      heading: c.heading,
      estimated_tokens: c.estimated_tokens,
    })),
  };
}

/**
 * List all chunked documents
 */
export async function listChunkedDocuments(): Promise<string[]> {
  try {
    await ensureChunksDir();
    const entries = await fs.readdir(CHUNKS_DIR, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
