/**
 * Component model - middle level of the hierarchy
 * A component belongs to a project and contains multiple pages
 * Component-level tests (integration tests) are stored here
 */

import { GeneratedTestScenario } from './test-scenario';

export interface ComponentDependency {
  component_id: string;
  component_name?: string;
  relationship?: 'uses' | 'used_by' | 'collaborates';
  notes?: string;
}

export interface ChangeRequestInfo {
  id: string;
  title: string;
  description?: string;
  acceptance_criteria?: string[];
}

export interface Component {
  component_id: string;
  project_id: string;
  name: string;
  description?: string;
  page_ids: string[];
  created_at: string;
  updated_at: string;

  // Dependencies - other components this one works with
  dependencies?: ComponentDependency[];

  // Component-level integration tests
  component_tests?: ComponentTests;

  // Document module metadata (when created from Word document)
  source_module_id?: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  change_requests?: ChangeRequestInfo[];
}

export interface ComponentTests {
  batch_job_id?: string;
  scenarios: GeneratedTestScenario[];
  generated_at?: string;
}

export interface ComponentSummary {
  component_id: string;
  project_id: string;
  name: string;
  description?: string;
  page_count: number;
  page_level_tests: number;
  component_level_tests: number;
  created_at: string;
  updated_at: string;
}

export interface CreateComponentInput {
  name: string;
  description?: string;
}

export interface UpdateComponentInput {
  name?: string;
  description?: string;
}
