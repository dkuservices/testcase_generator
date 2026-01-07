declare module 'jira-client' {
  interface JiraClientOptions {
    protocol: string;
    host: string;
    username: string;
    password: string;
    apiVersion: string;
    strictSSL: boolean;
  }

  interface JiraIssue {
    id: string;
    key: string;
    fields?: {
      summary?: string;
      [key: string]: any;
    };
  }

  class JiraClient {
    constructor(options: JiraClientOptions);
    addNewIssue(issue: any): Promise<JiraIssue>;
    findIssue(issueKey: string): Promise<JiraIssue>;
    getCurrentUser(): Promise<any>;
  }

  export = JiraClient;
}
