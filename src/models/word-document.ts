/**
 * Word Document Processing Models
 * For change request document test generation
 */

export interface DocumentSection {
  heading: string;
  level: number;
  content: string;
  subsections: DocumentSection[];
}

export interface ChangeRequest {
  id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  affected_areas: string[];
}

export interface DocumentPage {
  module_id: string;
  page_id: string;
  name: string;
  description: string;
  change_requests: ChangeRequest[];
  priority: 'critical' | 'high' | 'medium' | 'low';
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

export interface DocumentModuleInfo {
  module_id: string;
  name: string;
  description?: string;
  component_id: string;
  page_ids: string[];
}

export interface ParsedWordDocument {
  document_id: string;
  filename: string;
  parsed_at: string;
  sections: DocumentSection[];
  pages: DocumentPage[];
  module?: DocumentModuleInfo;
  raw_text: string;
  status: 'uploaded' | 'parsed' | 'pages_detected' | 'awaiting_manual' | 'awaiting_context' | 'generating' | 'completed' | 'failed';
  error?: string;

  // Document-level supplementary context (manual/handbook for entire project)
  project_context?: {
    manual_text?: string;
    manual_file?: {
      filename: string;
      file_type: 'docx' | 'pdf' | 'txt';
      uploaded_at: string;
      stored_path?: string; // Path to permanently stored file
    };
    added_at?: string;
    // Chunking info for large manuals
    is_chunked?: boolean;
    chunking_info?: {
      total_chunks: number;
      total_tokens: number;
      chunked_at: string;
    };
  };
}

export interface CoveragePlan {
  document_id: string;
  total_tests_planned: number;
  modules: ModuleCoveragePlan[];
  created_at: string;
}

export interface ModuleCoveragePlan {
  module_id: string;
  module_name: string;
  tests_planned: number;
  test_distribution: {
    happy_path: number;
    negative: number;
    edge_case: number;
  };
  change_requests_covered: string[];
}

export interface DocumentGenerationResult {
  document_id: string;
  total_scenarios: number;
  validated_scenarios: number;
  needs_review_scenarios: number;
  modules_processed: number;
  job_ids: string[];
  completed_at: string;
}
