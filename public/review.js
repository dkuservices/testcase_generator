const state = {
  scenarios: [],
  status: 'needs_review',
  search: '',
};

const elements = {
  grid: document.getElementById('scenarioGrid'),
  empty: document.getElementById('emptyState'),
  countPill: document.getElementById('countPill'),
  refreshButton: document.getElementById('refreshButton'),
  cleanButton: document.getElementById('cleanButton'),
  statusFilter: document.getElementById('statusFilter'),
  searchInput: document.getElementById('searchInput'),
  editModal: document.getElementById('editModal'),
  editForm: document.getElementById('editForm'),
  closeModal: document.getElementById('closeModal'),
  cancelEdit: document.getElementById('cancelEdit'),
  editJobId: document.getElementById('editJobId'),
  editTestId: document.getElementById('editTestId'),
  editTestName: document.getElementById('editTestName'),
  editTestType: document.getElementById('editTestType'),
  editClassification: document.getElementById('editClassification'),
  editPriority: document.getElementById('editPriority'),
  editAutomationStatus: document.getElementById('editAutomationStatus'),
  editRepositoryFolder: document.getElementById('editRepositoryFolder'),
  editDescription: document.getElementById('editDescription'),
  editPreconditions: document.getElementById('editPreconditions'),
  editSteps: document.getElementById('editSteps'),
  editNotes: document.getElementById('editNotes'),
  exportButton: document.getElementById('exportButton'),
  exportModal: document.getElementById('exportModal'),
  exportForm: document.getElementById('exportForm'),
  closeExportModal: document.getElementById('closeExportModal'),
  cancelExport: document.getElementById('cancelExport'),
  downloadExport: document.getElementById('downloadExport'),
};

const priorityRank = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const classificationRank = {
  happy_path: 0,
  negative: 1,
  edge_case: 2,
};

const typeRank = {
  functional: 0,
  regression: 1,
  smoke: 2,
};

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatLabel(value) {
  if (!value) return 'Unknown';
  const text = String(value).replace(/_/g, ' ');
  return text.replace(/\b\w/g, match => match.toUpperCase());
}

function formatShortId(value, length = 8) {
  if (!value) return 'Unknown';
  const text = String(value);
  if (text.length <= length) return text;
  return `${text.slice(0, length)}...`;
}

