import path from 'path';
import { Page, PageSummary, CreatePageInput, UpdatePageInput, PageTestSummary } from '../models/page';
import { readJSON, writeJSON, fileExists, listFiles, deleteFile, ensureDirectoryExists } from './json-storage';
import { generateTestId } from '../utils/uuid-generator';
import { getJob } from './job-store';
import logger from '../utils/logger';

const PAGES_DIR = path.join(process.cwd(), 'data', 'pages');

export async function savePage(page: Page): Promise<void> {
  await ensureDirectoryExists(PAGES_DIR);
  const filePath = path.join(PAGES_DIR, `${page.page_id}.json`);
  await writeJSON(filePath, page);
  logger.debug('Page saved', { page_id: page.page_id, name: page.name });
}

export async function createPage(
  componentId: string,
  projectId: string,
  input: CreatePageInput
): Promise<Page> {
  const now = new Date().toISOString();

  // Extract Confluence page ID from the link
  const confluencePageId = extractConfluencePageId(input.confluence_link);

  const page: Page = {
    page_id: generateTestId(),
    component_id: componentId,
    project_id: projectId,
    confluence_link: input.confluence_link,
    confluence_page_id: confluencePageId,
    name: input.name || extractPageNameFromLink(input.confluence_link),
    created_at: now,
    updated_at: now,
    job_history: [],
    source_type: 'confluence',
  };

  await savePage(page);
  logger.info('Page created', {
    page_id: page.page_id,
    component_id: componentId,
    name: page.name,
  });
  return page;
}

export async function getPage(pageId: string): Promise<Page | null> {
  const filePath = path.join(PAGES_DIR, `${pageId}.json`);

  if (!(await fileExists(filePath))) {
    return null;
  }

  try {
    return await readJSON<Page>(filePath);
  } catch (error) {
    logger.error('Failed to read page', { page_id: pageId, error: (error as Error).message });
    return null;
  }
}

export async function updatePage(pageId: string, updates: UpdatePageInput): Promise<Page> {
  const page = await getPage(pageId);

  if (!page) {
    throw new Error(`Page not found: ${pageId}`);
  }

  const updatedPage: Page = {
    ...page,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  // If confluence_link changed, update the page ID extraction
  if (updates.confluence_link) {
    updatedPage.confluence_page_id = extractConfluencePageId(updates.confluence_link);
  }

  await savePage(updatedPage);
  logger.info('Page updated', { page_id: pageId });
  return updatedPage;
}

export async function deletePage(pageId: string): Promise<void> {
  const page = await getPage(pageId);

  if (!page) {
    throw new Error(`Page not found: ${pageId}`);
  }

  const filePath = path.join(PAGES_DIR, `${page.page_id}.json`);
  await deleteFile(filePath);
  logger.info('Page deleted', { page_id: pageId });
}

export async function addJobToPage(pageId: string, jobId: string): Promise<void> {
  const page = await getPage(pageId);

  if (!page) {
    throw new Error(`Page not found: ${pageId}`);
  }

  page.latest_job_id = jobId;
  if (!page.job_history.includes(jobId)) {
    page.job_history.push(jobId);
  }
  page.updated_at = new Date().toISOString();
  await savePage(page);
  logger.debug('Job added to page', { page_id: pageId, job_id: jobId });
}

export async function updatePageTestSummary(pageId: string): Promise<void> {
  const page = await getPage(pageId);

  if (!page) {
    throw new Error(`Page not found: ${pageId}`);
  }

  if (!page.latest_job_id) {
    return;
  }

  const job = await getJob(page.latest_job_id);

  if (!job || !job.results) {
    return;
  }

  const testSummary: PageTestSummary = {
    total_scenarios: job.results.total_scenarios,
    validated: job.results.validated_scenarios,
    needs_review: job.results.needs_review_scenarios,
    last_generated: job.completed_at || job.created_at,
  };

  page.test_summary = testSummary;
  page.updated_at = new Date().toISOString();
  await savePage(page);
  logger.debug('Page test summary updated', { page_id: pageId, summary: testSummary });
}

export async function listPagesByComponent(componentId: string): Promise<PageSummary[]> {
  await ensureDirectoryExists(PAGES_DIR);
  const files = await listFiles(PAGES_DIR, '.json');

  const pages: Page[] = [];
  for (const file of files) {
    const filePath = path.join(PAGES_DIR, file);
    try {
      const page = await readJSON<Page>(filePath);
      if (page.component_id === componentId) {
        pages.push(page);
      }
    } catch (error) {
      logger.warn('Failed to read page file', { file, error: (error as Error).message });
    }
  }

  // Sort by updated_at descending
  pages.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  // Calculate summaries
  const summaries: PageSummary[] = await Promise.all(
    pages.map(async page => {
      let latestJobStatus: 'processing' | 'completed' | 'failed' | 'cancelled' | undefined;
      let testCount = 0;

      if (page.latest_job_id) {
        const job = await getJob(page.latest_job_id);
        if (job) {
          latestJobStatus = job.status;
          testCount = job.results?.total_scenarios || 0;
        }
      }

      return {
        page_id: page.page_id,
        component_id: page.component_id,
        project_id: page.project_id,
        name: page.name,
        confluence_link: page.confluence_link,
        source_type: page.source_type,
        latest_job_status: latestJobStatus,
        test_count: page.test_summary?.total_scenarios || testCount,
        last_generated: page.test_summary?.last_generated,
        dependencies: page.dependencies,
      };
    })
  );

  return summaries;
}

export async function getPageByConfluenceLink(link: string): Promise<Page | null> {
  await ensureDirectoryExists(PAGES_DIR);
  const files = await listFiles(PAGES_DIR, '.json');

  for (const file of files) {
    const filePath = path.join(PAGES_DIR, file);
    try {
      const page = await readJSON<Page>(filePath);
      if (page.confluence_link === link) {
        return page;
      }
    } catch (error) {
      logger.warn('Failed to read page file', { file, error: (error as Error).message });
    }
  }

  return null;
}

/**
 * Extract Confluence page ID from a URL
 */
function extractConfluencePageId(url: string): string | undefined {
  // Match patterns like /pages/123456 or /pages/123456/title
  const pageIdMatch = url.match(/\/pages\/(\d+)/);
  if (pageIdMatch) {
    return pageIdMatch[1];
  }
  return undefined;
}

/**
 * Extract a readable page name from a Confluence URL
 */
function extractPageNameFromLink(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);

    // Look for the last path segment that looks like a page title
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const part = pathParts[i];
      // Skip numeric-only segments (page IDs)
      if (/^\d+$/.test(part)) {
        continue;
      }
      // Skip common Confluence path segments
      if (['wiki', 'spaces', 'pages', 'display'].includes(part.toLowerCase())) {
        continue;
      }
      // Decode and clean up the title
      return decodeURIComponent(part)
        .replace(/[+_-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  } catch {
    // URL parsing failed
  }

  return 'Unnamed Page';
}
