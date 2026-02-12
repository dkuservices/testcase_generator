/**
 * Project model - top level of the hierarchy
 * A project contains multiple components
 */

import { GeneratedTestScenario } from './test-scenario';

export interface ProjectContext {
  manual_text?: string;
  manual_file?: {
    filename: string;
    file_type: 'docx' | 'pdf' | 'txt';
    uploaded_at: string;
    stored_path?: string;
  };
  added_at?: string;
  is_chunked?: boolean;
  chunking_info?: {
    total_chunks: number;
    total_tokens: number;
    chunked_at: string;
  };
}

export interface ProjectTests {
  batch_job_id?: string;
  scenarios: GeneratedTestScenario[];
  generated_at?: string;
}

export interface Project {
  project_id: string;
  name: string;
  description?: string;
  component_ids: string[];
  created_at: string;
  updated_at: string;
  metadata?: ProjectMetadata;
  project_tests?: ProjectTests;
  project_context?: ProjectContext;
}

export interface ProjectMetadata {
  jira_project_key?: string;
  system_type?: 'web' | 'api' | 'mobile';
  // Document-based project metadata
  source_type?: 'manual' | 'document';
  document_id?: string;
  document_filename?: string;
}

export interface ProjectSummary {
  project_id: string;
  name: string;
  description?: string;
  component_count: number;
  total_pages: number;
  total_tests: number;
  project_level_tests: number;
  created_at: string;
  updated_at: string;
  source_type?: 'manual' | 'document';
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  metadata?: ProjectMetadata;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  metadata?: ProjectMetadata;
}
