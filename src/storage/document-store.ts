/**
 * Document Store
 * Persistence layer for Word documents and their processing state
 */

import path from 'path';
import fs from 'fs/promises';
import { ParsedWordDocument, CoveragePlan, DocumentGenerationResult } from '../models/word-document';
import { readJSON, writeJSON, fileExists, listFiles, deleteFile, ensureDirectoryExists } from './json-storage';
import logger from '../utils/logger';

const DOCUMENTS_DIR = path.join(process.cwd(), 'data', 'documents');
const COVERAGE_DIR = path.join(process.cwd(), 'data', 'documents', 'coverage');
const RESULTS_DIR = path.join(process.cwd(), 'data', 'documents', 'results');
const UPLOADS_DIR = path.join(process.cwd(), 'data', 'documents', 'uploads');

// Ensure directories exist
async function initDirs(): Promise<void> {
  await ensureDirectoryExists(DOCUMENTS_DIR);
  await ensureDirectoryExists(COVERAGE_DIR);
  await ensureDirectoryExists(RESULTS_DIR);
  await ensureDirectoryExists(UPLOADS_DIR);
}

// Document operations

function normalizeDocumentPages(document: ParsedWordDocument): ParsedWordDocument {
  const normalized = { ...document };
  if (!Array.isArray(normalized.pages)) {
    const fallback = (normalized as any).detected_modules;
    normalized.pages = Array.isArray(fallback) ? fallback : [];
  }
  // Handle backward compatibility for old 'modules_detected' status
  if ((normalized as any).status === 'modules_detected') {
    normalized.status = 'pages_detected';
  }
  return normalized;
}

export async function saveDocument(document: ParsedWordDocument): Promise<void> {
  await initDirs();
  const filePath = path.join(DOCUMENTS_DIR, `${document.document_id}.json`);
  await writeJSON(filePath, normalizeDocumentPages(document));
  logger.debug('Document saved', { document_id: document.document_id, status: document.status });
}

export async function getDocument(documentId: string): Promise<ParsedWordDocument | null> {
  const filePath = path.join(DOCUMENTS_DIR, `${documentId}.json`);

  if (!(await fileExists(filePath))) {
    return null;
  }

  try {
    const document = await readJSON<ParsedWordDocument>(filePath);
    return normalizeDocumentPages(document);
  } catch (error) {
    logger.error('Failed to read document', { document_id: documentId, error: (error as Error).message });
    return null;
  }
}

export async function updateDocument(documentId: string, updates: Partial<ParsedWordDocument>): Promise<void> {
  const document = await getDocument(documentId);

  if (!document) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const updatedDocument = { ...document, ...updates };
  await saveDocument(updatedDocument);
}

export async function deleteDocument(documentId: string): Promise<string[]> {
  const deletedFiles: string[] = [];

  // Delete main document file
  const docPath = path.join(DOCUMENTS_DIR, `${documentId}.json`);
  if (await fileExists(docPath)) {
    await deleteFile(docPath);
    deletedFiles.push(docPath);
  }

  // Delete coverage plan
  const coveragePath = path.join(COVERAGE_DIR, `${documentId}.json`);
  if (await fileExists(coveragePath)) {
    await deleteFile(coveragePath);
    deletedFiles.push(coveragePath);
  }

  // Delete generation result
  const resultPath = path.join(RESULTS_DIR, `${documentId}.json`);
  if (await fileExists(resultPath)) {
    await deleteFile(resultPath);
    deletedFiles.push(resultPath);
  }

  // Delete uploaded file
  const uploadPath = path.join(UPLOADS_DIR, `${documentId}.docx`);
  if (await fileExists(uploadPath)) {
    await deleteFile(uploadPath);
    deletedFiles.push(uploadPath);
  }

  return deletedFiles;
}

export interface DocumentListItem {
  document_id: string;
  filename: string;
  status: ParsedWordDocument['status'];
  parsed_at: string;
  pages_count: number;
  modules_count: number;
  change_requests_count: number;
  project_id?: string;
}

