// Project Detail Page JavaScript

let projectId = null;
let currentProject = null;
let allCrossModuleTests = [];
let pollingInterval = null;

const filterState = {
  status: 'all',
  classification: 'all',
  search: '',
};

document.addEventListener('DOMContentLoaded', () => {
  projectId = getProjectIdFromUrl();
  if (!projectId) {
    window.location.href = '/projects';
    return;
  }
  loadProject();
  setupEventListeners();

  // Initialize export modal (shared helper from export-helper.js)
  if (typeof initExportModal === 'function') {
    initExportModal(
      () => allCrossModuleTests,
      () => currentProject ? currentProject.name : ''
    );
  }
});

function getProjectIdFromUrl() {
  const match = window.location.pathname.match(/\/project\/([^/]+)/);
  return match ? match[1] : null;
}

function setupEventListeners() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Create component buttons
  document.getElementById('createComponentBtn').addEventListener('click', openCreateModal);
  document.getElementById('createComponentEmptyBtn')?.addEventListener('click', openCreateModal);
  document.getElementById('cancelCreateBtn').addEventListener('click', closeCreateModal);

  // Edit project
  document.getElementById('editProjectBtn').addEventListener('click', openEditModal);
  document.getElementById('cancelEditBtn').addEventListener('click', closeEditModal);

  // Delete project
  document.getElementById('deleteProjectBtn').addEventListener('click', handleDeleteProject);

  // Modal overlays
  document.getElementById('createModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeCreateModal();
  });
  document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeEditModal();
  });

  // Forms
  document.getElementById('createComponentForm').addEventListener('submit', handleCreateComponent);
  document.getElementById('editProjectForm').addEventListener('submit', handleEditProject);

  // Cross-module test buttons
  document.getElementById('generateCrossModuleBtn').addEventListener('click', handleGenerateCrossModule);
  document.getElementById('generateCrossModuleEmptyBtn')?.addEventListener('click', handleGenerateCrossModule);
  document.getElementById('clearAllCrossModuleBtn').addEventListener('click', handleClearAllCrossModule);
  document.getElementById('exportCrossModuleBtn')?.addEventListener('click', openExportModal);

  // Max tests input
  const maxTestsInput = document.getElementById('maxCrossModuleTestsInput');
  if (maxTestsInput) {
    const stored = localStorage.getItem(`project:${projectId}:maxCrossModuleTests`);
    if (stored) maxTestsInput.value = stored;
    maxTestsInput.addEventListener('change', () => {
      localStorage.setItem(`project:${projectId}:maxCrossModuleTests`, maxTestsInput.value);
    });
  }

  // Filter controls
  const statusFilter = document.getElementById('crossModuleStatusFilter');
  const classificationFilter = document.getElementById('crossModuleClassificationFilter');
  const searchInput = document.getElementById('crossModuleSearchInput');

  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      filterState.status = e.target.value;
      renderFilteredCrossModuleTests();
    });
  }
  if (classificationFilter) {
    classificationFilter.addEventListener('change', (e) => {
      filterState.classification = e.target.value;
      renderFilteredCrossModuleTests();
    });
  }
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterState.search = e.target.value.trim().toLowerCase();
      renderFilteredCrossModuleTests();
    });
  }

  // Scenario edit modal
  const editScenarioModal = document.getElementById('editScenarioModal');
  const cancelScenarioEditBtn = document.getElementById('cancelScenarioEditBtn');
  const editScenarioForm = document.getElementById('editScenarioForm');

  if (editScenarioModal) {
    editScenarioModal.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) closeScenarioEditModal();
    });
  }
  if (cancelScenarioEditBtn) {
    cancelScenarioEditBtn.addEventListener('click', closeScenarioEditModal);
  }
  if (editScenarioForm) {
    editScenarioForm.addEventListener('submit', handleEditScenario);
  }

  // Add step button
  const addStepBtn = document.getElementById('addStepBtn');
  if (addStepBtn) {
    addStepBtn.addEventListener('click', addNewStep);
  }

  // Scenario action buttons (delegated)
  const crossModuleContainer = document.getElementById('crossModuleTestsContainer');
  if (crossModuleContainer) {
    crossModuleContainer.addEventListener('click', handleScenarioAction);
  }

  // Manual section
  const saveProjectManualBtn = document.getElementById('saveProjectManualBtn');
  if (saveProjectManualBtn) {
    saveProjectManualBtn.addEventListener('click', handleSaveProjectManual);
  }

  const removeManualBtn = document.getElementById('removeManualBtn');
  if (removeManualBtn) {
    removeManualBtn.addEventListener('click', handleRemoveProjectManual);
  }

  document.querySelectorAll('input[name="projectManualType"]').forEach(radio => {
    radio.addEventListener('change', handleProjectManualTypeChange);
  });
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `${tabName}Tab`);
  });
}

