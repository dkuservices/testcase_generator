import { GeneratedTestScenario } from './test-scenario';

export interface BatchJob {
  batch_job_id: string;
  status: 'processing' | 'completed' | 'failed' | 'partial';
  options: BatchJobOptions;
  sub_jobs: string[]; // Array of individual job_ids
  created_at: string;
  completed_at?: string;
  aggregation_results?: AggregationResults;
  error?: string;
}

export interface BatchJobOptions {
  links: string[]; // Array of Confluence URLs
  generate_page_level_tests: boolean;
  generate_module_level_tests: boolean;
}

export interface AggregationResults {
  total_pages: number;
  total_scenarios: number;
  deduplicated_count: number;
  module_level_scenarios: GeneratedTestScenario[];
  summary: BatchSummary;
}

export interface BatchSummary {
  pages_processed: string[]; // Page IDs
  coverage_stats: {
    total_happy_path: number;
    total_negative: number;
    total_edge_case: number;
    total_validated: number;
    total_needs_review: number;
  };
  module_overview: {
    feature_list: string[];
    integration_points: string[];
    workflow_count: number;
  };
  generated_at: string;
}

export interface BatchJobSummary {
  batch_job_id: string;
  status: 'processing' | 'completed' | 'failed' | 'partial';
  total_pages: number;
  completed_pages: number;
  created_at: string;
  completed_at?: string;
}

// For deduplication tracking
export interface ScenarioWithSource {
  scenario: GeneratedTestScenario;
  source_page_id: string;
  source_job_id: string;
  source_page_name?: string;
}

export interface DuplicateGroup {
  kept_scenario: ScenarioWithSource;
  duplicates: ScenarioWithSource[];
  similarity_score: number;
}