function truncateText(value, maxLength = 56) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 10)}...${text.slice(-7)}`;
}

function getRank(rankMap, value) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const key = String(value).toLowerCase();
  return rankMap[key] ?? Number.MAX_SAFE_INTEGER;
}

function getStepOrder(step, fallbackIndex) {
  const parsed = Number(step?.step_number);
  return Number.isFinite(parsed) ? parsed : fallbackIndex + 1;
}

function sortScenarioItems(items) {
  return items.slice().sort((a, b) => {
    const aScenario = a.scenario || {};
    const bScenario = b.scenario || {};

    const priorityDiff = getRank(priorityRank, aScenario.priority) - getRank(priorityRank, bScenario.priority);
    if (priorityDiff !== 0) return priorityDiff;

    const classificationDiff = getRank(classificationRank, aScenario.scenario_classification) -
      getRank(classificationRank, bScenario.scenario_classification);
    if (classificationDiff !== 0) return classificationDiff;

    const typeDiff = getRank(typeRank, aScenario.test_type) - getRank(typeRank, bScenario.test_type);
    if (typeDiff !== 0) return typeDiff;

    return String(aScenario.test_name || '').localeCompare(String(bScenario.test_name || ''));
  });
}

function groupScenarios(items) {
  const groups = new Map();

  items.forEach(item => {
    const key = item.job_id || 'unknown';
    if (!groups.has(key)) {
      groups.set(key, {
        job_id: item.job_id,
        job_created_at: item.job_created_at,
        job_completed_at: item.job_completed_at,
        job_status: item.job_status,
        confluence_page_id: item.confluence_page_id,
        parent_jira_issue_id: item.parent_jira_issue_id,
        source_title: item.source_title,
        source_link: item.source_link,
        items: [],
      });
    }

    const group = groups.get(key);
    group.items.push(item);
    group.job_created_at = group.job_created_at || item.job_created_at;
    group.job_completed_at = group.job_completed_at || item.job_completed_at;
    group.confluence_page_id = group.confluence_page_id || item.confluence_page_id;
    group.parent_jira_issue_id = group.parent_jira_issue_id || item.parent_jira_issue_id;
    group.source_title = group.source_title || item.source_title;
    group.source_link = group.source_link || item.source_link;
    group.job_status = group.job_status || item.job_status;
  });

  return Array.from(groups.values()).sort((a, b) => {
    const aTime = new Date(a.job_created_at || 0).getTime();
    const bTime = new Date(b.job_created_at || 0).getTime();
    return bTime - aTime;
  });
}

function buildBadge(value) {
  if (!value) return '';
  const className = String(value).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return `<span class="badge ${className}">${escapeHtml(formatLabel(value))}</span>`;
}

function buildScenarioCard(item) {
  const scenario = item.scenario || {};
  const steps = Array.isArray(scenario.test_steps) ? scenario.test_steps.slice() : [];
  const preconditions = Array.isArray(scenario.preconditions) ? scenario.preconditions : [];
  const notes = scenario.validation_notes
    ? String(scenario.validation_notes).split(';').map(note => note.trim()).filter(Boolean)
    : [];

  steps.sort((a, b) => getStepOrder(a, 0) - getStepOrder(b, 0));

  const stepRows = steps.map((step, index) => `
    <tr>
      <td>${escapeHtml(getStepOrder(step, index))}</td>
      <td>${escapeHtml(step.action || '')}</td>
      <td>${escapeHtml(step.input || '')}</td>
      <td>${escapeHtml(step.expected_result || '')}</td>
    </tr>
  `).join('');

  const card = document.createElement('article');
  card.className = 'card review-card';
  card.innerHTML = `
    <div class="card-header">
      <div>
        <h3 class="card-title">${escapeHtml(scenario.test_name || 'Untitled scenario')}</h3>
        <div class="badge-row">
          ${buildBadge(scenario.test_type)}
          ${buildBadge(scenario.scenario_classification)}
          ${buildBadge(scenario.priority)}
          ${buildBadge(scenario.validation_status)}
        </div>
      </div>
      <div class="meta review-card-meta">
        <span>Test ID: ${escapeHtml(formatShortId(scenario.test_id))}</span>
      </div>
    </div>
    <p class="review-card-description">${escapeHtml(scenario.description || 'No description provided.')}</p>
    <div class="section">
      <h4>Preconditions</h4>
      <ul class="preconditions-list">
        ${preconditions.length > 0 ? preconditions.map(p => `<li>${escapeHtml(p)}</li>`).join('') : '<li>None provided</li>'}
      </ul>
    </div>
    <div class="section">
      <h4>Test Steps</h4>
      <table class="steps-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Action</th>
            <th>Input</th>
            <th>Expected Result</th>
          </tr>
        </thead>
        <tbody>
          ${stepRows || '<tr><td colspan="4">No steps provided</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="section">
      <h4>Metadata</h4>
      <div class="meta">
        <span>Folder: ${escapeHtml(scenario.test_repository_folder || 'N/A')}</span>
        <span>Automation: ${escapeHtml(formatLabel(scenario.automation_status || 'N/A'))}</span>
      </div>
    </div>
    ${notes.length > 0 ? `
      <div class="section review-notes">
        <h4>Validation Notes</h4>
        <ul>
          ${notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}
        </ul>
      </div>
    ` : ''}
    <div class="card-actions">
      <button class="primary" data-action="accept" data-job="${escapeHtml(item.job_id)}" data-test="${escapeHtml(scenario.test_id)}">Accept</button>
      <button class="ghost" data-action="edit" data-job="${escapeHtml(item.job_id)}" data-test="${escapeHtml(scenario.test_id)}">Edit</button>
      <button class="warn" data-action="dismiss" data-job="${escapeHtml(item.job_id)}" data-test="${escapeHtml(scenario.test_id)}">Dismiss</button>
    </div>
  `;

  return card;
}

async function loadScenarios() {
  elements.grid.innerHTML = '';
  elements.empty.classList.remove('active');
  elements.countPill.textContent = 'Loading...';

  try {
    const response = await fetch(`/api/review?status=${encodeURIComponent(state.status)}`);
    const data = await response.json();
    state.scenarios = Array.isArray(data.scenarios) ? data.scenarios : [];
    renderScenarios();
  } catch (error) {
    elements.countPill.textContent = 'Failed to load';
    elements.empty.classList.add('active');
  }
}

function renderScenarios() {
  const filtered = state.scenarios.filter(item => {
    if (!state.search) return true;
    const needle = state.search.toLowerCase();
    const scenario = item.scenario || {};
    return [
      scenario.test_name,
      item.job_id,
      item.parent_jira_issue_id,
      scenario.test_id,
      scenario.description,
    ]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(needle));
  });

  elements.grid.innerHTML = '';
  elements.countPill.textContent = `${filtered.length} scenario${filtered.length === 1 ? '' : 's'}`;

  if (filtered.length === 0) {
    elements.empty.classList.add('active');
    return;
  }

  elements.empty.classList.remove('active');

  const groups = groupScenarios(filtered);

  groups.forEach(group => {
    const groupEl = document.createElement('section');
    groupEl.className = 'review-group';

    const sourceLabel = group.source_title ||
      (group.source_link ? truncateText(group.source_link) : '') ||
      (group.confluence_page_id ? `Page ${group.confluence_page_id}` : 'Manual input');

    const sourceLink = group.source_link;
    const sourceHtml = sourceLink
      ? `<a class="review-group-link" href="${escapeHtml(sourceLink)}" target="_blank" rel="noopener">${escapeHtml(sourceLabel || sourceLink)}</a>`
      : `<span>${escapeHtml(sourceLabel)}</span>`;

    const metaParts = [
      `<span>Source: ${sourceHtml}</span>`,
      group.parent_jira_issue_id ? `<span>Jira: ${escapeHtml(group.parent_jira_issue_id)}</span>` : null,
      `<span>Created: ${escapeHtml(formatDate(group.job_created_at))}</span>`,
      group.job_completed_at
        ? `<span>Completed: ${escapeHtml(formatDate(group.job_completed_at))}</span>`
        : group.job_status
          ? `<span>Status: ${escapeHtml(formatLabel(group.job_status))}</span>`
          : null,
    ].filter(Boolean).join('');

    groupEl.innerHTML = `
      <header class="review-group-header">
        <div>
          <h2 class="review-group-title">Job ${escapeHtml(formatShortId(group.job_id))}</h2>
          <div class="review-group-meta">${metaParts}</div>
        </div>
        <div class="review-group-count">${group.items.length} scenario${group.items.length === 1 ? '' : 's'}</div>
      </header>
      <div class="review-group-body"></div>
    `;

    const body = groupEl.querySelector('.review-group-body');
    sortScenarioItems(group.items).forEach(item => {
      body.appendChild(buildScenarioCard(item));
    });

    elements.grid.appendChild(groupEl);
  });
}

async function updateValidation(jobId, testId, status, notes) {
  const response = await fetch(`/api/validate/${jobId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      test_id: testId,
      validation_status: status,
      validation_notes: notes || undefined,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to update validation');
  }
}

