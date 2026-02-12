const elements = {
  form: document.getElementById('generateForm'),

  // Mode toggle
  modeButtons: document.querySelectorAll('.mode-btn'),

  // Single mode
  singleModeFields: document.getElementById('singleModeFields'),
  linkInput: document.getElementById('linkInput'),

  // Batch mode
  batchModeFields: document.getElementById('batchModeFields'),
  linksTextarea: document.getElementById('linksTextarea'),
  pageTestsCheckbox: document.getElementById('pageTestsCheckbox'),
  moduleTestsCheckbox: document.getElementById('moduleTestsCheckbox'),

  // Common
  submitButton: document.getElementById('submitButton'),
  resetButton: document.getElementById('resetButton'),
  statusPanel: document.getElementById('statusPanel'),
  statusMessage: document.getElementById('statusMessage'),
  statusMeta: document.getElementById('statusMeta'),

  // Batch progress
  batchProgress: document.getElementById('batchProgress'),
  progressFill: document.getElementById('progressFill'),
  progressText: document.getElementById('progressText'),
};

let currentMode = 'single';
let pollingInterval = null;

// Mode toggle handlers
elements.modeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const newMode = btn.dataset.mode;
    if (newMode === currentMode) return;

    // Update UI
    elements.modeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (newMode === 'single') {
      elements.singleModeFields.style.display = 'block';
      elements.batchModeFields.style.display = 'none';
      elements.batchProgress.style.display = 'none';
    } else {
      elements.singleModeFields.style.display = 'none';
      elements.batchModeFields.style.display = 'block';
    }

    currentMode = newMode;
    clearStatus();
    setStatus('', 'Select mode and paste link(s) to begin.');
  });
});

// Form submission
elements.form.addEventListener('submit', async event => {
  event.preventDefault();

  if (currentMode === 'single') {
    await handleSingleSubmit();
  } else {
    await handleBatchSubmit();
  }
});

async function handleSingleSubmit() {
  const link = elements.linkInput.value.trim();
  if (!link) {
    setStatus('error', 'Please provide a Confluence page link.');
    return;
  }

  elements.submitButton.disabled = true;
  setStatus('loading', 'Starting generation...');

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = payload.message || 'Failed to start generation.';
      setStatus('error', message);
      return;
    }

    const jobId = payload.job_id || payload.jobId;
    setStatus(
      'success',
      'Generation started.',
      [
        { label: jobId ? `Job: ${jobId}` : 'Job created' },
        jobId ? { label: 'Track status', href: `/api/status/${jobId}` } : null,
        { label: 'Open review desk', href: '/review' },
      ].filter(Boolean)
    );
  } catch (error) {
    setStatus('error', error.message || 'Request failed.');
  } finally {
    elements.submitButton.disabled = false;
  }
}

async function handleBatchSubmit() {
  const linksText = elements.linksTextarea.value.trim();
  if (!linksText) {
    setStatus('error', 'Please provide at least one Confluence link.');
    return;
  }

  const links = linksText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (links.length < 2) {
    setStatus('error', 'Batch mode requires at least 2 links.');
    return;
  }

  if (links.length > 20) {
    setStatus('error', 'Batch mode supports maximum 20 links.');
    return;
  }

  const pageTests = elements.pageTestsCheckbox.checked;
  const moduleTests = elements.moduleTestsCheckbox.checked;

  if (!pageTests && !moduleTests) {
    setStatus('error', 'Select at least one generation option.');
    return;
  }

  elements.submitButton.disabled = true;
  setStatus('loading', `Starting batch generation for ${links.length} pages...`);

  try {
    const response = await fetch('/api/batch/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        links,
        generate_page_level_tests: pageTests,
        generate_module_level_tests: moduleTests,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = payload.error || payload.message || 'Failed to start batch generation.';
      const details = payload.details ? `\n${payload.details.join(', ')}` : '';
      setStatus('error', message + details);
      return;
    }

    const batchJobId = payload.batch_job_id;
    setStatus(
      'loading',
      'Batch generation in progress...',
      [
        { label: `Batch Job: ${batchJobId}` },
        { label: `Processing ${links.length} pages` },
      ]
    );

    // Show progress bar
    elements.batchProgress.style.display = 'block';
    elements.progressFill.style.width = '0%';
    elements.progressText.textContent = `0 / ${links.length} pages completed`;

    // Start polling
    startBatchPolling(batchJobId);

  } catch (error) {
    setStatus('error', error.message || 'Request failed.');
    elements.submitButton.disabled = false;
  }
}

