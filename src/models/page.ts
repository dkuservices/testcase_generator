/**
 * Page model - bottom level of the hierarchy
 * A page belongs to a component and represents a Confluence page
 * Page-level tests (smaller tests) are linked through jobs
 */

export interface PageDependency {
  page_id: string;
  page_name?: string;
  relationship?: 'uses' | 'used_by' | 'collaborates';
  notes?: string;
}

export interface Page {
  page_id: string;
  component_id: string;
  project_id: string;
  confluence_link: string;
  confluence_page_id?: string;
  name: string;
  created_at: string;
  updated_at: string;

  // Dependencies - other pages this one works with
  dependencies?: PageDependency[];

  // Test generation tracking
  latest_job_id?: string;
  job_history: string[];

  // Cached test summary
  test_summary?: PageTestSummary;

  source_type?: 'confluence' | 'document';
  document_id?: string;
  document_page_id?: string;

  // Supplementary context for test generation
  supplementary_context?: {
    confluence_links?: string[];
    additional_text?: string;
    added_at?: string;
    source_file?: {
      filename: string;
      file_type: 'docx' | 'pdf' | 'txt';
      uploaded_at: string;
    };
  };
}

export interface PageTestSummary {
  total_scenarios: number;
  validated: number;
  needs_review: number;
  last_generated: string;
}

export interface PageSummary {
  page_id: string;
  component_id: string;
  project_id: string;
  name: string;
  confluence_link: string;
  latest_job_status?: 'processing' | 'completed' | 'failed';
  test_count: number;
  last_generated?: string;
  dependencies?: PageDependency[];
  source_type?: 'confluence' | 'document';
}

export interface CreatePageInput {
  confluence_link: string;
  name?: string; // Optional - can be auto-extracted from Confluence
}

export interface UpdatePageInput {
  name?: string;
  confluence_link?: string;
  dependencies?: PageDependency[];
  supplementary_context?: {
    confluence_links?: string[];
    additional_text?: string;
    added_at?: string;
    source_file?: {
      filename: string;
      file_type: 'docx' | 'pdf' | 'txt';
      uploaded_at: string;
    };
  };
}
