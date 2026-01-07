import ConfluenceAPI from 'confluence.js';
import { SpecificationInput } from '../models/specification-input';
import { ConfluenceConfig } from '../models/config';
import { extractTextFromConfluence } from '../utils/html-parser';
import { retryWithBackoff, isRetryableError } from '../utils/retry-handler';
import logger from '../utils/logger';

const confluenceUrl = process.env.CONFLUENCE_BASE_URL;
const confluenceEmail = process.env.CONFLUENCE_EMAIL;
const confluenceToken = process.env.CONFLUENCE_API_TOKEN;

if (!confluenceUrl || !confluenceEmail || !confluenceToken) {
  logger.error('Confluence credentials not configured');
}

const confluence = new ConfluenceAPI({
  host: confluenceUrl || '',
  authentication: {
    basic: {
      email: confluenceEmail || '',
      apiToken: confluenceToken || '',
    },
  },
});

export async function fetchConfluencePage(pageId: string): Promise<SpecificationInput | null> {
  logger.debug('Fetching Confluence page', { page_id: pageId });

  try {
    const page = await retryWithBackoff(
      async () => {
        return await confluence.content.getById({
          id: pageId,
          expand: ['body.storage', 'version'],
        });
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        exponentialBackoff: true,
      }
    );

    logger.log('silly', 'Confluence page fetched', {
      page_id: pageId,
      title: page.title,
      version: page.version?.number,
      body: page.body?.storage?.value,
    });

    const bodyContent = page.body?.storage?.value || '';
    const extractedText = extractTextFromConfluence(bodyContent);

    const specificationInput: SpecificationInput = {
      title: page.title || '',
      description: extractedText,
      acceptance_criteria: extractedText,
      metadata: {
        system_type: 'web',
        feature_priority: 'medium',
        parent_jira_issue_id: 'UNKNOWN',
      },
      confluence_page_id: pageId,
      confluence_version: page.version?.number?.toString(),
    };

    logger.info('Confluence page processed', {
      page_id: pageId,
      title: page.title,
      version: page.version?.number,
    });

    return specificationInput;
  } catch (error) {
    logger.error('Failed to fetch Confluence page', {
      page_id: pageId,
      error: (error as Error).message,
    });
    return null;
  }
}

export async function searchConfluencePages(
  config: ConfluenceConfig,
  updatedSince?: Date
): Promise<string[]> {
  logger.debug('Searching Confluence pages', {
    monitored_spaces: config.monitored_spaces,
    updated_since: updatedSince?.toISOString(),
  });

  const pageIds: string[] = [];

  try {
    for (const spaceKey of config.monitored_spaces) {
      const cql = buildCQL(spaceKey, config, updatedSince);

      logger.debug('Executing Confluence CQL search', { space_key: spaceKey, cql });

      const searchResult = await confluence.contentSearch.searchByCQL({
        cql,
        limit: 100,
      });

      const results = searchResult.results || [];
      const ids = results.map((r: any) => r.content?.id).filter((id: string) => id);

      pageIds.push(...ids);

      logger.info('Confluence search completed for space', {
        space_key: spaceKey,
        page_count: ids.length,
      });
    }

    return pageIds;
  } catch (error) {
    logger.error('Failed to search Confluence pages', {
      error: (error as Error).message,
    });
    return [];
  }
}

function buildCQL(spaceKey: string, config: ConfluenceConfig, updatedSince?: Date): string {
  let cql = `space = ${spaceKey} AND type = page`;

  if (config.page_filters?.include_labels && config.page_filters.include_labels.length > 0) {
    const labels = config.page_filters.include_labels.map(l => `label = "${l}"`).join(' OR ');
    cql += ` AND (${labels})`;
  }

  if (config.page_filters?.exclude_labels && config.page_filters.exclude_labels.length > 0) {
    const excludeLabels = config.page_filters.exclude_labels.map(l => `label != "${l}"`).join(' AND ');
    cql += ` AND (${excludeLabels})`;
  }

  if (updatedSince) {
    const isoDate = updatedSince.toISOString().split('T')[0];
    cql += ` AND lastmodified >= "${isoDate}"`;
  }

  return cql;
}
