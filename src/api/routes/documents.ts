/**
 * Documents API Routes
 * Handles Word document upload and test generation
 */

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { JiraConfig } from '../../models/config';
import { ApiError } from '../middleware/error-handler';
import {
  listDocuments,
  getDocument,
  updateDocument,
  deleteDocument,
  getUploadsDir,
  getUploadPath,
  getCoveragePlan,
  getGenerationResult,
  saveGenerationResult,
  saveManualFile,
  getStoredManualPath,
  deleteManualFile,
} from '../../storage/document-store';
import { listJobs } from '../../storage/job-store';
import {
  processWordDocument,
  generateTestsForDocument,
  processMultipleDocuments,
} from '../../pipeline/document-pipeline-orchestrator';
import { planCoverage, estimateCoverageMetrics } from '../../pipeline/coverage-planner';
import { saveCoveragePlan } from '../../storage/document-store';
import logger from '../../utils/logger';
import { parseDocument as parseContextDocument, isValidFileType as isValidContextFileType, getFileSizeMB } from '../../utils/document-parser';
import { chunkDocument, shouldChunkDocument } from '../../utils/document-chunker';
import { saveChunkedDocument, getChunksSummary } from '../../storage/chunk-store';
import chunkingConfig from '../../../config/chunking.json';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const uploadsDir = await getUploadsDir();
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.docx' && ext !== '.doc') {
      cb(new Error('Only .docx and .doc files are allowed'));
      return;
    }
    cb(null, true);
  }
});

