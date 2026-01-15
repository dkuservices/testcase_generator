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
}

export interface NormalizedInput {
  normalized_text: string;
  metadata: {
    system_type: 'web' | 'api' | 'mobile';
    feature_priority: 'critical' | 'high' | 'medium' | 'low';
    parent_jira_issue_id: string;
  };
  original_input: SpecificationInput;
}
