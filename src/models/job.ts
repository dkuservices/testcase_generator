import { SpecificationInput } from './specification-input';
import { GeneratedTestScenario } from './test-scenario';

export interface Job {
  job_id: string;
  status: 'processing' | 'completed' | 'failed';
  input: SpecificationInput;
  created_at: string;
  completed_at?: string;
  results?: JobResults;
  error?: string;
  batch_job_id?: string; // Link to parent batch if part of batch processing
  // Hierarchy references for project structure
  project_id?: string;
  component_id?: string;
  page_id?: string;
  document_id?: string; // Link to Word document if generated from document
}

export interface JobResults {
  total_scenarios: number;
  validated_scenarios: number;
  needs_review_scenarios: number;
  scenarios: GeneratedTestScenario[];
}

export interface JobSummary {
  job_id: string;
  status: 'processing' | 'completed' | 'failed';
  parent_jira_issue_id: string;
  created_at: string;
  completed_at?: string;
  scenario_count?: number;
}