function openModal(item) {
  const scenario = item.scenario;
  elements.editJobId.value = item.job_id;
  elements.editTestId.value = scenario.test_id;
  elements.editTestName.value = scenario.test_name || '';
  elements.editTestType.value = scenario.test_type || 'functional';
  elements.editClassification.value = scenario.scenario_classification || 'happy_path';
  elements.editPriority.value = scenario.priority || 'medium';
  elements.editAutomationStatus.value = scenario.automation_status || 'automation_not_needed';
  elements.editRepositoryFolder.value = scenario.test_repository_folder || '';
  elements.editDescription.value = scenario.description || '';

  const preconditions = Array.isArray(scenario.preconditions) ? scenario.preconditions : [];
  elements.editPreconditions.value = preconditions.join('\n');

  const steps = Array.isArray(scenario.test_steps) ? scenario.test_steps : [];
  elements.editSteps.value = steps.map(step => {
    const action = step.action || '';
    const input = step.input || '(žiadny vstup)';
    const expectedResult = step.expected_result || '';
    return `${action} | ${input} | ${expectedResult}`;
  }).join('\n');

  elements.editNotes.value = scenario.validation_notes || '';

  elements.editModal.classList.remove('hidden');
  elements.editModal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  elements.editModal.classList.add('hidden');
  elements.editModal.setAttribute('aria-hidden', 'true');
}

elements.grid.addEventListener('click', async event => {
  const target = event.target instanceof Element ? event.target.closest('button[data-action]') : null;
  if (!target) return;

  const action = target.dataset.action;
  const jobId = target.dataset.job;
  const testId = target.dataset.test;
  if (!action || !jobId || !testId) return;

  const scenarioEntry = state.scenarios.find(item => item.job_id === jobId && item.scenario.test_id === testId);
  if (!scenarioEntry) return;

  try {
    if (action === 'accept') {
      await updateValidation(jobId, testId, 'validated');
      state.scenarios = state.scenarios.filter(item => item !== scenarioEntry);
      renderScenarios();
    }

    if (action === 'dismiss') {
      const confirmDismiss = window.confirm('Dismiss this scenario? It will stay in history but be hidden from review.');
      if (!confirmDismiss) return;
      await updateValidation(jobId, testId, 'dismissed', 'Dismissed via review UI');
      state.scenarios = state.scenarios.filter(item => item !== scenarioEntry);
      renderScenarios();
    }

    if (action === 'edit') {
      openModal(scenarioEntry);
    }
  } catch (error) {
    window.alert(error.message || 'Action failed');
  }
});