export async function listDocuments(
  filters?: {
    status?: ParsedWordDocument['status'];
  },
  pagination?: {
    limit: number;
    offset: number;
  }
): Promise<{ total: number; documents: DocumentListItem[] }> {
  await initDirs();
  const files = await listFiles(DOCUMENTS_DIR, '.json');

  let documents: ParsedWordDocument[] = [];
  for (const file of files) {
    const filePath = path.join(DOCUMENTS_DIR, file);
    try {
      const doc = await readJSON<ParsedWordDocument>(filePath);
      documents.push(normalizeDocumentPages(doc));
    } catch (error) {
      logger.warn('Failed to read document file', { file, error: (error as Error).message });
    }
  }

  if (filters?.status) {
    documents = documents.filter(doc => doc.status === filters.status);
  }

  // Sort by parsed_at descending (newest first)
  documents.sort((a, b) => new Date(b.parsed_at).getTime() - new Date(a.parsed_at).getTime());

  const total = documents.length;

  if (pagination) {
    const { limit, offset } = pagination;
    documents = documents.slice(offset, offset + limit);
  }

  const documentItems: DocumentListItem[] = documents.map(doc => {
    const docWithProject = doc as ParsedWordDocument & { project_id?: string };
    const pages = doc.pages || [];
    const changeRequestsCount = pages.reduce(
      (sum, page) => sum + page.change_requests.length,
      0
    );

    return {
      document_id: doc.document_id,
      filename: doc.filename,
      status: doc.status,
      parsed_at: doc.parsed_at,
      pages_count: pages.length,
      modules_count: pages.length,
      change_requests_count: changeRequestsCount,
      project_id: docWithProject.project_id,
    };
  });

  return { total, documents: documentItems };
}

// Coverage plan operations

export async function saveCoveragePlan(plan: CoveragePlan): Promise<void> {
  await initDirs();
  const filePath = path.join(COVERAGE_DIR, `${plan.document_id}.json`);
  await writeJSON(filePath, plan);
  logger.debug('Coverage plan saved', { document_id: plan.document_id });
}

export async function getCoveragePlan(documentId: string): Promise<CoveragePlan | null> {
  const filePath = path.join(COVERAGE_DIR, `${documentId}.json`);

  if (!(await fileExists(filePath))) {
    return null;
  }

  try {
    return await readJSON<CoveragePlan>(filePath);
  } catch (error) {
    logger.error('Failed to read coverage plan', { document_id: documentId, error: (error as Error).message });
    return null;
  }
}

// Generation result operations

export async function saveGenerationResult(result: DocumentGenerationResult): Promise<void> {
  await initDirs();
  const filePath = path.join(RESULTS_DIR, `${result.document_id}.json`);
  await writeJSON(filePath, result);
  logger.debug('Generation result saved', { document_id: result.document_id });
}

export async function getGenerationResult(documentId: string): Promise<DocumentGenerationResult | null> {
  const filePath = path.join(RESULTS_DIR, `${documentId}.json`);

  if (!(await fileExists(filePath))) {
    return null;
  }

  try {
    return await readJSON<DocumentGenerationResult>(filePath);
  } catch (error) {
    logger.error('Failed to read generation result', { document_id: documentId, error: (error as Error).message });
    return null;
  }
}

// Upload operations

export async function getUploadPath(documentId: string): Promise<string> {
  await initDirs();
  return path.join(UPLOADS_DIR, `${documentId}.docx`);
}

export async function getUploadsDir(): Promise<string> {
  await initDirs();
  return UPLOADS_DIR;
}

// Manual files storage
const MANUALS_DIR = path.join(process.cwd(), 'data', 'manuals');

async function ensureManualsDir(): Promise<void> {
  await ensureDirectoryExists(MANUALS_DIR);
}

/**
 * Get the path where a manual file should be stored
 */
export async function getManualFilePath(documentId: string, originalFilename: string): Promise<string> {
  await ensureManualsDir();
  const ext = path.extname(originalFilename);
  return path.join(MANUALS_DIR, `${documentId}_manual${ext}`);
}

/**
 * Save a manual file permanently
 */
export async function saveManualFile(documentId: string, sourcePath: string, originalFilename: string): Promise<string> {
  await ensureManualsDir();
  const destPath = await getManualFilePath(documentId, originalFilename);

  // Copy file to permanent storage
  await fs.copyFile(sourcePath, destPath);

  logger.info('Manual file saved permanently', {
    document_id: documentId,
    original_filename: originalFilename,
    stored_path: destPath,
  });

  return destPath;
}

/**
 * Get the stored path for a manual file (if it exists)
 */
export async function getStoredManualPath(documentId: string): Promise<string | null> {
  await ensureManualsDir();

  // Check for common extensions
  const extensions = ['.docx', '.pdf', '.txt'];

  for (const ext of extensions) {
    const filePath = path.join(MANUALS_DIR, `${documentId}_manual${ext}`);
    if (await fileExists(filePath)) {
      return filePath;
    }
  }

  return null;
}

/**
 * Delete a manual file
 */
export async function deleteManualFile(documentId: string): Promise<boolean> {
  const filePath = await getStoredManualPath(documentId);
  if (filePath) {
    await deleteFile(filePath);
    logger.info('Manual file deleted', { document_id: documentId, path: filePath });
    return true;
  }
  return false;
}
