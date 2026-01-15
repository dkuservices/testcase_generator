export interface GeneratedTestScenario {
  test_id: string;
  test_name: string;
  test_type: 'functional' | 'regression' | 'smoke';
  scenario_classification: 'happy_path' | 'negative' | 'edge_case';
  preconditions: string;
  test_steps: string[];
  expected_result: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  tags: string[];
  parent_jira_issue_id: string;
  traceability: {
    source_confluence_page_id: string;
    source_specification_version: string;
    generated_at: string;
    llm_model: string;
  };
  validation_status: 'validated' | 'needs_review' | 'failed' | 'dismissed';
  validation_notes?: string;
}

export interface LLMTestScenarioOutput {
  test_name: string;
  test_type: 'functional' | 'regression' | 'smoke';
  scenario_classification: 'happy_path' | 'negative' | 'edge_case';
  preconditions: string;
  test_steps: string[];
  expected_result: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}
