/**
 * Structured test step matching TestFlo Jira template format
 * Each step has: Action (what to do), Input (data/parameters), Expected Result
 */
export interface TestStep {
  step_number: number;
  action: string;           // What to do (e.g., "Navigovať na stránku")
  input: string;            // Data/parameters for the action (can be empty)
  expected_result: string;  // Expected outcome for THIS step
}

/**
 * Raw output structure from LLM - matches new TestFlo format
 */
export interface LLMTestScenarioOutput {
  test_name: string;
  description: string;      // Goal/objective ("Cieľ") - what this test verifies
  test_type: 'functional' | 'regression' | 'smoke';
  scenario_classification: 'happy_path' | 'negative' | 'edge_case';
  preconditions: string[];  // Array of prerequisite items (bulleted list)
  test_steps: TestStep[];   // Structured steps with action/input/expected_result
  priority: 'critical' | 'high' | 'medium' | 'low';
  automation_status: 'ready_for_automation' | 'automation_not_needed';
  test_repository_folder: string; // Suggested folder path (e.g., "KIS2/ORG Struktura")
}

/**
 * Validation detail for auto-correction metadata
 */
export interface ValidationDetail {
  type: 'auto_correction_needed' | 'warning' | 'info';
  severity: 'critical' | 'high' | 'medium' | 'low';
  ratio?: number;
  problematic_steps?: number[];
  message?: string;
}

/**
 * Enriched test scenario with metadata and validation status
 */
export interface GeneratedTestScenario extends LLMTestScenarioOutput {
  test_id: string;
  tags: string[];
  parent_jira_issue_id: string;
  traceability: {
    source_confluence_page_id: string;
    source_specification_version: string;
    generated_at: string;
    llm_model: string;
  };
  validation_status: 'validated' | 'needs_review' | 'failed' | 'dismissed';
  validation_notes?: string | ValidationDetail[];
}
