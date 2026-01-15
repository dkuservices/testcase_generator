/**
 * Utility functions for parsing Confluence URLs and extracting page IDs
 */

export interface ConfluenceUrlInfo {
  pageId: string;
  baseUrl: string;
  spaceKey?: string;
  pageTitle?: string;
}

/**
 * Extracts page ID from various Confluence URL formats
 * Supports formats like:
 * - https://domain.atlassian.net/wiki/spaces/SPACE/pages/123456/Page+Title
 * - https://domain.atlassian.net/wiki/pages/123456
 * - https://domain.atlassian.net/wiki/display/SPACE/Page+Title?pageId=123456
 */
/**
 * Extracts page ID from various Confluence URL formats
 * Now supports self-hosted Confluence without /wiki/ prefix
 */
export function extractPageIdFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);

    // Format 1: /wiki/spaces/SPACE/pages/123456/Page+Title (Atlassian Cloud)
    const cloudMatch = urlObj.pathname.match(/\/wiki\/spaces\/[^\/]+\/pages\/(\d+)/);
    if (cloudMatch) {
      return cloudMatch[1];
    }

    // Format 2: /spaces/SPACE/pages/123456/Page+Title (Self-hosted - YOUR FORMAT)
    const selfHostedMatch = urlObj.pathname.match(/\/spaces\/[^\/]+\/pages\/(\d+)/);
    if (selfHostedMatch) {
      return selfHostedMatch[1];
    }

    // Format 3: /wiki/pages/123456 (Legacy Cloud format)
    const legacyMatch = urlObj.pathname.match(/\/wiki\/pages\/(\d+)/);
    if (legacyMatch) {
      return legacyMatch[1];
    }

    // Format 4: pageId parameter in query string (?pageId=123456)
    const pageIdParam = urlObj.searchParams.get('pageId');
    if (pageIdParam && /^\d+$/.test(pageIdParam)) {
      return pageIdParam;
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Validates if a URL is a valid Confluence URL
 * Accepts both Atlassian Cloud and self-hosted Confluence instances
 */
export function isValidConfluenceUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);

    // Must be able to extract a page ID (this now supports self-hosted format)
    const hasPageId = extractPageIdFromUrl(url) !== null;

    if (!hasPageId) {
      return false; // No valid page ID = definitely invalid
    }

    const hasSpacesPath = urlObj.pathname.includes('/spaces/');
    const hasPageIdParam = urlObj.searchParams.has('pageId');

    return hasPageId && (hasSpacesPath || hasPageIdParam);
  } catch (error) {
    return false;
  }
}


/**
 * Parses a Confluence URL and extracts detailed information
 */
export function parseConfluenceUrl(url: string): ConfluenceUrlInfo | null {
  try {
    const urlObj = new URL(url);
    const pageId = extractPageIdFromUrl(url);
    
    if (!pageId) {
      return null;
    }
    
    // Extract base URL (protocol + host + /wiki)
    const baseUrl = `${urlObj.protocol}//${urlObj.host}/wiki`;
    
    // Try to extract space key and page title
    const spacePagesMatch = urlObj.pathname.match(/\/wiki\/spaces\/([^\/]+)\/pages\/\d+\/(.+)/);
    let spaceKey: string | undefined;
    let pageTitle: string | undefined;
    
    if (spacePagesMatch) {
      spaceKey = spacePagesMatch[1];
      pageTitle = decodeURIComponent(spacePagesMatch[2].replace(/\+/g, ' '));
    }
    
    return {
      pageId,
      baseUrl,
      spaceKey,
      pageTitle
    };
  } catch (error) {
    return null;
  }
}

