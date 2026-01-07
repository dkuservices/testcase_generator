# AI Orchestrator Module 4.1 - User Guide

## Table of Contents

1. [Quick Start](#quick-start)
2. [Common Workflows](#common-workflows)
3. [Understanding the Output](#understanding-the-output)
4. [Working with Generated Test Scenarios](#working-with-generated-test-scenarios)
5. [Manual Review Process](#manual-review-process)
6. [Best Practices](#best-practices)
7. [Common Operations](#common-operations)
8. [Troubleshooting Workflows](#troubleshooting-workflows)

---

## Quick Start

### First Time Setup (5 minutes)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your actual API tokens
   ```

3. **Start the service:**
   ```bash
   npm run dev
   ```

4. **Verify it's running:**
   ```bash
   curl http://localhost:3000/api/health
   ```

   Expected response:
   ```json
   {
     "status": "healthy",
     "version": "1.0.0",
     "uptime_seconds": 5,
     "mode": {
       "scheduled": false,
       "event_driven": false,
       "manual": true
     }
   }
   ```

### Your First Test Generation (2 minutes)

Create a file `example-request.json`:

```json
{
  "title": "User Login",
  "description": "Users should be able to log in with their email and password",
  "acceptance_criteria": "1. User enters valid email and password\n2. User is redirected to dashboard\n3. Invalid credentials show error message\n4. Account locks after 5 failed attempts",
  "metadata": {
    "system_type": "web",
    "feature_priority": "critical",
    "parent_jira_issue_id": "PROJ-123"
  }
}
```

Generate test scenarios:
```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d @example-request.json
```

Response:
```json
{
  "job_id": "job-abc123",
  "status": "processing",
  "message": "Test scenario generation started",
  "created_at": "2024-01-15T10:30:00Z"
}
```

Check the results (wait 5-10 seconds):
```bash
curl http://localhost:3000/api/status/job-abc123
```

---

## Common Workflows

### Workflow 1: Generate Test Scenarios from Confluence Page

**When to use:** You have a requirements document in Confluence and want to generate test cases from it.

**Steps:**

1. **Get the Confluence page ID:**
   - Open your Confluence page
   - Look at the URL: `https://your-domain.atlassian.net/wiki/spaces/SPACE/pages/123456/Page+Title`
   - The page ID is `123456`

2. **Create request with Confluence page ID:**
   ```json
   {
     "title": "Payment Processing Feature",
     "description": "Feature allows users to process payments via credit card",
     "acceptance_criteria": "See full requirements in Confluence",
     "metadata": {
       "system_type": "web",
       "feature_priority": "critical",
       "parent_jira_issue_id": "PAY-456"
     },
     "confluence_page_id": "123456",
     "confluence_version": "1"
   }
   ```

3. **Submit and track:**
   ```bash
   JOB_ID=$(curl -s -X POST http://localhost:3000/api/generate \
     -H "Content-Type: application/json" \
     -d @request.json | jq -r '.job_id')

   echo "Job ID: $JOB_ID"

   # Wait a moment, then check status
   curl http://localhost:3000/api/status/$JOB_ID | jq
   ```

4. **Review outputs:**
   ```bash
   # View generated scenarios
   cat data/generated/123456_*.json | jq

   # View Jira payloads
   ls -la data/jira_payloads/123456_*
   ```

### Workflow 2: Manual Input for Quick Test Generation

**When to use:** You have requirements in a different format (email, document, verbal) and want quick test scenarios.

**Steps:**

1. **Prepare your input:**
   - Extract key information: title, description, acceptance criteria
   - Identify system type (web/api/mobile)
   - Determine priority

2. **Format as JSON:**
   ```json
   {
     "title": "Password Reset",
     "description": "Users can reset their password by receiving an email with a reset link. Link expires after 1 hour.",
     "acceptance_criteria": "1. User clicks 'Forgot Password'\n2. User enters registered email\n3. System sends reset link\n4. Link expires after 1 hour\n5. User sets new password\n6. Old password no longer works",
     "metadata": {
       "system_type": "web",
       "feature_priority": "high",
       "parent_jira_issue_id": "AUTH-789"
     }
   }
   ```

3. **Generate:**
   ```bash
   curl -X POST http://localhost:3000/api/generate \
     -H "Content-Type: application/json" \
     -d @request.json
   ```

### Workflow 3: Batch Processing Multiple Features

**When to use:** You have multiple features to process at once.

**Steps:**

1. **Create multiple request files:**
   ```bash
   # feature1.json, feature2.json, feature3.json, etc.
   ```

2. **Process in batch:**
   ```bash
   #!/bin/bash

   for file in feature*.json; do
     echo "Processing $file..."
     JOB_ID=$(curl -s -X POST http://localhost:3000/api/generate \
       -H "Content-Type: application/json" \
       -d @$file | jq -r '.job_id')

     echo "  Job ID: $JOB_ID"
     echo "$JOB_ID" >> job_ids.txt

     sleep 2  # Be respectful to the API
   done

   echo "All jobs submitted!"
   ```

3. **Check all jobs:**
   ```bash
   while read JOB_ID; do
     STATUS=$(curl -s http://localhost:3000/api/status/$JOB_ID | jq -r '.status')
     echo "$JOB_ID: $STATUS"
   done < job_ids.txt
   ```

### Workflow 4: Review and Validate Generated Scenarios

**When to use:** Generated scenarios need manual review before importing to Jira.

**Steps:**

1. **Check for scenarios needing review:**
   ```bash
   ls -la data/needs_review/
   ```

2. **Review a scenario:**
   ```bash
   cat data/needs_review/123456_*.json | jq
   ```

3. **If scenario is good, override validation:**
   ```bash
   # Get the test_id from the scenario
   TEST_ID="test-xyz789"
   JOB_ID="job-abc123"

   curl -X POST http://localhost:3000/api/validate/$JOB_ID \
     -H "Content-Type: application/json" \
     -d '{
       "test_id": "'$TEST_ID'",
       "validation_status": "validated",
       "validation_notes": "Reviewed and approved by QA team"
     }'
   ```

4. **Scenario moves to validated and Jira payload is generated**

---

## Understanding the Output

### Output Directory Structure

```
data/
├── generated/          # Validated scenarios ready for Jira
├── needs_review/       # Scenarios that failed validation
├── jira_payloads/      # Jira-ready JSON payloads
├── jobs/               # Job metadata and status
└── metadata/           # Generation metadata
```

### Generated Test Scenario Structure

```json
{
  "test_id": "test-abc123",
  "test_name": "Verify user login with valid credentials",
  "test_type": "functional",
  "scenario_classification": "happy_path",
  "preconditions": "User account exists with email test@example.com and password TestPass123",
  "test_steps": [
    "Navigate to login page",
    "Enter email: test@example.com",
    "Enter password: TestPass123",
    "Click Login button"
  ],
  "expected_result": "User is redirected to dashboard, welcome message displayed",
  "priority": "critical",
  "tags": ["ai-generated"],
  "parent_jira_issue_id": "PROJ-123",
  "traceability": {
    "source_confluence_page_id": "123456",
    "source_specification_version": "1",
    "generated_at": "2024-01-15T10:30:00Z",
    "llm_model": "gpt-4-turbo"
  },
  "validation_status": "validated"
}
```

### Scenario Classifications Explained

**happy_path:**
- Normal, expected user flow
- Valid inputs
- Positive outcomes
- Example: "User logs in with valid credentials"

**negative:**
- Error conditions
- Invalid inputs
- Security violations
- Example: "User attempts login with wrong password"

**edge_case:**
- Boundary values
- Unusual combinations
- Rare conditions
- Example: "User enters maximum length password (256 characters)"

### Validation Status Meanings

- **validated**: Passed all validation rules, ready for Jira
- **needs_review**: Failed validation, requires manual review
- **failed**: Critical validation failure

### Common Validation Failure Reasons

1. **"Scenario introduces new concepts"**
   - Scenario mentions functionality not in the specification
   - Example: Spec talks about login, scenario mentions "two-factor authentication"
   - Action: Review if the concept is actually implied or needs clarification

2. **"Test step too short"**
   - Step is less than 10 characters
   - Example: "Login"
   - Action: Manually edit to be more descriptive: "User clicks the Login button"

3. **"Missing actionable verb"**
   - Step doesn't describe an action
   - Example: "Dashboard page"
   - Action: Change to "Navigate to dashboard page"

4. **"Contains placeholder text"**
   - Step has TODO, TBD, or similar
   - Action: Complete the step description

---

## Working with Generated Test Scenarios

### Importing to Jira (Manual Process - Phase 1)

1. **Review Jira payloads:**
   ```bash
   cat data/jira_payloads/123456_summary.json
   ```

2. **Import individual test case:**
   - Open Jira
   - Navigate to your project
   - Create → Test (or your test issue type)
   - Copy/paste from the payload JSON:
     - Summary → test_name
     - Description → formatted description
     - Priority → priority
     - Labels → tags

3. **Bulk import (using Jira REST API):**
   ```bash
   # If you have Jira API access
   for payload in data/jira_payloads/123456_test-*.json; do
     curl -X POST https://your-domain.atlassian.net/rest/api/3/issue \
       -H "Content-Type: application/json" \
       -u "your-email@company.com:your-api-token" \
       -d @$payload
     sleep 1
   done
   ```

### Editing Generated Scenarios

**Option 1: Edit before Jira import**
```bash
# Edit the scenario file
vim data/generated/123456_*.json

# Regenerate Jira payload
# (Currently requires re-running generation with manual override)
```

**Option 2: Edit in Jira after import**
- Import as-is
- Edit directly in Jira
- Add team-specific details

### Organizing Test Scenarios

**By Feature:**
```bash
# Create feature directories
mkdir -p organized/login organized/payment organized/profile

# Move scenarios
cp data/generated/login_*.json organized/login/
```

**By Priority:**
```bash
# Filter critical tests
jq 'select(.priority == "critical")' data/generated/*.json > critical_tests.json
```

**By Classification:**
```bash
# Get all happy path scenarios
jq 'select(.scenario_classification == "happy_path")' data/generated/*.json
```

---

## Manual Review Process

### Step-by-Step Review Checklist

When reviewing scenarios in `data/needs_review/`:

**1. Check Traceability**
- [ ] Does the scenario test the actual requirement?
- [ ] Are concepts from the specification?
- [ ] Is the parent Jira issue correct?

**2. Verify Test Steps**
- [ ] Are steps clear and actionable?
- [ ] Can a tester execute them without confusion?
- [ ] Are steps in logical order?
- [ ] Do steps have proper detail level?

**3. Validate Expected Results**
- [ ] Is the expected result specific?
- [ ] Can success be clearly determined?
- [ ] Does it match the acceptance criteria?

**4. Check Classification**
- [ ] Is the scenario correctly classified (happy_path/negative/edge_case)?
- [ ] Does the classification match the test content?

**5. Assess Priority**
- [ ] Is the priority appropriate for the scenario?
- [ ] Does it match the feature priority?

**6. Review Preconditions**
- [ ] Are all necessary preconditions listed?
- [ ] Are preconditions achievable?
- [ ] Is test data specified?

### Approval Process

**If scenario is good:**
```bash
# Override validation
curl -X POST http://localhost:3000/api/validate/$JOB_ID \
  -H "Content-Type: application/json" \
  -d '{
    "test_id": "test-xyz",
    "validation_status": "validated",
    "validation_notes": "Approved by [Your Name] on [Date]"
  }'
```

**If scenario needs minor edits:**
1. Copy the scenario JSON
2. Edit the file directly
3. Save to `data/generated/`
4. Regenerate Jira payload manually

**If scenario is incorrect:**
1. Document the issue in validation_notes
2. Keep in needs_review
3. Create feedback for improving future generations

---

## Best Practices

### Writing Good Input Specifications

**DO:**
- ✅ Be specific and concrete
- ✅ List all acceptance criteria explicitly
- ✅ Mention edge cases and error conditions
- ✅ Include example values or constraints
- ✅ Specify system type accurately

**DON'T:**
- ❌ Use vague language ("should work well")
- ❌ Skip edge cases
- ❌ Assume implied requirements
- ❌ Mix multiple features in one request

**Example - Good Specification:**
```json
{
  "title": "Email Validation on Signup",
  "description": "System validates email format during user registration. Email must contain @ symbol and valid domain.",
  "acceptance_criteria": "1. Valid email formats: user@domain.com, user.name@domain.co.uk\n2. Invalid formats rejected: user@, @domain.com, user@domain\n3. Show error message: 'Please enter a valid email address'\n4. Validation happens on blur and on submit\n5. Error message appears below email field",
  "metadata": {
    "system_type": "web",
    "feature_priority": "high",
    "parent_jira_issue_id": "REG-101"
  }
}
```

**Example - Poor Specification:**
```json
{
  "title": "Email thing",
  "description": "Email should be validated",
  "acceptance_criteria": "Make sure email is valid",
  "metadata": {
    "system_type": "web",
    "feature_priority": "medium",
    "parent_jira_issue_id": "MISC-999"
  }
}
```

### Optimizing for Quality

**1. Provide Context**
- Include relevant business rules
- Mention related features
- Specify user types/roles

**2. Be Explicit About Edge Cases**
- List boundary values
- Mention error scenarios
- Include timeout/performance requirements

**3. Use Consistent Terminology**
- Match your team's vocabulary
- Use same terms as in your system
- Maintain consistent naming

**4. Structure Acceptance Criteria**
```
GOOD:
1. User enters valid email
2. User enters password (min 8 chars, 1 uppercase, 1 number)
3. User clicks Submit
4. System creates account
5. User receives confirmation email

BAD:
User should be able to sign up and get an email
```

### Performance Tips

**1. Batch Similar Requests**
- Group features from same epic
- Process during low-usage times
- Limit concurrent requests

**2. Monitor Costs**
```bash
# Check today's cost
cat logs/cost-reports/$(date +%Y-%m-%d)*.json | jq
```

**3. Optimize Prompts**
- Clear specifications = better results
- Less ambiguity = fewer retries
- Good structure = faster processing

---

## Common Operations

### Check Service Status
```bash
curl http://localhost:3000/api/health
```

### List All Jobs
```bash
curl "http://localhost:3000/api/jobs?limit=10" | jq
```

### Filter Jobs by Status
```bash
# Completed jobs only
curl "http://localhost:3000/api/jobs?status=completed" | jq

# Failed jobs
curl "http://localhost:3000/api/jobs?status=failed" | jq

# Jobs since yesterday
curl "http://localhost:3000/api/jobs?since=$(date -d yesterday -I)" | jq
```

### Delete Old Jobs
```bash
# Delete specific job
curl -X DELETE http://localhost:3000/api/jobs/job-abc123

# Bulk delete old jobs
curl -s "http://localhost:3000/api/jobs?status=completed&limit=100" | \
  jq -r '.jobs[] | select(.completed_at < "2024-01-01") | .job_id' | \
  while read JOB_ID; do
    curl -X DELETE http://localhost:3000/api/jobs/$JOB_ID
    echo "Deleted $JOB_ID"
  done
```

### View Logs
```bash
# Tail application logs
tail -f logs/app-$(date +%Y-%m-%d).log

# View errors only
tail -f logs/error-$(date +%Y-%m-%d).log

# Search for specific job
grep "job-abc123" logs/app-*.log

# View cost report
cat logs/cost-reports/$(date +%Y-%m-%d)*.json | jq
```

### Export Data
```bash
# Export all scenarios to CSV (requires jq)
jq -r '["test_id","test_name","priority","classification"] | @csv' < /dev/null
jq -r '[.test_id, .test_name, .priority, .scenario_classification] | @csv' data/generated/*.json
```

---

## Troubleshooting Workflows

### Scenario: No scenarios generated

**Symptoms:**
- Job completes but `total_scenarios: 0`
- Empty results array

**Diagnosis:**
```bash
# Check job details
curl http://localhost:3000/api/status/$JOB_ID | jq

# Check logs for LLM response
grep -A 20 "LLM response received" logs/app-*.log
```

**Solutions:**
1. Check if specification is too vague
2. Verify OpenAI API key is valid
3. Check if OpenAI rate limits hit
4. Increase OPENAI_MAX_TOKENS

### Scenario: All scenarios need review

**Symptoms:**
- All generated scenarios in `needs_review/`
- `validated_scenarios: 0`

**Diagnosis:**
```bash
# Check validation notes
jq '.validation_notes' data/needs_review/*.json
```

**Common Causes:**
1. Specification too different from generated content
2. AI introduced new concepts
3. Test steps too short or unclear

**Solutions:**
1. Refine input specification
2. Manually review and override if appropriate
3. Adjust validation threshold (requires code change)

### Scenario: Generation taking too long

**Symptoms:**
- Job stuck in "processing" for >60 seconds
- No response from status endpoint

**Diagnosis:**
```bash
# Check if job exists
curl http://localhost:3000/api/status/$JOB_ID

# Check service logs
tail -100 logs/app-*.log | grep ERROR
```

**Solutions:**
1. Check OpenAI API status
2. Verify network connectivity
3. Restart service if hung
4. Check for rate limiting

### Scenario: Jira payloads not created

**Symptoms:**
- Scenarios validated but no Jira payloads
- Empty `jira_payloads/` directory

**Diagnosis:**
```bash
# Check if scenarios are actually validated
jq '.validation_status' data/generated/*.json

# Check logs
grep "Jira formatting" logs/app-*.log
```

**Solutions:**
1. Verify scenarios have `validation_status: "validated"`
2. Check Jira configuration in `config/jira.json`
3. Regenerate payloads manually using validation override

---

## Advanced Usage

### Custom Filtering Scripts

**Extract high priority tests:**
```bash
#!/bin/bash
# save as extract_high_priority.sh

jq 'select(.priority == "critical" or .priority == "high")' \
  data/generated/*.json > high_priority_tests.json

echo "Extracted $(jq -s 'length' high_priority_tests.json) high priority tests"
```

**Find tests by keyword:**
```bash
#!/bin/bash
# save as find_tests.sh

KEYWORD="$1"

jq --arg keyword "$KEYWORD" \
  'select(.test_name | contains($keyword))' \
  data/generated/*.json
```

### Integration with CI/CD

**Example: GitHub Actions**
```yaml
name: Generate Test Scenarios

on:
  push:
    paths:
      - 'specs/**/*.json'

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Generate test scenarios
        run: |
          for spec in specs/*.json; do
            curl -X POST http://testgen.internal/api/generate \
              -H "Content-Type: application/json" \
              -d @$spec
          done
```

### Monitoring and Alerts

**Daily report script:**
```bash
#!/bin/bash
# save as daily_report.sh

DATE=$(date +%Y-%m-%d)

echo "Daily Test Generation Report - $DATE"
echo "====================================="

# Jobs summary
JOBS=$(curl -s "http://localhost:3000/api/jobs?since=${DATE}T00:00:00Z")
echo "Total Jobs: $(echo $JOBS | jq '.total')"
echo "Completed: $(echo $JOBS | jq '.jobs | map(select(.status == "completed")) | length')"
echo "Failed: $(echo $JOBS | jq '.jobs | map(select(.status == "failed")) | length')"

# Cost
if [ -f "logs/cost-reports/${DATE}*.json" ]; then
  echo "\nCost: \$$(cat logs/cost-reports/${DATE}*.json | jq '.estimated_cost_usd')"
fi

# Scenarios needing review
NEEDS_REVIEW=$(ls data/needs_review/ | wc -l)
echo "\nScenarios needing review: $NEEDS_REVIEW"
```

---

## Support and Feedback

For questions, issues, or feature requests:
- Contact QA team lead
- Check logs first: `logs/app-*.log`
- Include job ID when reporting issues
- Provide input specification for reproduction

## Appendix: Quick Reference

### Environment Variables
```bash
NODE_ENV=development          # Environment mode
PORT=3000                     # API port
LOG_LEVEL=trace              # Logging level
OPENAI_API_KEY=sk-xxx        # OpenAI API key
OPENAI_MODEL=gpt-4-turbo     # LLM model
CONFLUENCE_BASE_URL=...      # Confluence URL
JIRA_BASE_URL=...            # Jira URL
```

### Key Directories
```
config/           - Configuration files
data/generated/   - Validated test scenarios
data/needs_review/- Scenarios needing review
data/jira_payloads/- Jira-ready payloads
logs/            - Application logs
```

### API Endpoints
```
POST   /api/generate              - Create generation job
GET    /api/status/:jobId         - Check job status
GET    /api/jobs                  - List all jobs
DELETE /api/jobs/:jobId           - Delete job
POST   /api/validate/:jobId       - Override validation
GET    /api/health                - Health check
```

### Common jq Queries
```bash
# Get all test names
jq '.test_name' data/generated/*.json

# Count scenarios by classification
jq '.scenario_classification' data/generated/*.json | sort | uniq -c

# Find failed validations
jq 'select(.validation_status == "needs_review")' data/generated/*.json

# Get scenarios for specific Jira issue
jq --arg issue "PROJ-123" 'select(.parent_jira_issue_id == $issue)' data/generated/*.json
```
