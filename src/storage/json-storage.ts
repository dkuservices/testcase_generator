import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';

export async function readJSON<T>(filePath: string): Promise<T> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch (error) {
    logger.error(`Failed to read JSON file: ${filePath}`, { error: (error as Error).message });
    throw error;
  }
}

export async function writeJSON<T>(filePath: string, data: T): Promise<void> {
  try {
    const dir = path.dirname(filePath);
    await ensureDirectoryExists(dir);

    const jsonData = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, jsonData, 'utf-8');

    logger.debug(`JSON file written successfully: ${filePath}`);
  } catch (error) {
    logger.error(`Failed to write JSON file: ${filePath}`, { error: (error as Error).message });
    throw error;
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
    logger.debug(`File deleted: ${filePath}`);
  } catch (error) {
    logger.error(`Failed to delete file: ${filePath}`, { error: (error as Error).message });
    throw error;
  }
}

export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    logger.error(`Failed to create directory: ${dirPath}`, { error: (error as Error).message });
    throw error;
  }
}

export async function listFiles(dirPath: string, extension?: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dirPath);

    if (extension) {
      return files.filter(file => file.endsWith(extension));
    }

    return files;
  } catch (error) {
    logger.error(`Failed to list files in directory: ${dirPath}`, { error: (error as Error).message });
    throw error;
  }
}
