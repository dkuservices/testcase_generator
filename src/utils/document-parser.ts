/**
 * Document parser for extracting text from docx and pdf files
 */

import mammoth from 'mammoth';
import fs from 'fs/promises';
import logger from './logger';

// pdf-parse requires CommonJS import
const pdfParse = require('pdf-parse');

export interface ParsedDocument {
  text: string;
  filename: string;
  file_type: 'docx' | 'pdf' | 'txt';
  parsed_at: string;
}

/**
 * Parse a docx file and extract text content
 */
export async function parseDocx(filePath: string): Promise<string> {
  try {
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });

    logger.info('Successfully parsed docx file', {
      file_path: filePath,
      text_length: result.value.length,
    });

    return result.value.trim();
  } catch (error) {
    logger.error('Failed to parse docx file', {
      file_path: filePath,
      error: (error as Error).message,
    });
    throw new Error(`Failed to parse docx file: ${(error as Error).message}`);
  }
}

/**
 * Parse a pdf file and extract text content
 */
export async function parsePdf(filePath: string): Promise<string> {
  try {
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);

    logger.info('Successfully parsed pdf file', {
      file_path: filePath,
      text_length: data.text.length,
      pages: data.numpages,
    });

    return data.text.trim();
  } catch (error) {
    logger.error('Failed to parse pdf file', {
      file_path: filePath,
      error: (error as Error).message,
    });
    throw new Error(`Failed to parse pdf file: ${(error as Error).message}`);
  }
}

/**
 * Parse a text file
 */
export async function parseTextFile(filePath: string): Promise<string> {
  try {
    const text = await fs.readFile(filePath, 'utf-8');

    logger.info('Successfully read text file', {
      file_path: filePath,
      text_length: text.length,
    });

    return text.trim();
  } catch (error) {
    logger.error('Failed to read text file', {
      file_path: filePath,
      error: (error as Error).message,
    });
    throw new Error(`Failed to read text file: ${(error as Error).message}`);
  }
}

/**
 * Parse a document based on its file extension
 */
export async function parseDocument(filePath: string, filename: string): Promise<ParsedDocument> {
  const extension = filename.toLowerCase().split('.').pop();

  let text: string;
  let file_type: 'docx' | 'pdf' | 'txt';

  switch (extension) {
    case 'docx':
      text = await parseDocx(filePath);
      file_type = 'docx';
      break;
    case 'pdf':
      text = await parsePdf(filePath);
      file_type = 'pdf';
      break;
    case 'txt':
      text = await parseTextFile(filePath);
      file_type = 'txt';
      break;
    default:
      throw new Error(`Unsupported file type: ${extension}. Supported types: docx, pdf, txt`);
  }

  return {
    text,
    filename,
    file_type,
    parsed_at: new Date().toISOString(),
  };
}

/**
 * Validate file type
 */
export function isValidFileType(filename: string): boolean {
  const extension = filename.toLowerCase().split('.').pop();
  return ['docx', 'pdf', 'txt'].includes(extension || '');
}

/**
 * Get file size in MB
 */
export async function getFileSizeMB(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  return stats.size / (1024 * 1024);
}
