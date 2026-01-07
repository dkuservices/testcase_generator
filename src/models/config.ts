export interface ExecutionModesConfig {
  scheduled: {
    enabled: boolean;
    cron_expression: string;
    description: string;
  };
  event_driven: {
    enabled: boolean;
    webhook_secret: string;
  };
  manual: {
    enabled: boolean;
    api_port: number;
    cors?: {
      enabled: boolean;
      origins: string[];
    };
  };
}

export interface ConfluenceConfig {
  monitored_spaces: string[];
  polling_interval_minutes: number;
  page_filters?: {
    include_labels?: string[];
    exclude_labels?: string[];
  };
  content_extraction?: {
    remove_comments: boolean;
    remove_attachments: boolean;
    remove_macros: boolean;
  };
}

export interface JiraConfig {
  project_key: string;
  test_issue_type: string;
  custom_field_mappings: {
    preconditions: string;
    test_steps: string;
    expected_result: string;
    parent_issue_link: string;
  };
  default_priority: string;
  auto_create_enabled: boolean;
}

export interface PricingConfig {
  [model: string]: {
    prompt_per_1k_tokens: number;
    completion_per_1k_tokens: number;
    last_updated: string;
  };
}

export interface AppConfig {
  executionModes: ExecutionModesConfig;
  confluence: ConfluenceConfig;
  jira: JiraConfig;
  pricing: PricingConfig;
}