function startBatchPolling(batchJobId) {
  // Clear any existing polling
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }

  pollingInterval = setInterval(async () => {
    try {
      const response = await fetch(`/api/batch/status/${batchJobId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error('Failed to fetch batch status');
      }

      updateBatchProgress(data);

      // Stop polling if completed or failed
      if (data.status === 'completed' || data.status === 'failed') {
        clearInterval(pollingInterval);
        pollingInterval = null;
        elements.submitButton.disabled = false;

        if (data.status === 'completed') {
          displayBatchResults(data);
        } else {
          setStatus('error', `Batch job failed: ${data.error || 'Unknown error'}`);
        }
      }

    } catch (error) {
      console.error('Polling error:', error);
      // Don't stop polling on temporary errors
    }
  }, 3000); // Poll every 3 seconds
}

function updateBatchProgress(data) {
  const progress = data.progress;
  const percentage = (progress.completed / progress.total_pages) * 100;

  elements.progressFill.style.width = `${percentage}%`;
  elements.progressText.textContent =
    `${progress.completed} / ${progress.total_pages} pages completed`;

  if (progress.failed > 0) {
    elements.progressText.textContent += ` (${progress.failed} failed)`;
  }
}

function displayBatchResults(data) {
  const progress = data.progress;

  setStatus(
    'success',
    `Batch generation completed!`,
    [
      { label: `${progress.completed} pages processed` },
      { label: `Batch Job: ${data.batch_job_id}` },
    ]
  );

  // Show individual page results
  if (data.sub_jobs && data.sub_jobs.length > 0) {
    const resultsHtml = `
      <div class="batch-results">
        ${data.sub_jobs.map(subJob => {
          const statusClass = subJob.status === 'completed' ? 'completed' :
                            subJob.status === 'failed' ? 'failed' : 'processing';

          const scenarioInfo = subJob.results
            ? `${subJob.results.validated_scenarios} validated, ${subJob.results.needs_review_scenarios} needs review`
            : 'No results';

          return `
            <div class="page-result">
              <div class="page-result-header">
                <span class="page-result-link" title="${subJob.link}">${subJob.link}</span>
                <span class="page-result-status ${statusClass}">${subJob.status}</span>
              </div>
              <div class="page-result-details">${scenarioInfo}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    elements.statusMeta.innerHTML += resultsHtml;
  }

  // Show aggregation summary if available
  if (data.aggregation_results) {
    const aggResults = data.aggregation_results;
    const summaryHtml = `
      <div class="aggregation-summary">
        <strong>Aggregation Results</strong>
        <span>Total scenarios (deduplicated): ${aggResults.total_scenarios}</span>
        <span>Duplicates removed: ${aggResults.deduplicated_count}</span>
        <span>Module-level tests: ${aggResults.module_level_scenarios.length}</span>
        <a href="/api/batch/status/${data.batch_job_id}">View full report</a>
      </div>
    `;
    elements.statusMeta.innerHTML += summaryHtml;
  }
}

// Reset button
elements.resetButton.addEventListener('click', () => {
  if (currentMode === 'single') {
    elements.linkInput.value = '';
  } else {
    elements.linksTextarea.value = '';
    elements.pageTestsCheckbox.checked = true;
    elements.moduleTestsCheckbox.checked = true;
  }

  // Clear polling
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }

  elements.batchProgress.style.display = 'none';
  elements.submitButton.disabled = false;
  setStatus('', 'Paste link(s) to begin.');
});

// Utility functions
function clearStatus() {
  elements.statusPanel.classList.remove('loading', 'success', 'error');
  elements.statusMeta.innerHTML = '';
}

function setStatus(type, message, metaItems) {
  clearStatus();
  if (type) {
    elements.statusPanel.classList.add(type);
  }
  elements.statusMessage.textContent = message;

  if (Array.isArray(metaItems)) {
    metaItems.forEach(item => {
      const span = document.createElement('span');
      if (item.href) {
        const link = document.createElement('a');
        link.href = item.href;
        link.textContent = item.label;
        span.appendChild(link);
      } else {
        span.textContent = item.label;
      }
      elements.statusMeta.appendChild(span);
    });
  }
}
