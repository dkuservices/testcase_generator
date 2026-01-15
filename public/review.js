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
  editPreconditions: document.getElementById('editPreconditions'),
  editSteps: document.getElementById('editSteps'),
  editExpected: document.getElementById('editExpected'),
  editNotes: document.getElementById('editNotes'),
};

function escapeHtml(value) {
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
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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

  filtered.forEach(item => {
    const scenario = item.scenario;
    const steps = Array.isArray(scenario.test_steps) ? scenario.test_steps : [];

    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-header">
        <div>
          <p class="card-title">${escapeHtml(scenario.test_name)}</p>
          <div class="meta">
            <span class="tag">${escapeHtml(scenario.test_type)}</span>
            <span class="tag">${escapeHtml(scenario.scenario_classification)}</span>
            <span class="tag">Priority: ${escapeHtml(scenario.priority)}</span>
          </div>
        </div>
        <div class="meta">
          <span>Job: ${escapeHtml(item.job_id)}</span>
          <span>Jira: ${escapeHtml(item.parent_jira_issue_id || 'N/A')}</span>
        </div>
      </div>
      <div class="section">
        <h4>Preconditions</h4>
        <p>${escapeHtml(scenario.preconditions || 'None')}</p>
      </div>
      <div class="section">
        <h4>Test steps</h4>
        <ol class="steps">
          ${steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
        </ol>
      </div>
      <div class="section">
        <h4>Expected result</h4>
        <p>${escapeHtml(scenario.expected_result || 'None')}</p>
      </div>
      <div class="meta">
        <span>Created: ${escapeHtml(formatDate(item.job_created_at))}</span>
        <span>Completed: ${escapeHtml(formatDate(item.job_completed_at))}</span>
      </div>
      <div class="card-actions">
        <button class="primary" data-action="accept" data-job="${escapeHtml(item.job_id)}" data-test="${escapeHtml(scenario.test_id)}">Accept</button>
        <button class="ghost" data-action="edit" data-job="${escapeHtml(item.job_id)}" data-test="${escapeHtml(scenario.test_id)}">Edit</button>
        <button class="warn" data-action="dismiss" data-job="${escapeHtml(item.job_id)}" data-test="${escapeHtml(scenario.test_id)}">Dismiss</button>
      </div>
    `;

    elements.grid.appendChild(card);
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
  elements.editPreconditions.value = scenario.preconditions || '';
  elements.editSteps.value = Array.isArray(scenario.test_steps) ? scenario.test_steps.join('\n') : '';
  elements.editExpected.value = scenario.expected_result || '';
  elements.editNotes.value = scenario.validation_notes || '';

  elements.editModal.classList.remove('hidden');
  elements.editModal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  elements.editModal.classList.add('hidden');
  elements.editModal.setAttribute('aria-hidden', 'true');
}

elements.grid.addEventListener('click', async event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  if (!action) return;

  const jobId = target.dataset.job;
  const testId = target.dataset.test;
  if (!jobId || !testId) return;

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

  const payload = {
    test_name: elements.editTestName.value,
    test_type: elements.editTestType.value,
    scenario_classification: elements.editClassification.value,
    priority: elements.editPriority.value,
    preconditions: elements.editPreconditions.value,
    test_steps: elements.editSteps.value,
    expected_result: elements.editExpected.value,
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
      entry.scenario.preconditions = payload.preconditions;
      entry.scenario.test_steps = payload.test_steps.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      entry.scenario.expected_result = payload.expected_result;
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
elements.statusFilter.addEventListener('change', event => {
  state.status = event.target.value;
  loadScenarios();
});
elements.searchInput.addEventListener('input', event => {
  state.search = event.target.value.trim();
  renderScenarios();
});

loadScenarios();
