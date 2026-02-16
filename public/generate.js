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
    setStatus('', 'Vyberte režim a vložte odkaz(y) pre začatie.');
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
    setStatus('error', 'Zadajte odkaz na Confluence stránku.');
    return;
  }

  elements.submitButton.disabled = true;
  setStatus('loading', 'Spúšťam generovanie...');

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = payload.message || 'Nepodarilo sa spustiť generovanie.';
      setStatus('error', message);
      return;
    }

    const jobId = payload.job_id || payload.jobId;
    setStatus(
      'success',
      'Generovanie spustené.',
      [
        { label: jobId ? `Job: ${jobId}` : 'Job vytvorený' },
        jobId ? { label: 'Sledovať stav', href: `/api/status/${jobId}` } : null,
        { label: 'Otvoriť review desk', href: '/review' },
      ].filter(Boolean)
    );
  } catch (error) {
    setStatus('error', error.message || 'Požiadavka zlyhala.');
  } finally {
    elements.submitButton.disabled = false;
  }
}

async function handleBatchSubmit() {
  const linksText = elements.linksTextarea.value.trim();
  if (!linksText) {
    setStatus('error', 'Zadajte aspoň jeden Confluence odkaz.');
    return;
  }

  const links = linksText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (links.length < 2) {
    setStatus('error', 'Dávkový režim vyžaduje aspoň 2 odkazy.');
    return;
  }

  if (links.length > 20) {
    setStatus('error', 'Dávkový režim podporuje maximálne 20 odkazov.');
    return;
  }

  const pageTests = elements.pageTestsCheckbox.checked;
  const moduleTests = elements.moduleTestsCheckbox.checked;

  if (!pageTests && !moduleTests) {
    setStatus('error', 'Vyberte aspoň jednu možnosť generovania.');
    return;
  }

  elements.submitButton.disabled = true;
  setStatus('loading', `Spúšťam dávkové generovanie pre ${links.length} stránok...`);

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
      const message = payload.error || payload.message || 'Nepodarilo sa spustiť dávkové generovanie.';
      const details = payload.details ? `\n${payload.details.join(', ')}` : '';
      setStatus('error', message + details);
      return;
    }

    const batchJobId = payload.batch_job_id;
    setStatus(
      'loading',
      'Dávkové generovanie prebieha...',
      [
        { label: `Batch Job: ${batchJobId}` },
        { label: `Spracovávam ${links.length} stránok` },
      ]
    );

    // Show progress bar
    elements.batchProgress.style.display = 'block';
    elements.progressFill.style.width = '0%';
    elements.progressText.textContent = `0 / ${links.length} stránok dokončených`;

    // Track globally for cross-page notifications
    if (window.trackJob) window.trackJob(batchJobId, 'Dávkové generovanie');

    // Start polling
    startBatchPolling(batchJobId);

  } catch (error) {
    setStatus('error', error.message || 'Požiadavka zlyhala.');
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
        throw new Error('Nepodarilo sa získať stav dávky');
      }

      updateBatchProgress(data);

      // Stop polling if completed or failed
      if (data.status === 'completed' || data.status === 'failed') {
        clearInterval(pollingInterval);
        pollingInterval = null;
        if (window.untrackJob) window.untrackJob(batchJobId);
        elements.submitButton.disabled = false;

        if (data.status === 'completed') {
          displayBatchResults(data);
        } else {
          setStatus('error', `Dávkový job zlyhal: ${data.error || 'Neznáma chyba'}`);
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
    `${progress.completed} / ${progress.total_pages} stránok dokončených`;

  if (progress.failed > 0) {
    elements.progressText.textContent += ` (${progress.failed} zlyhalo)`;
  }
}

function displayBatchResults(data) {
  const progress = data.progress;

  setStatus(
    'success',
    `Dávkové generovanie dokončené!`,
    [
      { label: `${progress.completed} stránok spracovaných` },
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
            ? `${subJob.results.validated_scenarios} validovaných, ${subJob.results.needs_review_scenarios} na kontrolu`
            : 'Žiadne výsledky';

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
        <strong>Výsledky agregácie</strong>
        <span>Celkový počet scenárov (deduplikovaných): ${aggResults.total_scenarios}</span>
        <span>Odstránené duplikáty: ${aggResults.deduplicated_count}</span>
        <span>Testy na úrovni modulov: ${aggResults.module_level_scenarios.length}</span>
        <a href="/api/batch/status/${data.batch_job_id}">Zobraziť celú správu</a>
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
  setStatus('', 'Vložte odkaz(y) pre začatie.');
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