elements.editForm.addEventListener('submit', async event => {
  event.preventDefault();
  const jobId = elements.editJobId.value;
  const testId = elements.editTestId.value;

  const preconditions = elements.editPreconditions.value
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const testSteps = elements.editSteps.value
    .split(/\r?\n/)
    .map((line, idx) => {
      const parts = line.split('|').map(p => p.trim());
      const input = parts[1] || '';
      // Handle placeholder text for empty input
      const actualInput = (input === '(žiadny vstup)' || input === '(žiadne údaje)') ? '' : input;
      return {
        step_number: idx + 1,
        action: parts[0] || '',
        input: actualInput,
        expected_result: parts[2] || '',
      };
    })
    .filter(step => step.action);

  const payload = {
    test_name: elements.editTestName.value,
    test_type: elements.editTestType.value,
    scenario_classification: elements.editClassification.value,
    priority: elements.editPriority.value,
    automation_status: elements.editAutomationStatus.value,
    test_repository_folder: elements.editRepositoryFolder.value,
    description: elements.editDescription.value,
    preconditions: preconditions,
    test_steps: testSteps,
    validation_notes: elements.editNotes.value,
  };

  try {
    const response = await fetch(`/api/review/${jobId}/${testId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to save changes');
    }

    const entry = state.scenarios.find(item => item.job_id === jobId && item.scenario.test_id === testId);
    if (entry) {
      entry.scenario.test_name = payload.test_name;
      entry.scenario.test_type = payload.test_type;
      entry.scenario.scenario_classification = payload.scenario_classification;
      entry.scenario.priority = payload.priority;
      entry.scenario.automation_status = payload.automation_status;
      entry.scenario.test_repository_folder = payload.test_repository_folder;
      entry.scenario.description = payload.description;
      entry.scenario.preconditions = payload.preconditions;
      entry.scenario.test_steps = payload.test_steps;
      entry.scenario.validation_notes = payload.validation_notes;
    }

    closeModal();
    renderScenarios();
  } catch (error) {
    window.alert(error.message || 'Save failed');
  }
});

elements.closeModal.addEventListener('click', closeModal);
elements.cancelEdit.addEventListener('click', closeModal);
elements.editModal.addEventListener('click', event => {
  if (event.target === elements.editModal) {
    closeModal();
  }
});

elements.refreshButton.addEventListener('click', loadScenarios);
elements.cleanButton.addEventListener('click', async () => {
  const confirmClean = window.confirm(
    'This will permanently delete ALL scenarios that need review. This action cannot be undone.\n\nAre you sure?'
  );
  if (!confirmClean) return;

  try {
    elements.cleanButton.disabled = true;
    elements.cleanButton.textContent = 'Cleaning...';

    const response = await fetch('/api/review/clean', {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to clean scenarios');
    }

    const result = await response.json();
    window.alert(`Cleaned ${result.cleaned} scenario(s) from ${result.jobs_modified} job(s).`);
    await loadScenarios();
  } catch (error) {
    window.alert(error.message || 'Clean failed');
  } finally {
    elements.cleanButton.disabled = false;
    elements.cleanButton.textContent = 'Clean All';
  }
});

elements.statusFilter.addEventListener('change', event => {
  state.status = event.target.value;
  loadScenarios();
});

elements.searchInput.addEventListener('input', event => {
  state.search = event.target.value.trim();
  renderScenarios();
});

// Export functionality
let selectedExportFormat = 'excel';

function openExportModal() {
  elements.exportModal.classList.remove('hidden');
  elements.exportModal.setAttribute('aria-hidden', 'false');
}

function closeExportModal() {
  elements.exportModal.classList.add('hidden');
  elements.exportModal.setAttribute('aria-hidden', 'true');
}

elements.exportButton.addEventListener('click', openExportModal);
elements.closeExportModal.addEventListener('click', closeExportModal);
elements.cancelExport.addEventListener('click', closeExportModal);
elements.exportModal.addEventListener('click', event => {
  if (event.target === elements.exportModal) closeExportModal();
});

document.querySelectorAll('.export-format-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.export-format-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedExportFormat = btn.dataset.format;
  });
});

elements.exportForm.addEventListener('submit', async event => {
  event.preventDefault();

  const checkboxes = document.querySelectorAll('input[name="exportStatus"]:checked');
  const statuses = Array.from(checkboxes).map(cb => cb.value);

  if (statuses.length === 0) {
    window.alert('Vyberte aspoň jeden status na export.');
    return;
  }

  const downloadBtn = elements.downloadExport;
  downloadBtn.disabled = true;
  downloadBtn.textContent = 'Generujem...';

  try {
    const url = `/api/export/${selectedExportFormat}?status=${statuses.join(',')}`;
    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || error.error || 'Export zlyhal');
    }

    const blob = await response.blob();
    const ext = selectedExportFormat === 'excel' ? 'xlsx' : 'pdf';
    const filename = `test-scenarios-${new Date().toISOString().slice(0, 10)}.${ext}`;

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);

    closeExportModal();
  } catch (error) {
    window.alert(error.message || 'Export zlyhal');
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = 'Stiahnuť';
  }
});

loadScenarios();