// Configure multer for context file uploads (manuals/handbooks)
// Increased limit to 200MB for large manuals - will be chunked automatically
const contextUpload = multer({
  dest: 'data/temp_uploads/',
  limits: {
    fileSize: chunkingConfig.upload_limit_mb * 1024 * 1024, // Configurable limit (default 200MB)
  },
  fileFilter: (_req, file, cb) => {
    if (isValidContextFileType(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only docx, pdf, and txt files are allowed.'));
    }
  },
});

export function createDocumentsRoute(jiraConfig: JiraConfig): Router {
  const router = Router();

  // Upload multiple Word documents
  router.post('/upload', upload.array('files', 20), async (req: Request, res: Response, next: NextFunction) => {
    const uploadedFiles = req.files as Express.Multer.File[];
    const results: any[] = [];
    const errors: any[] = [];

    try {
      if (!uploadedFiles || uploadedFiles.length === 0) {
        throw new ApiError('No files uploaded', 400);
      }

      logger.info('Documents upload received', {
        count: uploadedFiles.length,
        filenames: uploadedFiles.map(f => f.originalname),
      });

      // Process each file
      for (const file of uploadedFiles) {
        try {
          // Read the uploaded file
          const filePath = file.path;
          const buffer = await fs.readFile(filePath);

          // Process the document (creates project and components)
          const result = await processWordDocument(buffer, file.originalname, jiraConfig);

          // Move file to final location with document ID
          const finalPath = await getUploadPath(result.documentId);
          await fs.rename(filePath, finalPath);

          // Get the processed document
          const document = await getDocument(result.documentId);

          results.push({
            document_id: result.documentId,
            project_id: result.projectId,
            filename: file.originalname,
            status: document?.status,
          pages_count: document?.pages?.length || 0,
          modules_count: document?.pages?.length || 0,
          change_requests_count: (document?.pages || []).reduce(
            (sum, page) => sum + page.change_requests.length,
            0
          ),
          });
        } catch (error: any) {
          // Clean up this file
          try {
            await fs.unlink(file.path);
          } catch {
            // Ignore cleanup errors
          }
          errors.push({
            filename: file.originalname,
            error: error.message,
          });
        }
      }

      res.status(201).json({
        total_uploaded: results.length,
        total_failed: errors.length,
        documents: results,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      // Clean up all uploaded files if initial validation failed
      if (uploadedFiles) {
        for (const file of uploadedFiles) {
          try {
            await fs.unlink(file.path);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
      next(error);
    }
  });

  // Create a project from multiple documents with custom name
  router.post('/create-project', upload.array('files', 20), async (req: Request, res: Response, next: NextFunction) => {
    const uploadedFiles = req.files as Express.Multer.File[];

    try {
      if (!uploadedFiles || uploadedFiles.length === 0) {
        throw new ApiError('No files uploaded', 400);
      }

      const projectName = req.body.projectName;
      if (!projectName || typeof projectName !== 'string' || projectName.trim() === '') {
        throw new ApiError('projectName is required', 400);
      }

      logger.info('Create project from documents', {
        project_name: projectName,
        file_count: uploadedFiles.length,
        filenames: uploadedFiles.map(f => f.originalname),
      });

      // Read all files into buffers
      const documents: { buffer: Buffer; filename: string }[] = [];
      for (const file of uploadedFiles) {
        const buffer = await fs.readFile(file.path);
        documents.push({
          buffer,
          filename: file.originalname,
        });
      }

      // Process all documents into a single project
      const result = await processMultipleDocuments(documents, projectName.trim(), jiraConfig);

      // Move files to final location
      for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        const docId = result.documentIds[i];
        if (docId) {
          try {
            const finalPath = await getUploadPath(docId);
            await fs.rename(file.path, finalPath);
          } catch {
            // Ignore move errors
          }
        }
      }

      res.status(201).json({
        project_id: result.projectId,
        project_name: result.projectName,
        document_ids: result.documentIds,
        total_pages: result.totalPages,
        total_change_requests: result.totalChangeRequests,
      });

    } catch (error) {
      // Clean up uploaded files on error
      if (uploadedFiles) {
        for (const file of uploadedFiles) {
          try {
            await fs.unlink(file.path);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
      next(error);
    }
  });

  // Generate tests for multiple documents at once
  router.post('/generate-batch', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { document_ids } = req.body;

      if (!document_ids || !Array.isArray(document_ids) || document_ids.length === 0) {
        throw new ApiError('document_ids array is required', 400);
      }

      if (document_ids.length > 20) {
        throw new ApiError('Maximum 20 documents can be processed at once', 400);
      }

      const validDocuments: { id: string; pagesCount: number }[] = [];
      const invalidDocuments: { id: string; error: string }[] = [];

      // Validate all documents first
      const validStatuses = ['pages_detected', 'awaiting_manual', 'awaiting_context', 'completed'];

      for (const docId of document_ids) {
        const document = await getDocument(docId);
        if (!document) {
          invalidDocuments.push({ id: docId, error: 'Document not found' });
          logger.warn('Generate batch: Document not found', { document_id: docId });
          continue;
        }
        if (document.status === 'generating') {
          invalidDocuments.push({ id: docId, error: 'Generation already in progress' });
          continue;
        }
        if (!validStatuses.includes(document.status)) {
          invalidDocuments.push({ id: docId, error: `Invalid status: ${document.status}` });
          logger.warn('Generate batch: Invalid document status', { document_id: docId, status: document.status });
          continue;
        }
        const pagesCount = document.pages?.length || 0;
        if (pagesCount === 0) {
          invalidDocuments.push({ id: docId, error: 'No modules detected' });
          logger.warn('Generate batch: No modules detected', { document_id: docId, status: document.status });
          continue;
        }
        validDocuments.push({ id: docId, pagesCount });
      }

      if (validDocuments.length === 0) {
        const reasons = invalidDocuments.map(d => `${d.id}: ${d.error}`).join(', ');
        logger.error('Generate batch: No valid documents', { invalid_documents: invalidDocuments });
        throw new ApiError(`No valid documents to process. Reasons: ${reasons}`, 400);
      }

      // Return immediately with 202 Accepted
      res.status(202).json({
        message: 'Batch test generation started',
        total_documents: validDocuments.length,
        total_pages: validDocuments.reduce((sum, d) => sum + (d.pagesCount || 0), 0),
        document_ids: validDocuments.map(d => d.id),
        invalid_documents: invalidDocuments.length > 0 ? invalidDocuments : undefined,
      });

      // Start generation for all valid documents in background
      for (const doc of validDocuments) {
        generateTestsForDocument(doc.id, jiraConfig)
          .then(async (result) => {
            await saveGenerationResult(result);
            logger.info('Document test generation completed', {
              document_id: doc.id,
              total_scenarios: result.total_scenarios,
            });
          })
          .catch((error) => {
            logger.error('Document test generation failed', {
              document_id: doc.id,
              error: error.message,
            });
          });
      }
    } catch (error) {
      next(error);
    }
  });

  // List all documents
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, limit = '50', offset = '0' } = req.query;

      const limitNum = parseInt(limit as string, 10);
      const offsetNum = parseInt(offset as string, 10);

      if (limitNum > 200) {
        throw new ApiError('Limit cannot exceed 200', 400);
      }

      const filters: any = {};
      if (status) {
        filters.status = status;
      }

      const result = await listDocuments(filters, {
        limit: limitNum,
        offset: offsetNum,
      });

      res.json({
        total: result.total,
        limit: limitNum,
        offset: offsetNum,
        documents: result.documents,
      });
    } catch (error) {
      next(error);
    }
  });

  // Get document details
  router.get('/:documentId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId } = req.params;

      const document = await getDocument(documentId);
      if (!document) {
        throw new ApiError(`Document not found: ${documentId}`, 404);
      }

      // Get coverage plan if available
      const coveragePlan = await getCoveragePlan(documentId);

      // Get generation result if available
      const generationResult = await getGenerationResult(documentId);

      res.json({
        ...document,
        coverage_plan: coveragePlan,
        generation_result: generationResult,
      });
    } catch (error) {
      next(error);
    }
  });

  // Get chunks info for a document's manual
  router.get('/:documentId/chunks', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId } = req.params;

      const document = await getDocument(documentId);
      if (!document) {
        throw new ApiError(`Document not found: ${documentId}`, 404);
      }

      // Check if manual is chunked
      if (!document.project_context?.is_chunked) {
        res.json({
          document_id: documentId,
          is_chunked: false,
          message: 'Manual is not chunked (small enough to use directly)',
        });
        return;
      }

      // Get chunks summary
      const chunksSummary = await getChunksSummary(`${documentId}_manual`);

      if (!chunksSummary) {
        throw new ApiError('Chunks not found for document', 404);
      }

      res.json({
        document_id: documentId,
        is_chunked: true,
        ...chunksSummary,
      });
    } catch (error) {
      next(error);
    }
  });

  // Download manual file for a document
  router.get('/:documentId/manual/download', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId } = req.params;

      const document = await getDocument(documentId);
      if (!document) {
        throw new ApiError(`Document not found: ${documentId}`, 404);
      }

      // Check if document has a manual file
      if (!document.project_context?.manual_file) {
        throw new ApiError('No manual file found for this document', 404);
      }

      // Get stored file path
      const storedPath = await getStoredManualPath(documentId);
      if (!storedPath) {
        throw new ApiError('Manual file not found in storage', 404);
      }

      // Check if file exists
      const fileExists = await fs.access(storedPath).then(() => true).catch(() => false);
      if (!fileExists) {
        throw new ApiError('Manual file no longer exists', 404);
      }

      const filename = document.project_context.manual_file.filename;

      logger.info('Downloading manual file', {
        document_id: documentId,
        filename,
        stored_path: storedPath,
      });

      // Set headers for download
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Content-Type', 'application/octet-stream');

      // Stream the file
      const fileStream = await fs.readFile(storedPath);
      res.send(fileStream);
    } catch (error) {
      next(error);
    }
  });

  // Delete a document
  router.delete('/:documentId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId } = req.params;

      const document = await getDocument(documentId);
      if (!document) {
        throw new ApiError(`Document not found: ${documentId}`, 404);
      }

      if (document.status === 'generating') {
        throw new ApiError('Cannot delete document while generating', 400);
      }

      // Delete manual file if exists
      const manualDeleted = await deleteManualFile(documentId);

      const deletedFiles = await deleteDocument(documentId);

      res.json({
        message: 'Document deleted successfully',
        deleted_files: deletedFiles.length,
        manual_deleted: manualDeleted,
      });
    } catch (error) {
      next(error);
    }
  });

  // Get coverage plan for a document
  router.get('/:documentId/coverage', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId } = req.params;

      const document = await getDocument(documentId);
      if (!document) {
        throw new ApiError(`Document not found: ${documentId}`, 404);
      }

      const pageCount = document.pages?.length || 0;
      if (pageCount === 0) {
        throw new ApiError('Document has no detected pages', 400);
      }

      // Check if coverage plan already exists
      let coveragePlan = await getCoveragePlan(documentId);

      if (!coveragePlan) {
        // Generate coverage plan
        coveragePlan = planCoverage(document.pages || [], documentId);
        await saveCoveragePlan(coveragePlan);
      }

      const metrics = estimateCoverageMetrics(document.pages || [], coveragePlan);

      res.json({
        coverage_plan: coveragePlan,
        metrics,
      });
    } catch (error) {
      next(error);
    }
  });

  // Request manual/handbook upload for document (NEW WORKFLOW)
  router.post('/:documentId/request-manual', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId } = req.params;

      logger.info(`[request-manual] Received request for document: ${documentId}`);

      const document = await getDocument(documentId);
      if (!document) {
        logger.error(`[request-manual] Document not found: ${documentId}`);
        throw new ApiError(`Document not found: ${documentId}`, 404);
      }

      logger.info(`[request-manual] Document status: ${document.status}, pages: ${document.pages?.length || 0}`);

      // Allow pages_detected or already awaiting_manual
      if (document.status !== 'pages_detected' && document.status !== 'awaiting_manual') {
        logger.error(`[request-manual] Invalid status: ${document.status}`);
        throw new ApiError(
          `Document must be in pages_detected or awaiting_manual status. Current: ${document.status}`,
          400
        );
      }

      // Only transition if not already in awaiting_manual
      if (document.status === 'pages_detected') {
        logger.info(`[request-manual] Transitioning document to awaiting_manual`);
        await updateDocument(documentId, {
          ...document,
          status: 'awaiting_manual',
        });
      }

      logger.info(`[request-manual] Returning ${document.pages?.length || 0} pages`);

      res.json({
        message: 'Document ready for manual/handbook upload',
        document_id: documentId,
        pages: document.pages || [],
        status: 'awaiting_manual',
      });
    } catch (error) {
      logger.error(`[request-manual] Error:`, error);
      next(error);
    }
  });

  // Request supplementary context for document pages (OLD WORKFLOW - still supported)
  router.post('/:documentId/request-context', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId } = req.params;

      logger.info(`[request-context] Received request for document: ${documentId}`);

      const document = await getDocument(documentId);
      if (!document) {
        logger.error(`[request-context] Document not found: ${documentId}`);
        throw new ApiError(`Document not found: ${documentId}`, 404);
      }

      logger.info(`[request-context] Document status: ${document.status}, pages: ${document.pages?.length || 0}`);

      // Allow pages_detected or already awaiting_context
      if (document.status !== 'pages_detected' && document.status !== 'awaiting_context') {
        logger.error(`[request-context] Invalid status: ${document.status}`);
        throw new ApiError(
          `Document must be in pages_detected or awaiting_context status. Current: ${document.status}`,
          400
        );
      }

      // Only transition if not already in awaiting_context
      if (document.status === 'pages_detected') {
        logger.info(`[request-context] Transitioning document to awaiting_context`);
        await updateDocument(documentId, {
          ...document,
          status: 'awaiting_context',
        });
      }

      logger.info(`[request-context] Returning ${document.pages?.length || 0} pages`);

      res.json({
        message: 'Document ready for supplementary context',
        document_id: documentId,
        pages: document.pages || [],
        status: 'awaiting_context',
      });
    } catch (error) {
      logger.error(`[request-context] Error:`, error);
      next(error);
    }
  });

  // Upload manual/handbook for entire document (text)
  router.post('/:documentId/manual/text', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId } = req.params;
      const { manual_text } = req.body;

      if (!manual_text || typeof manual_text !== 'string' || manual_text.trim().length === 0) {
        throw new ApiError('manual_text is required', 400);
      }

      const document = await getDocument(documentId);
      if (!document) {
        throw new ApiError(`Document not found: ${documentId}`, 404);
      }

      if (document.status !== 'awaiting_manual' && document.status !== 'pages_detected') {
        throw new ApiError(`Document must be in awaiting_manual or pages_detected status. Current: ${document.status}`, 400);
      }

      await updateDocument(documentId, {
        ...document,
        project_context: {
          manual_text: manual_text.trim(),
          added_at: new Date().toISOString(),
        },
        status: 'awaiting_manual', // Keep in awaiting_manual state
      });

      logger.info('Manual text added to document', {
        document_id: documentId,
        text_length: manual_text.trim().length,
      });

      res.json({
        message: 'Manual text added successfully',
        document_id: documentId,
        text_length: manual_text.trim().length,
      });
    } catch (error) {
      next(error);
    }
  });

  // Upload manual/handbook for entire document (file)
  // Supports large files (up to 200MB) with automatic chunking
  router.post('/:documentId/manual/file', contextUpload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId } = req.params;
      const file = req.file;

      if (!file) {
        throw new ApiError('No file uploaded', 400);
      }

      const document = await getDocument(documentId);
      if (!document) {
        await fs.unlink(file.path).catch(() => {});
        throw new ApiError(`Document not found: ${documentId}`, 404);
      }

      if (document.status !== 'awaiting_manual' && document.status !== 'pages_detected') {
        await fs.unlink(file.path).catch(() => {});
        throw new ApiError(`Document must be in awaiting_manual or pages_detected status. Current: ${document.status}`, 400);
      }

      // Check file size against configured limit
      const fileSizeMB = await getFileSizeMB(file.path);
      if (fileSizeMB > chunkingConfig.upload_limit_mb) {
        await fs.unlink(file.path).catch(() => {});
        throw new ApiError(`File size exceeds ${chunkingConfig.upload_limit_mb} MB limit`, 400);
      }

      logger.info('Parsing manual file', {
        document_id: documentId,
        filename: file.originalname,
        file_size_mb: fileSizeMB,
      });

      // Parse the document
      const parsedDoc = await parseContextDocument(file.path, file.originalname);

      // Save file permanently instead of deleting it
      const storedFilePath = await saveManualFile(documentId, file.path, file.originalname);

      // Clean up temp uploaded file
      await fs.unlink(file.path).catch(() => {});

      // Check if document needs chunking
      const needsChunking = shouldChunkDocument(parsedDoc.text.length);
      let chunkingInfo = undefined;

      if (needsChunking) {
        logger.info('Large manual detected, chunking document', {
          document_id: documentId,
          text_length: parsedDoc.text.length,
        });

        // Create chunked document
        const chunkedDoc = chunkDocument(
          [], // No sections for manual files
          parsedDoc.text,
          `${documentId}_manual`,
          parsedDoc.filename
        );

        // Save chunks
        await saveChunkedDocument(chunkedDoc);

        chunkingInfo = {
          total_chunks: chunkedDoc.total_chunks,
          total_tokens: chunkedDoc.total_estimated_tokens,
          chunked_at: chunkedDoc.chunked_at,
        };

        logger.info('Manual chunked successfully', {
          document_id: documentId,
          total_chunks: chunkedDoc.total_chunks,
          total_tokens: chunkedDoc.total_estimated_tokens,
        });
      }

      await updateDocument(documentId, {
        ...document,
        project_context: {
          manual_text: needsChunking ? undefined : parsedDoc.text, // Don't store full text if chunked
          manual_file: {
            filename: parsedDoc.filename,
            file_type: parsedDoc.file_type,
            uploaded_at: parsedDoc.parsed_at,
            stored_path: storedFilePath, // Store path to permanent file
          },
          added_at: new Date().toISOString(),
          is_chunked: needsChunking,
          chunking_info: chunkingInfo,
        },
        status: 'awaiting_manual', // Keep in awaiting_manual state
      });

      logger.info('Manual file added to document', {
        document_id: documentId,
        filename: parsedDoc.filename,
        file_type: parsedDoc.file_type,
        text_length: parsedDoc.text.length,
        is_chunked: needsChunking,
        stored_path: storedFilePath,
      });

      res.json({
        message: needsChunking
          ? 'Manual file added and chunked successfully'
          : 'Manual file added successfully',
        document_id: documentId,
        filename: parsedDoc.filename,
        file_type: parsedDoc.file_type,
        text_length: parsedDoc.text.length,
        is_chunked: needsChunking,
        chunking_info: chunkingInfo,
        stored_file: true,
      });
    } catch (error) {
      // Clean up uploaded file on error
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      next(error);
    }
  });

  // Add supplementary context to a specific page
  router.post('/:documentId/pages/:pageId/context', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId, pageId } = req.params;
      const { confluence_links, additional_text } = req.body;

      const document = await getDocument(documentId);
      if (!document) {
        throw new ApiError(`Document not found: ${documentId}`, 404);
      }

      if (document.status !== 'awaiting_context') {
        throw new ApiError(`Document must be in awaiting_context status. Current: ${document.status}`, 400);
      }

      // Find the page in the document
      const pageIndex = document.pages?.findIndex((p) => p.page_id === pageId);
      if (pageIndex === undefined || pageIndex === -1) {
        throw new ApiError(`Page not found: ${pageId}`, 404);
      }

      // Update the page with supplementary context
      const pages = [...(document.pages || [])];
      pages[pageIndex] = {
        ...pages[pageIndex],
        supplementary_context: {
          confluence_links: confluence_links || [],
          additional_text: additional_text || '',
          added_at: new Date().toISOString(),
        },
      };

      await updateDocument(documentId, {
        ...document,
        pages,
      });

      res.json({
        message: 'Supplementary context added',
        page_id: pageId,
      });
    } catch (error) {
      next(error);
    }
  });

  // Upload file context for a specific page
  router.post('/:documentId/pages/:pageId/context/file', contextUpload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId, pageId } = req.params;
      const file = req.file;

      if (!file) {
        throw new ApiError('No file uploaded', 400);
      }

      const document = await getDocument(documentId);
      if (!document) {
        await fs.unlink(file.path).catch(() => {});
        throw new ApiError(`Document not found: ${documentId}`, 404);
      }

      if (document.status !== 'awaiting_context') {
        await fs.unlink(file.path).catch(() => {});
        throw new ApiError(`Document must be in awaiting_context status. Current: ${document.status}`, 400);
      }

      // Find the page in the document
      const pageIndex = document.pages?.findIndex((p) => p.page_id === pageId);
      if (pageIndex === undefined || pageIndex === -1) {
        await fs.unlink(file.path).catch(() => {});
        throw new ApiError(`Page not found: ${pageId}`, 404);
      }

      // Check file size
      const fileSizeMB = await getFileSizeMB(file.path);
      if (fileSizeMB > 10) {
        await fs.unlink(file.path).catch(() => {});
        throw new ApiError('File size exceeds 10 MB limit', 400);
      }

      // Parse the document
      const parsedDoc = await parseContextDocument(file.path, file.originalname);

      // Clean up uploaded file
      await fs.unlink(file.path).catch(() => {});

      // Update the page with supplementary context
      const pages = [...(document.pages || [])];
      const existingContext = pages[pageIndex].supplementary_context || {};

      pages[pageIndex] = {
        ...pages[pageIndex],
        supplementary_context: {
          ...existingContext,
          additional_text: parsedDoc.text,
          added_at: new Date().toISOString(),
          source_file: {
            filename: parsedDoc.filename,
            file_type: parsedDoc.file_type,
            uploaded_at: parsedDoc.parsed_at,
          },
        },
      };

      await updateDocument(documentId, {
        ...document,
        pages,
      });

      logger.info('File context added to document page', {
        document_id: documentId,
        page_id: pageId,
        filename: parsedDoc.filename,
        file_type: parsedDoc.file_type,
        text_length: parsedDoc.text.length,
      });

      res.json({
        message: 'File context added successfully',
        page_id: pageId,
        filename: parsedDoc.filename,
        file_type: parsedDoc.file_type,
        text_length: parsedDoc.text.length,
      });
    } catch (error) {
      // Clean up uploaded file on error
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      next(error);
    }
  });

  // Start test generation for a document (with optional context)
  router.post('/:documentId/generate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId } = req.params;

      const document = await getDocument(documentId);
      if (!document) {
        throw new ApiError(`Document not found: ${documentId}`, 404);
      }

      if (document.status === 'generating') {
        throw new ApiError('Generation already in progress', 400);
      }

      const totalPages = document.pages?.length || 0;
      if (totalPages === 0) {
        throw new ApiError('Document has no detected pages to generate tests for', 400);
      }

      // Return immediately with 202 Accepted
      res.status(202).json({
        message: 'Test generation started',
        document_id: documentId,
        pages_count: totalPages,
        modules_count: totalPages,
      });

      // Start generation in background
      generateTestsForDocument(documentId, jiraConfig)
        .then(async (result) => {
          await saveGenerationResult(result);
          logger.info('Document test generation completed', {
            document_id: documentId,
            total_scenarios: result.total_scenarios,
          });
        })
        .catch((error) => {
          logger.error('Document test generation failed', {
            document_id: documentId,
            error: error.message,
          });
        });
    } catch (error) {
      next(error);
    }
  });

  // Get all scenarios for a document
  router.get('/:documentId/scenarios', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId } = req.params;
      const { status } = req.query;

      const document = await getDocument(documentId);
      if (!document) {
        throw new ApiError(`Document not found: ${documentId}`, 404);
      }

      // Get generation result to find job_ids
      const generationResult = await getGenerationResult(documentId);
      if (!generationResult) {
        res.json({
          document_id: documentId,
          total_scenarios: 0,
          scenarios: [],
        });
        return;
      }

      // Fetch scenarios from all jobs
      const { getJob } = await import('../../storage/job-store');
      const allScenarios: any[] = [];

      for (const jobId of generationResult.job_ids) {
        const job = await getJob(jobId);
        if (job && job.results?.scenarios) {
          for (const scenario of job.results.scenarios) {
            // Add module info from job input
            allScenarios.push({
              ...scenario,
              job_id: jobId,
              module_name: job.input.title || 'Unknown module',
            });
          }
        }
      }

      // Filter by validation status if specified
      let filteredScenarios = allScenarios;
      if (status === 'validated') {
        filteredScenarios = allScenarios.filter(s => s.validation_status === 'validated');
      } else if (status === 'needs_review') {
        filteredScenarios = allScenarios.filter(s => s.validation_status === 'needs_review');
      }

      res.json({
        document_id: documentId,
        total_scenarios: filteredScenarios.length,
        validated_count: allScenarios.filter(s => s.validation_status === 'validated').length,
        needs_review_count: allScenarios.filter(s => s.validation_status === 'needs_review').length,
        scenarios: filteredScenarios,
      });
    } catch (error) {
      next(error);
    }
  });

  // Get jobs for a document
  router.get('/:documentId/jobs', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId } = req.params;
      const { limit = '50', offset = '0' } = req.query;

      const document = await getDocument(documentId);
      if (!document) {
        throw new ApiError(`Document not found: ${documentId}`, 404);
      }

      const limitNum = parseInt(limit as string, 10);
      const offsetNum = parseInt(offset as string, 10);

      // Get all jobs and filter by document_id
      const { jobs: allJobs } = await listJobs(undefined, { limit: 500, offset: 0 });

      // We need to check full job data for document_id
      const { getJob } = await import('../../storage/job-store');
      const documentJobs = [];

      for (const jobSummary of allJobs) {
        const fullJob = await getJob(jobSummary.job_id);
        if (fullJob && fullJob.document_id === documentId) {
          documentJobs.push(jobSummary);
        }
      }

      const total = documentJobs.length;
      const paginatedJobs = documentJobs.slice(offsetNum, offsetNum + limitNum);

      res.json({
        total,
        limit: limitNum,
        offset: offsetNum,
        jobs: paginatedJobs,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default createDocumentsRoute;
