# AI Orchestrator – Module 4.1

Internal service that automatically generates structured test scenarios from Confluence product specifications and prepares them for Jira Test Case creation.

## Overview

This module transforms requirements into high-quality, human-readable test scenarios using AI assistance, with strict validation to ensure traceability and quality.

**Key Principles:**
- Does **NOT** generate automated test code
- Does **NOT** modify existing Jira test cases
- Does **NOT** invent or extend business logic beyond input specifications
- **ALL** outputs are auditable and traceable

## Features

- **5-Step Processing Pipeline**: Input normalization → Prompt building → LLM invocation → Validation → Jira preparation
- **Multiple Execution Modes**: Manual (REST API), Scheduled (Cron), Event-driven (Webhooks)
- **Comprehensive Validation**: Ensures generated scenarios are traceable and don't introduce new functionality
- **Cost Tracking**: Daily OpenAI API usage reports with cost estimation
- **Metrics Collection**: Performance monitoring and success rate tracking
- **Phase 1 Storage**: Local JSON files for debugging and validation

## Prerequisites

- **Node.js**: 18.0.0 or higher
- **npm**: 9.0.0 or higher
- **API Tokens**:
  - OpenAI API key
  - Confluence API token
  - Jira API token

## Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd testcase_generator
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create environment file:**
   ```bash
   cp .env.example .env
   ```

4. **Configure environment variables** (edit `.env`):
   ```bash
   # Service Configuration
   NODE_ENV=development
   PORT=3000
   LOG_LEVEL=trace

   # Confluence API
   CONFLUENCE_BASE_URL=https://your-domain.atlassian.net/wiki
   CONFLUENCE_EMAIL=your-email@company.com
   CONFLUENCE_API_TOKEN=your-confluence-api-token

   # OpenAI API
   OPENAI_API_KEY=sk-your-openai-api-key
   OPENAI_MODEL=gpt-4-turbo
   OPENAI_TEMPERATURE=0.2
   OPENAI_MAX_TOKENS=3000

   # Jira API
   JIRA_BASE_URL=https://your-domain.atlassian.net
   JIRA_EMAIL=your-email@company.com
   JIRA_API_TOKEN=your-jira-api-token
   JIRA_PROJECT_KEY=PROJ
   ```

5. **Update configuration files** in `config/` directory:
   - `execution-modes.json` - Enable/disable execution modes
   - `confluence.json` - Configure monitored Confluence spaces
   - `jira.json` - Configure Jira custom field mappings
   - `pricing.json` - Update OpenAI pricing (if changed)

## Configuration Guide

### Getting API Tokens

**Confluence API Token:**
1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Give it a label (e.g., "AI Orchestrator")
4. Copy the token to `CONFLUENCE_API_TOKEN` in `.env`

**Jira API Token:**
1. Same process as Confluence (Atlassian unified tokens)
2. Copy the token to `JIRA_API_TOKEN` in `.env`

**OpenAI API Key:**
1. Go to https://platform.openai.com/api-keys
2. Create a new API key
3. Copy to `OPENAI_API_KEY` in `.env`

### Finding Jira Custom Field IDs

1. Go to your Jira instance
2. Navigate to **Settings → Issues → Custom fields**
3. Find your test case custom fields (preconditions, test steps, expected result)
4. Click on the field to see its ID (e.g., `customfield_10001`)
5. Update `config/jira.json` with these IDs:
   ```json
   {
     "custom_field_mappings": {
       "preconditions": "customfield_10001",
       "test_steps": "customfield_10002",
       "expected_result": "customfield_10003",
       "parent_issue_link": "customfield_10004"
     }
   }
   ```

### Configuring Execution Modes

Edit `config/execution-modes.json`:

```json
{
  "scheduled": {
    "enabled": false,
    "cron_expression": "0 */6 * * *",
    "description": "Run every 6 hours"
  },
  "event_driven": {
    "enabled": false,
    "webhook_secret": "your-secret-key"
  },
  "manual": {
    "enabled": true,
    "api_port": 3000,
    "cors": {
      "enabled": true,
      "origins": ["http://localhost:3000"]
    }
  }
}
```

## Running the Service

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

### Building TypeScript
```bash
npm run build
```

## API Documentation

### POST /api/generate

Trigger test scenario generation from manual input or Confluence link.

**Option 1: Link-based input (Recommended):**
```json
{
  "link": "https://your-domain.atlassian.net/wiki/spaces/SPACE/pages/123456/Page+Title"
}
```

**Option 2: Manual input (Legacy):**
```json
{
  "title": "User Login Feature",
  "description": "Users can log in with email and password",
  "acceptance_criteria": "1. Valid credentials allow login\n2. Invalid credentials show error\n3. Account locks after 5 failed attempts",
  "metadata": {
    "system_type": "web",
    "feature_priority": "critical",
    "parent_jira_issue_id": "PROJ-123"
  },
  "confluence_page_id": "123456",
  "confluence_version": "1"
}
```

**Note:** When using the link-based approach, the system automatically:
- Extracts the page ID from the Confluence URL
- Fetches the page content from Confluence
- Parses the content to extract title, description, and acceptance criteria
- Sets default metadata values (can be overridden if needed)

