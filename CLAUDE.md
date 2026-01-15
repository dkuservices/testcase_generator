# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Orchestrator Module 4.1 - An AI-powered test scenario generator that transforms Confluence specifications into structured test cases using LLM providers (OpenAI/Ollama). The system validates scenarios, prepares them for Jira, and supports three execution modes with built-in multi-level fallback mechanisms.

## Commands

### Development
```bash
npm run dev          # Development mode with hot reload (ts-node-dev)
npm run build        # Compile TypeScript to dist/
npm start            # Production mode (runs dist/index.js)
npm run lint         # ESLint validation on src/**/*.ts
npm run format       # Prettier code formatting
```

### Configuration Setup
Note: .env.example was deleted from the repository. To configure:
1. Create a new .env file manually with required environment variables (see Environment Variables section)
2. Configure config/*.json files: execution-modes.json, confluence.json, jira.json, pricing.json
3. Set LLM provider credentials and API endpoints

## Core Architecture: 5-Step Processing Pipeline

The system processes specifications through a sequential pipeline orchestrated by [src/pipeline/pipeline-orchestrator.ts](src/pipeline/pipeline-orchestrator.ts):

### Step 1: Input Normalization
**File**: [src/pipeline/normalizer.ts](src/pipeline/normalizer.ts)

- Strips HTML tags from Confluence content
- Deduplicates sentences and normalizes whitespace
- Validates at least one content field is present
- Formats as: `"Feature: {title}\n\nDescription: {desc}\n\nAcceptance Criteria: {criteria}"`
- Returns `NormalizedInput` with metadata preserved (system_type, feature_priority, parent_jira_issue_id)

### Step 2: Prompt Building
**File**: [src/pipeline/prompt-builder.ts](src/pipeline/prompt-builder.ts)

Creates strict prompts for LLM:

**System Message Rules**:
- Generate test SCENARIOS only (not code/scripts)
- Don't introduce new business rules beyond specification
- Three types required: happy_path, negative, edge_case
- Low creativity, high determinism
- **Critical**: Test steps must be in Slovakian language

**User Message Includes**:
- Metadata: system_type, feature_priority, parent_jira_issue_id
- Normalized specification text
- JSON schema specification with exact fields

### Step 3: LLM Invocation with Dual Fallback
**File**: [src/pipeline/llm-client-v2.ts](src/pipeline/llm-client-v2.ts)

**Primary Attempt**:
- Uses provider from `LLM_PROVIDER` env var (openai|ollama)
- Extracts scenarios from JSON response (handles multiple key names: scenarios, test_scenarios, testScenarios, items, data)
- Normalizes field names (test_steps|steps|testSteps, scenario_classification|classification, etc.)
- Enriches with test_id (UUID), tags, traceability metadata

**LLM-Level Fallback**:
- Triggers if: `VALIDATION_FALLBACK_ENABLED='true'` AND (primary failed OR returned 0 scenarios)
- Uses different provider via `createFallbackProvider()`
- Stricter profile: temperature=0.0, added precision suffix to system prompt
- Returns `LlmAttemptResult` with scenarios, profile, success status, error, duration

**Scenario Normalization** handles LLM output variations:
- Classification: "happy" → "happy_path", "edge" → "edge_case"
- Test type: "regress*" → "regression", "function*" → "functional"
- Priority: "p1" → "critical", "p2" → "high", "p3" → "medium", "p4" → "low"
- Test steps: handles both array and newline-delimited strings

### Step 4: Validation with Validation-Level Fallback
**File**: [src/pipeline/validator.ts](src/pipeline/validator.ts)

**Validation Rules**:

1. **Required Fields**: test_name, valid test_type (functional|regression|smoke), valid scenario_classification (happy_path|negative|edge_case), preconditions, test_steps[], expected_result, valid priority (critical|high|medium|low)

2. **Test Steps Clarity**:
   - Each step ≥10 characters
   - Must contain actionable verb (click, enter, select, verify, navigate, etc. - see `containsVerb()` for full list)
   - No placeholders (TODO, TBD, [insert], ..., xxx)

3. **New Functionality Detection**:
   - Uses text similarity with threshold 0.3 via [src/utils/text-similarity.ts](src/utils/text-similarity.ts)
   - Flags scenarios introducing concepts not in source specification

4. **Traceability**: parent_jira_issue_id matches input, source_confluence_page_id present, valid ISO 8601 timestamp

**Validation-Level Fallback Decision**:

If fallback LLM attempt exists, validator processes BOTH sets of scenarios and chooses the better set:

```
Use fallback scenarios IF:
  primary.needs_review > fallback.needs_review OR
  primary.validated == 0 AND fallback.validated > 0 OR
  !primary.success AND fallback.success
ELSE:
  Use primary scenarios
```

Logs decision with counts: primary_validated, primary_needs_review, fallback_validated, fallback_needs_review

### Step 5: Jira Formatting
**File**: [src/pipeline/jira-formatter.ts](src/pipeline/jira-formatter.ts)

- Filters only scenarios with `validation_status='validated'`
- Creates Jira API payload for each scenario:
  - Project key from config, issue type, summary (test name)
  - Description formatted: Preconditions → Test Steps → Expected Result
  - Priority mapping: critical→Highest, high→High, medium→Medium, low→Low
  - Labels: ai-generated, scenario_classification, test_type
  - Custom field mappings from config/jira.json
- Saves per-scenario payloads: `data/jira_payloads/{pageId}_{testId}.json`
- Saves summary file: `data/jira_payloads/{pageId}_summary.json`

## Execution Modes (3 Independent Modes)

All three modes are initialized simultaneously in [src/index.ts](src/index.ts) based on config/execution-modes.json. Each mode can be independently enabled/disabled. At least one mode must be enabled.

### Manual Mode
**File**: [src/modes/manual.ts](src/modes/manual.ts)

REST API server on configured port (default: 3000)

**Key Route**: [src/api/routes/generate.ts](src/api/routes/generate.ts)
- `POST /api/generate` - Accepts `SpecificationInput` (link-based OR manual fields)
- Returns 202 Accepted with job_id immediately
- `processJobAsync()` runs in background

**Link-Based Input Flow** (Recommended):
1. Client sends: `{ "link": "https://domain.atlassian.net/wiki/spaces/SPACE/pages/123456/Title" }`
2. Validates Confluence URL format via `isValidConfluenceUrl()`
3. Extracts page ID using `extractPageIdFromUrl()`
4. Fetches page via `fetchConfluencePage()` with retry logic (3 attempts, 2s delay, exponential backoff)
5. Parses HTML storage format via cheerio in `extractTextFromConfluence()`
6. Creates `SpecificationInput` with title, description, acceptance_criteria

**Job Processing Flow**:
- Creates job with `status='processing'`
- Executes pipeline via `executePipeline()`
- Updates job to `status='completed'` or `'failed'`
- Jobs persisted to `data/jobs/{jobId}.json`

### Scheduled Mode
**File**: [src/modes/scheduled.ts](src/modes/scheduled.ts)

- Uses node-cron with cron_expression from config
- `runScheduledTask()` flow:
  1. Reads scheduler state (tracks last run time)
  2. Searches Confluence pages in monitored spaces updated since last run
  3. For each page: fetches content → creates job → executes pipeline
  4. Saves scheduler state with last_run timestamp

### Event-Driven Mode
**File**: [src/modes/event-driven.ts](src/modes/event-driven.ts)

- Webhook endpoint: `POST /api/webhook/confluence`
- Validates HMAC-SHA256 signature using webhook_secret
- Filters events by monitored spaces from config
- Fire-and-forget async processing

## Provider System

### Provider Factory
**File**: [src/llm/provider-factory.ts](src/llm/provider-factory.ts)

- `createLlmProvider()` - reads `LLM_PROVIDER` env var (openai|ollama)
- `createFallbackProvider()` - reads `LLM_FALLBACK_PROVIDER` env var
- Each provider implements `LlmProvider` interface with `generateCompletion()` method

### OpenAI Provider
**File**: [src/llm/providers/openai-provider.ts](src/llm/providers/openai-provider.ts)

- Uses openai SDK v4.24.1
- Configuration:
  - `OPENAI_API_KEY` (required)
  - `OPENAI_MODEL` (default: gpt-4-turbo)
  - `OPENAI_TEMPERATURE` (default: 0.2)
  - `OPENAI_MAX_TOKENS` (default: 3000)
- Retry logic: 3 attempts with exponential backoff (1s→2s→4s)
- JSON mode enabled for structured responses
- Detects rate limits and retryable errors

### Ollama Provider
**File**: [src/llm/providers/ollama-provider.ts](src/llm/providers/ollama-provider.ts)

- Uses ollama SDK v0.6.3
- Configuration:
  - `OLLAMA_BASE_URL` (default: http://localhost:11434)
  - `OLLAMA_MODEL_PRIMARY` (default: llama2)
  - `OLLAMA_TEMPERATURE_PRIMARY` (default: 0.3)
  - `OLLAMA_MODEL_FALLBACK` (optional)
  - `OLLAMA_TEMPERATURE_FALLBACK` (default: 0.0)
- Has both primary and fallback profiles
- JSON repair logic: removes text before/after braces, fixes trailing commas, handles unquoted keys

## Key Implementation Patterns

### Context Logger Pattern
Every function creates a context logger with metadata for full traceability:

```typescript
const contextLogger = createContextLogger({
  step: 'normalization',
  job_id: jobId,
  confluence_page_id: pageId,
  parent_jira_issue_id: issueId
});
```

This enables log correlation across the entire job lifecycle. All logs include these context fields automatically.

### Async Job Processing
- `POST /api/generate` returns 202 Accepted immediately with job_id
- Job saved with `status='processing'`
- `processJobAsync()` runs in background
- Client polls `GET /api/jobs/:jobId` for results
- Jobs persisted to `data/jobs/{jobId}.json`

### Scenario Enrichment
LLM output is enriched before validation in `enrichScenario()`:
- Auto-generated `test_id` (UUID)
- `tags`: ['ai-generated', 'primary-attempt'|'fallback-attempt']
- Full traceability object: source_confluence_page_id, source_specification_version, generated_at (ISO 8601), llm_model
- `parent_jira_issue_id` from input metadata
- Initial `validation_status='validated'` (overridden by validator if issues found)

### Multi-Level Fallback Strategy

**Level 1 - LLM Fallback**: If primary provider fails or returns 0 scenarios, try fallback provider with stricter settings (temperature=0.0, precision suffix)

**Level 2 - Validation Fallback**: After validating BOTH primary and fallback scenarios, choose the set with better validation metrics

Both levels controlled by `VALIDATION_FALLBACK_ENABLED` environment variable.

## Configuration

### Configuration Files (config/)

- **execution-modes.json**: Enable/disable modes, cron expression, webhook secret, API port, CORS settings
- **confluence.json**: monitored_spaces[], polling_interval_minutes, page_filters (include_labels, exclude_labels)
- **jira.json**: project_key, issue_type, custom_field_mappings (preconditions, test_steps, expected_result, parent_issue_link)
- **pricing.json**: OpenAI model pricing for cost tracking

### Environment Variables (Critical)

**LLM Configuration**:
- `LLM_PROVIDER` - "openai" or "ollama" (default: ollama)
- `LLM_FALLBACK_PROVIDER` - Fallback provider name (e.g., "ollama" if primary is "openai")
- `VALIDATION_FALLBACK_ENABLED` - "true"|"false" - enables dual fallback system

**OpenAI**:
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TEMPERATURE`, `OPENAI_MAX_TOKENS`

**Ollama**:
- `OLLAMA_BASE_URL`, `OLLAMA_MODEL_PRIMARY`, `OLLAMA_TEMPERATURE_PRIMARY`
- `OLLAMA_MODEL_FALLBACK`, `OLLAMA_TEMPERATURE_FALLBACK`

**Confluence** (required for scheduled/event-driven modes):
- `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN`

**Jira**:
- `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`

**General**:
- `NODE_ENV`, `PORT`, `LOG_LEVEL`

### Data Output Structure

```
data/
├── jobs/{jobId}.json                           # Job records with status
├── generated/{pageId}_{timestamp}.json         # Validated scenarios
├── needs_review/{pageId}_{timestamp}.json      # Failed validation scenarios
├── jira_payloads/{pageId}_{testId}.json        # Per-scenario Jira payloads
├── jira_payloads/{pageId}_summary.json         # Summary of all payloads
├── metadata/{pageId}_{timestamp}_metadata.json # Generation metadata
└── scheduler_state.json                        # Last scheduled run timestamp
```

### Logs (logs/)
- **app.log**: Main application log (rotated daily, 30-day retention)
- **error.log**: Error-only log (90-day retention)
- **cost-reports/**: Daily OpenAI API usage reports with cost estimation
- **metrics/**: Daily performance metrics

## Common Development Workflows

### Adding a New LLM Provider
1. Create `src/llm/providers/{provider}-provider.ts` implementing `LlmProvider` interface
2. Add to [src/llm/provider-factory.ts](src/llm/provider-factory.ts) switch statement
3. Add env var validation in [src/index.ts](src/index.ts) `validateConfigurations()`
4. Test with both primary and fallback configurations

### Modifying Validation Rules
Edit [src/pipeline/validator.ts](src/pipeline/validator.ts) functions:
- `validateRequiredFields()` - field presence and enum validation
- `validateTestStepsClarity()` - step quality checks (length, verbs, placeholders)
- `validateNewFunctionality()` - similarity threshold (currently 0.3)
- `validateTraceability()` - metadata consistency checks

### Adding New API Endpoints
1. Create route file in `src/api/routes/`
2. Register in [src/api/server.ts](src/api/server.ts) `createExpressApp()`
3. Add middleware if needed in `src/api/middleware/`
4. Update [src/api/routes/generate.ts](src/api/routes/generate.ts) for reference

### Changing Jira Output Format
- Edit [src/pipeline/jira-formatter.ts](src/pipeline/jira-formatter.ts) `formatForJira()`
- Update `custom_field_mappings` in config/jira.json
- Modify priority mapping in `buildJiraPayload()`

## Testing & Verification

### Health Check
```bash
curl http://localhost:3000/api/health
# Should return: {"status":"healthy","version":"1.0.0","uptime_seconds":...,"mode":{...}}
```

### Test Pipeline with Sample Input

**Link-based (recommended)**:
```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"link":"https://domain.atlassian.net/wiki/spaces/SPACE/pages/123456/Page"}'
```

**Manual input (legacy)**:
```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "title":"User Login",
    "description":"Users can login with email/password",
    "acceptance_criteria":"Valid credentials allow login",
    "metadata":{"system_type":"web","feature_priority":"high","parent_jira_issue_id":"AUTH-123"}
  }'
```

Returns: `{"job_id":"uuid","status":"processing",...}`

### Check Job Status
```bash
curl http://localhost:3000/api/jobs/{job_id}
# Poll until status: "completed" or "failed"
```

### Verify Outputs
- Check `data/generated/` for validated scenarios JSON
- Check `data/needs_review/` for scenarios that failed validation
- Check `data/jira_payloads/` for Jira-ready payloads
- Check `logs/app.log` for execution trace with job_id correlation

### Verify Fallback System
1. Set `VALIDATION_FALLBACK_ENABLED=true`
2. Set `LLM_PROVIDER=openai` and `LLM_FALLBACK_PROVIDER=ollama`
3. Submit a test request
4. Check logs for "Validation-triggered fallback decision" messages
5. Verify which attempt was used in the final results

## Important Notes

### Slovakian Language Requirement
The system prompt specifies: "Output all scenario's test steps in Slovakian language" - this is a critical requirement in [src/pipeline/prompt-builder.ts:26](src/pipeline/prompt-builder.ts#L26). All generated test steps must be in Slovakian.

### JSON Schema Flexibility
The LLM response parser handles multiple JSON formats:
- Top-level array OR object with key
- Accepted keys: scenarios, test_scenarios, testScenarios, items, data
- Field name variations normalized (camelCase, snake_case, abbreviations)
- See `extractScenarios()` and `normalizeScenarioOutput()` in [src/pipeline/llm-client-v2.ts](src/pipeline/llm-client-v2.ts)

### Request Validation
**File**: [src/api/middleware/request-validator.ts](src/api/middleware/request-validator.ts)

Joi schema requires either:
- `link` field (Confluence URL), OR
- At least one of: title, description, acceptance_criteria

Metadata validation: system_type (web|api|mobile), feature_priority (critical|high|medium|low), parent_jira_issue_id

### Confluence Integration
- Only required for scheduled and event-driven modes
- Manual mode can work without Confluence if using manual input (not link-based)
- HTML parsing via cheerio library
- Handles Confluence storage format with retry logic

### Cost Tracking
- Implemented in [src/monitoring/cost-tracker.ts](src/monitoring/cost-tracker.ts)
- Daily reports saved to `logs/cost-reports/`
- Uses config/pricing.json for OpenAI model pricing
- Tracks token usage and estimates costs

### Security Considerations
- Never commit .env file to git (note: .env.example was deleted)
- Webhook HMAC-SHA256 signature validation required for event-driven mode
- API rate limiting via express-rate-limit middleware
- Helmet security headers applied to all HTTP responses
- Trace logs include full API payloads - do not expose publicly

## Key Files Reference

**Pipeline**:
- [src/pipeline/pipeline-orchestrator.ts](src/pipeline/pipeline-orchestrator.ts) - Main orchestrator
- [src/pipeline/normalizer.ts](src/pipeline/normalizer.ts) - Step 1
- [src/pipeline/prompt-builder.ts](src/pipeline/prompt-builder.ts) - Step 2
- [src/pipeline/llm-client-v2.ts](src/pipeline/llm-client-v2.ts) - Step 3
- [src/pipeline/validator.ts](src/pipeline/validator.ts) - Step 4
- [src/pipeline/jira-formatter.ts](src/pipeline/jira-formatter.ts) - Step 5

**Modes**:
- [src/modes/manual.ts](src/modes/manual.ts)
- [src/modes/scheduled.ts](src/modes/scheduled.ts)
- [src/modes/event-driven.ts](src/modes/event-driven.ts)

**Providers**:
- [src/llm/provider-factory.ts](src/llm/provider-factory.ts)
- [src/llm/providers/openai-provider.ts](src/llm/providers/openai-provider.ts)
- [src/llm/providers/ollama-provider.ts](src/llm/providers/ollama-provider.ts)

**API**:
- [src/api/server.ts](src/api/server.ts)
- [src/api/routes/generate.ts](src/api/routes/generate.ts)
- [src/api/middleware/request-validator.ts](src/api/middleware/request-validator.ts)

**Entry Point**:
- [src/index.ts](src/index.ts) - Application startup and mode initialization
