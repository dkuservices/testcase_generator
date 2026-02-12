/**
 * Override options for scenario planning - allows human to specify
 * desired number and types of scenarios instead of AI decision
 */
export interface ScenarioOverride {
  count?: number;  // Number of scenarios to generate
  types?: ('happy_path' | 'negative' | 'edge_case')[];  // Specific types to generate
}

export interface SpecificationInput {
  // New link-based input
  link?: string;

  // Original fields - now optional when link is provided
  title?: string;
  description?: string;
  acceptance_criteria?: string;
  metadata?: {
    system_type: 'web' | 'api' | 'mobile';
    feature_priority: 'critical' | 'high' | 'medium' | 'low';
    parent_jira_issue_id: string;
  };
  confluence_page_id?: string;
  confluence_version?: string;

  // Supplementary context - additional information for test generation
  supplementary_context?: {
    confluence_links?: string[];
    additional_text?: string;
    added_at?: string;
  };

  // Scenario planning override - allows human to specify instead of AI decision
  scenario_override?: ScenarioOverride;
}

export interface NormalizedInput {
  normalized_text: string;
  metadata: {
    system_type: 'web' | 'api' | 'mobile';
    feature_priority: 'critical' | 'high' | 'medium' | 'low';
    parent_jira_issue_id: string;
  };
  original_input: SpecificationInput;
  scenario_override?: ScenarioOverride;
}
