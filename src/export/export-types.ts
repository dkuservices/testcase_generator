import { GeneratedTestScenario } from '../models/test-scenario';

export type ExportStatus = 'validated' | 'needs_review' | 'dismissed';

export interface ExportOptions {
  statuses: ExportStatus[];
  jobId?: string;
}

export interface ExportScenarioEntry {
  job_id: string;
  job_created_at: string;
  job_completed_at?: string;
  source_title?: string;
  source_link?: string;
  confluence_page_id?: string;
  parent_jira_issue_id?: string;
  scenario: GeneratedTestScenario;
}

export const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'FDECEA', text: 'D94841' },
  high: { bg: 'FDECEA', text: 'D94841' },
  medium: { bg: 'FDF3E7', text: 'D97706' },
  low: { bg: 'E7F5EE', text: '0F766E' },
};

export const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  validated: { bg: 'E7F5EE', text: '0F766E' },
  needs_review: { bg: 'FDF3E7', text: 'D97706' },
  dismissed: { bg: 'F3F0ED', text: '7A6F65' },
};