**Response (202 Accepted):**
```json
{
  "job_id": "job-uuid",
  "status": "processing",
  "message": "Test scenario generation started",
  "created_at": "2024-01-15T10:30:00Z"
}
```

### GET /api/status/:jobId

Check generation status and retrieve results.

**Response (200 OK):**
```json
{
  "job_id": "job-uuid",
  "status": "completed",
  "created_at": "2024-01-15T10:30:00Z",
  "completed_at": "2024-01-15T10:30:15Z",
  "results": {
    "total_scenarios": 5,
    "validated_scenarios": 4,
    "needs_review_scenarios": 1,
    "scenarios": [...]
  }
}
```

### GET /api/jobs

List all generation jobs with filtering.

**Query Parameters:**
- `status`: Filter by status (processing, completed, failed)
- `limit`: Max results (default: 50, max: 200)
- `offset`: Pagination offset (default: 0)
- `since`: ISO 8601 timestamp - only jobs created after this time

**Response (200 OK):**
```json
{
  "total": 150,
  "limit": 50,
  "offset": 0,
  "jobs": [...]
}
```

### DELETE /api/jobs/:jobId

Delete a generation job and its outputs.

### POST /api/validate/:jobId

Manually override validation status for scenarios.

**Request:**
```json
{
  "test_id": "test-uuid",
  "validation_status": "validated",
  "validation_notes": "Reviewed and approved"
}
```

### POST /api/webhook/confluence

Receive Confluence page update webhooks (Event-Driven Mode).

### GET /api/health

Health check endpoint.

**Response (200 OK):**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime_seconds": 3600,
  "mode": {
    "scheduled": false,
    "event_driven": false,
    "manual": true
  }
}
```

## Output Files

### Generated Scenarios
- **Location**: `data/generated/`
- **Format**: `{confluencePageId}_{timestamp}.json`
- **Contains**: Validated test scenarios ready for review

### Needs Review
- **Location**: `data/needs_review/`
- **Format**: `{confluencePageId}_{timestamp}.json`
- **Contains**: Scenarios that failed validation

### Jira Payloads
- **Location**: `data/jira_payloads/`
- **Format**: `{confluencePageId}_{testId}.json`
- **Contains**: Jira-ready payload for each validated scenario

### Logs
- **app.log**: Main application log (rotated daily, kept 30 days)
- **error.log**: Error-only log (kept 90 days)
- **cost-reports/**: Daily OpenAI cost reports
- **metrics/**: Daily performance metrics

## Troubleshooting

### Issue: OpenAI returns empty or invalid JSON

**Solutions:**
- Check trace logs for full prompt and response
- Verify prompt formatting is correct
- Increase `OPENAI_MAX_TOKENS` if response is truncated
- Check if model is correctly specified

### Issue: Confluence API returns 401

**Solutions:**
- Verify `CONFLUENCE_EMAIL` and `CONFLUENCE_API_TOKEN` are correct
- Ensure API token has appropriate permissions
- Check `CONFLUENCE_BASE_URL` format (should include `/wiki`)

### Issue: Validation always fails with "new functionality" errors

**Solutions:**
- Check similarity threshold in validator
- Ensure "moderate" strictness is implemented
- Review keyword extraction logic
- Manually review flagged test cases

### Issue: Scheduled mode doesn't run

**Solutions:**
- Verify cron expression syntax
- Check logs for cron initialization
- Ensure `scheduled.enabled: true` in config
- Restart service after config changes

### Issue: Webhooks return 401

**Solutions:**
- Verify HMAC signature calculation
- Check webhook secret matches Confluence configuration
- Enable trace logging to see raw webhook payloads

## Development

### Code Formatting
```bash
npm run format
```

### Linting
```bash
npm run lint
```

## Security Considerations

- **Never commit `.env` file to git**
- **Rotate API tokens regularly**
- **Use least-privilege access** (read-only for Confluence)
- **Webhook security**: Always verify HMAC signatures
- **Trace logs include full API payloads** - do not expose publicly
- **Set appropriate file permissions** on deployment

## Future Enhancements (Phase 2)

- PostgreSQL for production audit trail
- Redis caching for frequently accessed specs
- Automatic Jira test case creation
- Change detection (regenerate only if changed)
- Self-healing (learn from validation failures)
- Test code generation (Module 4.2)
- Error alerting (Sentry, Datadog integration)

## Project Structure

```
testcase_generator/
├── src/
│   ├── api/              # REST API endpoints and middleware
│   ├── pipeline/         # 5-step processing pipeline
│   ├── integrations/     # External service clients
│   ├── modes/            # Execution mode implementations
│   ├── models/           # TypeScript interfaces/types
│   ├── storage/          # File system operations
│   ├── monitoring/       # Cost tracking and metrics
│   ├── utils/            # Utility functions
│   └── index.ts          # Application entry point
├── config/               # Configuration files
├── data/                 # Runtime data storage
├── logs/                 # Log files
├── package.json
├── tsconfig.json
└── README.md
```

## License

Internal use only.

## Support

For issues or questions, contact the QA team.