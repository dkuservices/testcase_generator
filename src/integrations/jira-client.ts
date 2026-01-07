import JiraClient from 'jira-client';
import { retryWithBackoff } from '../utils/retry-handler';
import logger from '../utils/logger';

const jiraHost = process.env.JIRA_BASE_URL?.replace(/^https?:\/\//, '') || '';
const jiraEmail = process.env.JIRA_EMAIL;
const jiraToken = process.env.JIRA_API_TOKEN;

if (!jiraHost || !jiraEmail || !jiraToken) {
  logger.error('Jira credentials not configured');
}

const jira = new JiraClient({
  protocol: 'https',
  host: jiraHost,
  username: jiraEmail || '',
  password: jiraToken || '',
  apiVersion: '3',
  strictSSL: true,
});

export async function createJiraIssue(issueData: any): Promise<string | null> {
  logger.debug('Creating Jira issue', { summary: issueData.fields?.summary });

  try {
    const issue = await retryWithBackoff(
      async () => {
        return await jira.addNewIssue(issueData);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        exponentialBackoff: true,
      }
    );

    logger.info('Jira issue created', {
      issue_key: issue.key,
      issue_id: issue.id,
    });

    return issue.key;
  } catch (error) {
    logger.error('Failed to create Jira issue', {
      error: (error as Error).message,
      summary: issueData.fields?.summary,
    });
    return null;
  }
}

export async function getJiraIssue(issueKey: string): Promise<any | null> {
  logger.debug('Fetching Jira issue', { issue_key: issueKey });

  try {
    const issue = await retryWithBackoff(
      async () => {
        return await jira.findIssue(issueKey);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        exponentialBackoff: true,
      }
    );

    logger.debug('Jira issue fetched', {
      issue_key: issueKey,
      summary: issue.fields?.summary,
    });

    return issue;
  } catch (error) {
    logger.error('Failed to fetch Jira issue', {
      issue_key: issueKey,
      error: (error as Error).message,
    });
    return null;
  }
}

export async function validateJiraConnection(): Promise<boolean> {
  try {
    await jira.getCurrentUser();
    logger.info('Jira connection validated successfully');
    return true;
  } catch (error) {
    logger.error('Jira connection validation failed', {
      error: (error as Error).message,
    });
    return false;
  }
}