async function loadProject() {
  document.getElementById('componentsGrid').innerHTML = '<div class="loading-spinner"></div>';

  try {
    const response = await fetch(`/api/projects/${projectId}`);
    if (!response.ok) {
      if (response.status === 404) {
        showToast('Projekt nebol nájdený', 'error');
        window.location.href = '/projects';
        return;
      }
      throw new Error('Failed to load project');
    }

    const project = await response.json();
    currentProject = project;
    renderProject(project);
    loadCrossModuleTests();
    loadCrossModuleJobHistory();
  } catch (error) {
    console.error('Error loading project:', error);
    showError('Failed to load project');
  }
}

function renderProject(project) {
  document.title = `${project.name} - Test Scenario Generator`;
  document.getElementById('breadcrumbName').textContent = project.name;
  document.getElementById('projectName').textContent = project.name;
  document.getElementById('projectDescription').textContent = project.description || 'Bez popisu';

  // Populate edit form
  document.getElementById('editProjectName').value = project.name;
  document.getElementById('editProjectDescription').value = project.description || '';

  const components = project.components || [];
  document.getElementById('componentCount').textContent = `${components.length} komponentov`;

  // Calculate stats
  let totalPages = 0;
  let totalTests = 0;
  components.forEach(c => {
    totalPages += c.page_count || 0;
    totalTests += (c.page_level_tests || 0) + (c.component_level_tests || 0);
  });

  document.getElementById('totalComponents').textContent = components.length;
  document.getElementById('totalPages').textContent = totalPages;
  document.getElementById('totalTests').textContent = totalTests;

  const crossModuleCount = project.project_tests?.scenarios?.length || 0;
  document.getElementById('totalCrossModuleTests').textContent = crossModuleCount;

  renderComponents(components);
  displayProjectManual(project.project_context);
}

function renderComponents(components) {
  const grid = document.getElementById('componentsGrid');
  const emptyState = document.getElementById('emptyState');

  if (components.length === 0) {
    grid.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  grid.style.display = 'grid';
  emptyState.style.display = 'none';

  grid.innerHTML = components.map(component => `
    <a href="/component/${component.component_id}" class="item-card">
      <h3>${escapeHtml(component.name)}</h3>
      <p>${escapeHtml(component.description || 'Bez popisu')}</p>
      <div class="item-card-meta">
        <span>${component.page_count || 0} stránok</span>
        <span>${component.page_level_tests || 0} testov stránok</span>
        <span>${component.component_level_tests || 0} integračných testov</span>
      </div>
    </a>
  `).join('');
}

// ── Cross-Module Tests ────────────────────────────────────────────────

async function loadCrossModuleTests() {
  try {
    const response = await fetch(`/api/projects/${projectId}/tests`);
    if (!response.ok) throw new Error('Failed to load cross-module tests');

    const data = await response.json();
    allCrossModuleTests = data.scenarios || [];

    document.getElementById('crossModuleTestCount').textContent =
      `${data.total || 0} cross-module test${data.total !== 1 ? 'ov' : ''}`;

    document.getElementById('totalCrossModuleTests').textContent = data.total || 0;

    updateCrossModuleStats();
    renderFilteredCrossModuleTests();
  } catch (error) {
    console.error('Error loading cross-module tests:', error);
  }
}

function updateCrossModuleStats() {
  const total = allCrossModuleTests.length;
  const validated = allCrossModuleTests.filter(s => s.validation_status === 'validated').length;
  const needsReview = allCrossModuleTests.filter(s => s.validation_status === 'needs_review').length;

  document.getElementById('totalCrossModuleScenarios').textContent = total;
  document.getElementById('validatedCrossModuleScenarios').textContent = validated;
  document.getElementById('needsReviewCrossModuleScenarios').textContent = needsReview;
}

function renderFilteredCrossModuleTests() {
  const filtered = allCrossModuleTests.filter(scenario => {
    if (filterState.status !== 'all' && scenario.validation_status !== filterState.status) return false;
    if (filterState.classification !== 'all' && scenario.scenario_classification !== filterState.classification) return false;
    if (filterState.search) {
      const searchable = [scenario.test_name, scenario.description, scenario.test_id]
        .filter(Boolean).join(' ').toLowerCase();
      if (!searchable.includes(filterState.search)) return false;
    }
    return true;
  });

  renderCrossModuleTests(filtered);
}

function renderCrossModuleTests(scenarios) {
  const container = document.getElementById('crossModuleTestsContainer');
  const emptyState = document.getElementById('crossModuleEmptyState');
  const filterControls = document.getElementById('crossModuleFilterControls');

  if (allCrossModuleTests.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    if (filterControls) filterControls.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  if (filterControls) filterControls.style.display = 'flex';

  if (scenarios.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Ziadne vyhovujuce scenare</h3>
        <p>Skuste upravit filtre</p>
      </div>
    `;
    return;
  }

  container.innerHTML = scenarios.map(scenario => `
    <div class="card review-card ${scenario.validation_status === 'needs_review' ? 'needs-review' : ''}" data-test-id="${escapeHtml(scenario.test_id)}">
      <div class="card-header">
        <div>
          <h3 class="card-title">${escapeHtml(scenario.test_name)}</h3>
          <div class="badge-row">
            <span class="badge ${scenario.scenario_classification}">${formatLabel(scenario.scenario_classification)}</span>
            <span class="badge ${scenario.priority}">${formatLabel(scenario.priority)}</span>
            <span class="badge ${scenario.test_type}">${formatLabel(scenario.test_type)}</span>
            <span class="badge ${scenario.validation_status}">${formatLabel(scenario.validation_status)}</span>
          </div>
        </div>
        <div class="meta review-card-meta">
          <span>ID: ${escapeHtml(formatShortId(scenario.test_id))}</span>
        </div>
      </div>

      ${scenario.description ? `<p class="review-card-description">${escapeHtml(scenario.description)}</p>` : ''}

      <div class="section">
        <h4>Predpoklady</h4>
        <ul class="preconditions-list">
          ${(scenario.preconditions || []).length > 0
            ? (scenario.preconditions || []).map(p => `<li>${escapeHtml(p)}</li>`).join('')
            : '<li>Ziadne</li>'}
        </ul>
      </div>

      <div class="section">
        <h4>Kroky testu</h4>
        <table class="steps-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Akcia</th>
              <th>Vstup</th>
              <th>Ocakavany vysledok</th>
            </tr>
          </thead>
          <tbody>
            ${(scenario.test_steps || []).map(step => `
              <tr>
                <td>${escapeHtml(step.step_number || '')}</td>
                <td>${escapeHtml(step.action || '')}</td>
                <td>${escapeHtml(step.input || '')}</td>
                <td>${escapeHtml(step.expected_result || '')}</td>
              </tr>
            `).join('') || '<tr><td colspan="4">Ziadne kroky</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="section">
        <h4>Metadata</h4>
        <div class="meta">
          <span>Folder: ${escapeHtml(scenario.test_repository_folder || 'N/A')}</span>
          <span>Automatizacia: ${escapeHtml(formatLabel(scenario.automation_status || 'N/A'))}</span>
        </div>
      </div>

      ${scenario.validation_notes ? `
        <div class="section review-notes">
          <h4>Poznamky k validacii</h4>
          <p>${escapeHtml(scenario.validation_notes)}</p>
        </div>
      ` : ''}

      <div class="card-actions">
        ${scenario.validation_status === 'needs_review' ? `
          <button class="primary" data-action="accept" data-test-id="${escapeHtml(scenario.test_id)}">Prijat</button>
        ` : ''}
        <button class="ghost" data-action="edit" data-test-id="${escapeHtml(scenario.test_id)}">Upravit</button>
        ${scenario.validation_status !== 'dismissed' ? `
          <button class="warn" data-action="dismiss" data-test-id="${escapeHtml(scenario.test_id)}">Zamietnuť</button>
        ` : ''}
        <button class="danger" data-action="delete" data-test-id="${escapeHtml(scenario.test_id)}">Zmazat</button>
      </div>
    </div>
  `).join('');
}

async function handleScenarioAction(e) {
  const button = e.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const testId = button.dataset.testId;
  if (!action || !testId) return;

  const scenario = allCrossModuleTests.find(s => s.test_id === testId);
  if (!scenario) return;

  try {
    if (action === 'accept') {
      await updateScenarioValidation(testId, 'validated');
      scenario.validation_status = 'validated';
      renderFilteredCrossModuleTests();
      updateCrossModuleStats();
    } else if (action === 'dismiss') {
      if (!(await showConfirm('Zamietnuť tento scenár?'))) return;
      await updateScenarioValidation(testId, 'dismissed', 'Zamietnuty cez project review');
      scenario.validation_status = 'dismissed';
      renderFilteredCrossModuleTests();
      updateCrossModuleStats();
    } else if (action === 'delete') {
      if (!(await showConfirm('Zmazať tento scenár natrvalo? Túto akciu nie je možné vrátiť.', 'Zmazať', 'Zrušiť', true))) return;
      await deleteScenario(testId);
      allCrossModuleTests = allCrossModuleTests.filter(s => s.test_id !== testId);
      renderFilteredCrossModuleTests();
      updateCrossModuleStats();
    } else if (action === 'edit') {
      openScenarioEditModal(scenario);
    }
  } catch (error) {
    showToast('Akcia zlyhala: ' + error.message, 'error');
  }
}

async function updateScenarioValidation(testId, status, notes) {
  const response = await fetch(`/api/projects/${projectId}/tests/${testId}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      validation_status: status,
      validation_notes: notes || undefined,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.message || 'Failed to update validation');
  }
}

async function deleteScenario(testId) {
  const response = await fetch(`/api/projects/${projectId}/tests/${testId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.message || 'Failed to delete scenario');
  }
}

async function handleGenerateCrossModule() {
  const btn = document.getElementById('generateCrossModuleBtn');
  const originalText = btn.textContent;
  const maxTestsInput = document.getElementById('maxCrossModuleTestsInput');
  const maxTestsValue = maxTestsInput ? parseInt(maxTestsInput.value, 10) : NaN;
  const payload = Number.isFinite(maxTestsValue) && maxTestsValue > 0
    ? { max_tests: maxTestsValue }
    : null;

  try {
    btn.disabled = true;
    btn.textContent = 'Startujem...';

    const response = await fetch(`/api/projects/${projectId}/generate`, {
      method: 'POST',
      headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || error.message || 'Failed to generate cross-module tests');
    }

    const result = await response.json();
    showGenerationStatus('processing', 'Generovanie cross-module testov spustene...');
    startPolling(result.job_id);
  } catch (error) {
    console.error('Error generating cross-module tests:', error);
    showToast('Chyba: ' + error.message, 'error');
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function startPolling(jobId) {
  if (pollingInterval) clearInterval(pollingInterval);

  const btn = document.getElementById('generateCrossModuleBtn');
  btn.disabled = true;
  btn.textContent = 'Generujem...';

  pollingInterval = setInterval(async () => {
    try {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) throw new Error('Failed to check job status');

      const job = await response.json();

      if (job.status === 'completed') {
        stopPolling();
        showGenerationStatus('success', 'Generovanie cross-module testov dokoncene!');
        loadCrossModuleTests();
        loadCrossModuleJobHistory();
        btn.disabled = false;
        btn.textContent = 'Generovat Cross-Module Testy';
      } else if (job.status === 'failed') {
        stopPolling();
        showGenerationStatus('error', `Generovanie zlyhalo: ${job.error || 'Neznama chyba'}`);
        btn.disabled = false;
        btn.textContent = 'Generovat Cross-Module Testy';
      } else {
        showGenerationStatus('loading', 'Generovanie cross-module testov prebieha...');
      }
    } catch (error) {
      console.error('Error polling job status:', error);
    }
  }, 3000);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

function showGenerationStatus(type, message) {
  const statusEl = document.getElementById('crossModuleGenerationStatus');
  const messageEl = document.getElementById('crossModuleGenerationStatusMessage');

  statusEl.style.display = 'block';
  statusEl.className = `status ${type}`;
  messageEl.textContent = message;

  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 5000);
  }
}

async function handleClearAllCrossModule() {
  const testCount = allCrossModuleTests.length;
  if (testCount === 0) {
    showToast('Žiadne cross-module testy na vymazanie.', 'warning');
    return;
  }

  if (!(await showConfirm(`Naozaj chcete vymazať všetkých ${testCount} cross-module testov? Túto akciu nie je možné vrátiť.`, 'Vymazať všetko', 'Zrušiť', true))) {
    return;
  }

  const btn = document.getElementById('clearAllCrossModuleBtn');
  const originalText = btn.textContent;

  try {
    btn.disabled = true;
    btn.textContent = 'Mazem...';

    const response = await fetch(`/api/projects/${projectId}/tests`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to clear tests');
    }

    const result = await response.json();
    allCrossModuleTests = [];
    renderFilteredCrossModuleTests();
    updateCrossModuleStats();
    document.getElementById('totalCrossModuleTests').textContent = '0';
    showToast(`Úspešne vymazaných ${result.deleted_count} cross-module testov.`, 'success');
  } catch (error) {
    console.error('Error clearing cross-module tests:', error);
    showToast('Chyba: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function loadCrossModuleJobHistory() {
  try {
    const response = await fetch(`/api/projects/${projectId}/jobs`);
    if (!response.ok) throw new Error('Failed to load job history');

    const data = await response.json();
    renderCrossModuleJobHistory(data.jobs || []);
  } catch (error) {
    console.error('Error loading job history:', error);
    renderCrossModuleJobHistory([]);
  }
}

function renderCrossModuleJobHistory(jobs) {
  const container = document.getElementById('crossModuleJobHistoryContainer');

  if (jobs.length === 0) {
    container.innerHTML = '<p class="muted">Ziadna historia generovania</p>';
    return;
  }

  container.innerHTML = `
    <table class="scenarios-table">
      <thead>
        <tr>
          <th>Job ID</th>
          <th>Status</th>
          <th>Scenare</th>
          <th>Vytvorene</th>
          <th>Dokoncene</th>
        </tr>
      </thead>
      <tbody>
        ${jobs.map(job => `
          <tr>
            <td><code>${escapeHtml(job.job_id.slice(0, 8))}...</code></td>
            <td><span class="badge ${job.status}">${escapeHtml(job.status)}</span></td>
            <td>${job.scenario_count || '-'}</td>
            <td>${formatDateTime(job.created_at)}</td>
            <td>${job.completed_at ? formatDateTime(job.completed_at) : '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ── Scenario Edit Modal ───────────────────────────────────────────────

function openScenarioEditModal(scenario) {
  document.getElementById('editScenarioTestId').value = scenario.test_id;
  document.getElementById('editScenarioName').value = scenario.test_name || '';
  document.getElementById('editScenarioPriority').value = scenario.priority || 'medium';
  document.getElementById('editScenarioType').value = scenario.test_type || 'functional';
  document.getElementById('editScenarioClassification').value = scenario.scenario_classification || 'happy_path';
  document.getElementById('editScenarioAutomation').value = scenario.automation_status || 'automation_not_needed';
  document.getElementById('editScenarioDescription').value = scenario.description || '';
  document.getElementById('editScenarioFolder').value = scenario.test_repository_folder || '';
  document.getElementById('editScenarioNotes').value = scenario.validation_notes || '';

  const preconditions = Array.isArray(scenario.preconditions) ? scenario.preconditions : [];
  document.getElementById('editScenarioPreconditions').value = preconditions.join('\n');

  const stepsContainer = document.getElementById('editScenarioStepsContainer');
  stepsContainer.innerHTML = '';

  const steps = Array.isArray(scenario.test_steps) ? scenario.test_steps : [];
  if (steps.length === 0) {
    addStepToContainer(stepsContainer, 1, '', '', '');
  } else {
    steps.forEach((step, idx) => {
      addStepToContainer(stepsContainer, idx + 1, step.action || '', step.input || '', step.expected_result || '');
    });
  }

  document.getElementById('editScenarioModal').classList.add('active');
  document.getElementById('editScenarioName').focus();
}

function addStepToContainer(container, stepNumber, action, input, expectedResult) {
  const stepRow = document.createElement('div');
  stepRow.className = 'step-row';
  stepRow.innerHTML = `
    <div class="step-number">${stepNumber}</div>
    <div class="step-field">
      <span class="step-field-label">Akcia</span>
      <input type="text" class="step-action" value="${escapeHtml(action)}" placeholder="Napr. [Modul] → Akcia">
    </div>
    <div class="step-field">
      <span class="step-field-label">Vstup</span>
      <input type="text" class="step-input" value="${escapeHtml(input)}" placeholder="Vstupne udaje">
    </div>
    <div class="step-field">
      <span class="step-field-label">Ocakavany vysledok</span>
      <input type="text" class="step-expected" value="${escapeHtml(expectedResult)}" placeholder="Ocakavany vysledok kroku">
    </div>
    <button type="button" class="remove-step-btn" onclick="removeStep(this)" title="Odstranit krok">&times;</button>
  `;
  container.appendChild(stepRow);
}

function addNewStep() {
  const container = document.getElementById('editScenarioStepsContainer');
  const currentSteps = container.querySelectorAll('.step-row').length;
  addStepToContainer(container, currentSteps + 1, '', '', '');
  const newRow = container.lastElementChild;
  const actionInput = newRow.querySelector('.step-action');
  if (actionInput) actionInput.focus();
}

function removeStep(btn) {
  const stepRow = btn.closest('.step-row');
  const container = stepRow.parentElement;
  stepRow.remove();
  container.querySelectorAll('.step-row').forEach((row, idx) => {
    row.querySelector('.step-number').textContent = idx + 1;
  });
}

window.removeStep = removeStep;
window.addNewStep = addNewStep;

function closeScenarioEditModal() {
  document.getElementById('editScenarioModal').classList.remove('active');
}

async function handleEditScenario(e) {
  e.preventDefault();

  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  const testId = document.getElementById('editScenarioTestId').value;

  const preconditions = document.getElementById('editScenarioPreconditions').value
    .split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const stepsContainer = document.getElementById('editScenarioStepsContainer');
  const stepRows = stepsContainer.querySelectorAll('.step-row');
  const testSteps = [];

  stepRows.forEach((row, idx) => {
    const action = row.querySelector('.step-action')?.value.trim() || '';
    const input = row.querySelector('.step-input')?.value.trim() || '';
    const expectedResult = row.querySelector('.step-expected')?.value.trim() || '';

    if (action) {
      testSteps.push({ step_number: idx + 1, action, input, expected_result: expectedResult });
    }
  });

  const payload = {
    test_name: document.getElementById('editScenarioName').value.trim(),
    test_type: document.getElementById('editScenarioType').value,
    scenario_classification: document.getElementById('editScenarioClassification').value,
    priority: document.getElementById('editScenarioPriority').value,
    automation_status: document.getElementById('editScenarioAutomation').value,
    test_repository_folder: document.getElementById('editScenarioFolder').value.trim(),
    description: document.getElementById('editScenarioDescription').value.trim(),
    preconditions,
    test_steps: testSteps,
    validation_notes: document.getElementById('editScenarioNotes').value.trim(),
  };

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Ukladam...';

    const response = await fetch(`/api/projects/${projectId}/tests/${testId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || error.message || 'Failed to save changes');
    }

    const scenario = allCrossModuleTests.find(s => s.test_id === testId);
    if (scenario) Object.assign(scenario, payload);

    closeScenarioEditModal();
    renderFilteredCrossModuleTests();
  } catch (error) {
    showToast('Chyba pri ukladaní: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

// ── Export ─────────────────────────────────────────────────────────────

function openExportModal() {
  const modal = document.getElementById('exportModal');
  if (modal) modal.classList.add('active');
}

// ── Original Project Functions ────────────────────────────────────────

function openCreateModal() {
  document.getElementById('createModal').classList.add('active');
  document.getElementById('componentName').focus();
}

function closeCreateModal() {
  document.getElementById('createModal').classList.remove('active');
  document.getElementById('createComponentForm').reset();
}

function openEditModal() {
  document.getElementById('editModal').classList.add('active');
  document.getElementById('editProjectName').focus();
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('active');
}

async function handleCreateComponent(e) {
  e.preventDefault();

  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Vytváram...';

    const name = document.getElementById('componentName').value.trim();
    const description = document.getElementById('componentDescription').value.trim();

    const response = await fetch(`/api/components/project/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: description || undefined }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create component');
    }

    const component = await response.json();
    closeCreateModal();
    window.location.href = `/component/${component.component_id}`;
  } catch (error) {
    console.error('Error creating component:', error);
    showToast('Nepodarilo sa vytvoriť komponent: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

async function handleEditProject(e) {
  e.preventDefault();

  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Ukladám...';

    const name = document.getElementById('editProjectName').value.trim();
    const description = document.getElementById('editProjectDescription').value.trim();

    const response = await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: description || undefined }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update project');
    }

    closeEditModal();
    loadProject();
    if (window.sidebarRefresh) window.sidebarRefresh();
  } catch (error) {
    console.error('Error updating project:', error);
    showToast('Nepodarilo sa aktualizovať projekt: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

async function handleDeleteProject() {
  if (!(await showConfirm(`Naozaj chcete zmazať "${currentProject.name}"? Toto vymaže aj všetky komponenty a stránky v tomto projekte. Túto akciu nie je možné vrátiť.`, 'Zmazať', 'Zrušiť', true))) {
    return;
  }

  try {
    const response = await fetch(`/api/projects/${projectId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete project');
    }

    window.location.href = '/projects';
  } catch (error) {
    console.error('Error deleting project:', error);
    showToast('Nepodarilo sa zmazať projekt: ' + error.message, 'error');
  }
}

// ── Manual/Handbook Management ────────────────────────────────────────

function handleProjectManualTypeChange(e) {
  const selectedType = e.target.value;
  document.getElementById('projectManualTextInput').style.display = selectedType === 'text' ? 'block' : 'none';
  document.getElementById('projectManualFileInput').style.display = selectedType === 'file' ? 'block' : 'none';
}

async function handleSaveProjectManual() {
  const saveBtn = document.getElementById('saveProjectManualBtn');
  const originalText = saveBtn.textContent;

  try {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Ukladam...';

    const selectedType = document.querySelector('input[name="projectManualType"]:checked').value;

    let response;
    if (selectedType === 'text') {
      const text = document.getElementById('projectManualText').value.trim();
      if (!text) {
        showToast('Zadajte text príručky', 'warning');
        return;
      }

      response = await fetch(`/api/projects/${projectId}/manual/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manual_text: text }),
      });
    } else {
      const fileInput = document.getElementById('projectManualFile');
      const file = fileInput.files[0];
      if (!file) {
        showToast('Vyberte súbor', 'warning');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);

      response = await fetch(`/api/projects/${projectId}/manual/file`, {
        method: 'POST',
        body: formData,
      });
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Nepodarilo sa ulozit prirucku');
    }

    await loadProject();
  } catch (error) {
    showToast('Chyba pri ukladaní: ' + error.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
}

async function handleRemoveProjectManual() {
  if (!(await showConfirm('Naozaj chcete odstrániť príručku?'))) return;

  try {
    const response = await fetch(`/api/projects/${projectId}/manual`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Nepodarilo sa odstranit prirucku');
    }

    await loadProject();
  } catch (error) {
    showToast('Chyba: ' + error.message, 'error');
  }
}

function displayProjectManual(projectContext) {
  const display = document.getElementById('projectManualDisplay');
  const uploadForm = document.getElementById('projectManualUploadForm');
  const content = document.getElementById('projectManualContent');
  const meta = document.getElementById('projectManualMeta');
  const formTitle = document.getElementById('projectManualFormTitle');
  const saveBtn = document.getElementById('saveProjectManualBtn');

  if (!projectContext || (!projectContext.manual_text && !projectContext.manual_file)) {
    display.style.display = 'none';
    uploadForm.style.display = 'block';
    if (formTitle) formTitle.textContent = 'Nahrat prirucku';
    if (saveBtn) saveBtn.textContent = 'Ulozit prirucku';
    return;
  }

  display.style.display = 'block';
  uploadForm.style.display = 'block';

  if (projectContext.manual_text) {
    const text = projectContext.manual_text;
    const truncated = text.length > 500 ? text.substring(0, 500) + '...' : text;
    content.textContent = truncated;
    content.style.display = 'block';
  } else if (projectContext.is_chunked) {
    content.textContent = '(Prirucka je rozdelena na casti kvoli velkosti - plny text nie je zobrazeny)';
    content.style.display = 'block';
  } else {
    content.style.display = 'none';
  }

  const metaParts = [];
  if (projectContext.added_at) {
    metaParts.push(`Pridane: ${formatDateTime(projectContext.added_at)}`);
  }
  if (projectContext.manual_file) {
    metaParts.push(`Subor: ${projectContext.manual_file.filename} (${projectContext.manual_file.file_type})`);
  }
  if (projectContext.manual_text) {
    metaParts.push(`Dlzka: ${projectContext.manual_text.length} znakov`);
  }
  if (projectContext.is_chunked && projectContext.chunking_info) {
    metaParts.push(`Chunky: ${projectContext.chunking_info.total_chunks} casti`);
  }

  meta.innerHTML = metaParts.map(p => `<span>${escapeHtml(p)}</span>`).join(' | ');

  if (formTitle) formTitle.textContent = 'Nahradit prirucku';
  if (saveBtn) saveBtn.textContent = 'Nahradit prirucku';
}

// ── Utility Functions ─────────────────────────────────────────────────

function showError(message) {
  const grid = document.getElementById('componentsGrid');
  grid.innerHTML = `
    <div class="empty-state">
      <h3>Chyba</h3>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="primary" onclick="loadProject()">Skúsiť znova</button>
    </div>
  `;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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

function formatDateTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleString();
}

// Cleanup on page unload
window.addEventListener('beforeunload', stopPolling);
