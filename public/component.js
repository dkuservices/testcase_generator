// Component Detail Page JavaScript

let componentId = null;
let currentComponent = null;
let allIntegrationTests = []; // Store all integration tests for filtering
let pollingInterval = null;
let generateAllInProgress = false;

const chatState = {
  messages: [],
  pendingEl: null,
};

const filterState = {
  status: 'all',
  classification: 'all',
  search: '',
};

// Initialize chatElements as null - will be set in DOMContentLoaded
let chatElements = {
  panel: null,
  log: null,
  empty: null,
  form: null,
  input: null,
  sendBtn: null,
  clearBtn: null,
  context: null,
};

document.addEventListener('DOMContentLoaded', () => {
  // Initialize chat elements after DOM is ready
  chatElements = {
    panel: document.getElementById('chatPanel'),
    log: document.getElementById('chatLog'),
    empty: document.getElementById('chatEmpty'),
    form: document.getElementById('chatForm'),
    input: document.getElementById('chatInput'),
    sendBtn: document.getElementById('chatSendBtn'),
    clearBtn: document.getElementById('chatClearBtn'),
    context: document.getElementById('chatContext'),
  };

  componentId = getComponentIdFromUrl();
  if (!componentId) {
    window.location.href = '/projects';
    return;
  }

  // Reset filter state when loading a new component
  resetFilterState();

  loadComponent();
  setupEventListeners();

  // Initialize export modal (shared helper from export-helper.js)
  if (typeof initExportModal === 'function') {
    initExportModal(
      () => allIntegrationTests,
      () => currentComponent ? currentComponent.name : ''
    );
  }
});

function resetFilterState() {
  filterState.status = 'all';
  filterState.classification = 'all';
  filterState.search = '';

  // Reset UI filter controls
  const statusFilter = document.getElementById('integrationStatusFilter');
  const classificationFilter = document.getElementById('integrationClassificationFilter');
  const searchInput = document.getElementById('integrationSearchInput');

  if (statusFilter) statusFilter.value = 'all';
  if (classificationFilter) classificationFilter.value = 'all';
  if (searchInput) searchInput.value = '';
}

function getComponentIdFromUrl() {
  const match = window.location.pathname.match(/\/component\/([^/]+)/);
  return match ? match[1] : null;
}

function setupEventListeners() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Add page buttons
  document.getElementById('addPageBtn').addEventListener('click', openAddPageModal);
  document.getElementById('addPageEmptyBtn')?.addEventListener('click', openAddPageModal);
  document.getElementById('cancelAddPageBtn').addEventListener('click', closeAddPageModal);

  // Edit component
  document.getElementById('editComponentBtn').addEventListener('click', openEditModal);
  document.getElementById('cancelEditBtn').addEventListener('click', closeEditModal);

  // Delete component
  document.getElementById('deleteComponentBtn').addEventListener('click', handleDeleteComponent);

  // Generate integration tests
  document.getElementById('generateIntegrationBtn').addEventListener('click', handleGenerateIntegration);
  document.getElementById('generateIntegrationEmptyBtn')?.addEventListener('click', handleGenerateIntegration);

  // Generate All (both page tests and integration tests)
  document.getElementById('generateAllBtn')?.addEventListener('click', handleGenerateAll);

  // Clear all integration tests
  document.getElementById('clearAllIntegrationBtn').addEventListener('click', handleClearAllIntegration);

  // Modal overlays
  document.getElementById('addPageModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeAddPageModal();
  });
  document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeEditModal();
  });

  // Forms
  document.getElementById('addPageForm').addEventListener('submit', handleAddPage);
  document.getElementById('editComponentForm').addEventListener('submit', handleEditComponent);

  const maxTestsInput = document.getElementById('maxIntegrationTestsInput');
  if (maxTestsInput) {
    const stored = localStorage.getItem(`component:${componentId}:maxIntegrationTests`);
    if (stored) {
      maxTestsInput.value = stored;
    }
    maxTestsInput.addEventListener('change', () => {
      localStorage.setItem(`component:${componentId}:maxIntegrationTests`, maxTestsInput.value);
    });
  }

  if (chatElements.form) {
    chatElements.form.addEventListener('submit', handleChatSubmit);
  }
  if (chatElements.clearBtn) {
    chatElements.clearBtn.addEventListener('click', resetChat);
  }

  // Integration test filter controls
  const statusFilter = document.getElementById('integrationStatusFilter');
  const classificationFilter = document.getElementById('integrationClassificationFilter');
  const searchInput = document.getElementById('integrationSearchInput');

  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      filterState.status = e.target.value;
      renderFilteredIntegrationTests();
    });
  }
  if (classificationFilter) {
    classificationFilter.addEventListener('change', (e) => {
      filterState.classification = e.target.value;
      renderFilteredIntegrationTests();
    });
  }
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterState.search = e.target.value.trim().toLowerCase();
      renderFilteredIntegrationTests();
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
  const integrationContainer = document.getElementById('integrationTestsContainer');
  if (integrationContainer) {
    integrationContainer.addEventListener('click', handleScenarioAction);
  }
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `${tabName}Tab`);
  });
}

async function loadComponent() {
  try {
    const response = await fetch(`/api/components/${componentId}`);
    if (!response.ok) {
      if (response.status === 404) {
        alert('Component not found');
        window.location.href = '/projects';
        return;
      }
      throw new Error('Failed to load component');
    }

    const component = await response.json();
    currentComponent = component;
    renderComponent(component);
    loadIntegrationTests();
    loadDependencies();
    loadIntegrationJobHistory();
  } catch (error) {
    console.error('Error loading component:', error);
    showError('Failed to load component');
  }
}

function renderComponent(component) {
  document.title = `${component.name} - Test Scenario Generator`;
  document.getElementById('breadcrumbName').textContent = component.name;
  document.getElementById('componentName').textContent = component.name;
  document.getElementById('componentDescription').textContent = component.description || 'No description';

  // Set breadcrumb link
  document.getElementById('breadcrumbProject').href = `/project/${component.project_id}`;
  // We'd need to fetch project name for display, for now just show "Project"

  // Populate edit form
  document.getElementById('editComponentName').value = component.name;
  document.getElementById('editComponentDescription').value = component.description || '';

  const pages = component.pages || [];
  document.getElementById('pageCount').textContent = `${pages.length} page${pages.length !== 1 ? 's' : ''}`;

  renderPages(pages);
}

function renderPages(pages) {
  const grid = document.getElementById('pagesGrid');
  const emptyState = document.getElementById('pagesEmptyState');

  if (pages.length === 0) {
    grid.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  grid.style.display = 'grid';
  emptyState.style.display = 'none';

  grid.innerHTML = pages.map(page => `
    <a href="/page/${page.page_id}" class="item-card">
      <h3>${escapeHtml(page.name)}</h3>
      ${page.source_type === 'document'
        ? `<p class="confluence-link muted">Zdroj: dokumentový celok</p>`
        : `<p class="confluence-link">${escapeHtml(truncateUrl(page.confluence_link))}</p>`}
      <div class="item-card-meta">
        <span>${page.test_count || 0} tests</span>
        ${page.last_generated ? `<span>Generated ${formatDate(page.last_generated)}</span>` : '<span>Not generated</span>'}
      </div>
    </a>
  `).join('');
}

async function loadIntegrationTests() {
  try {
    const response = await fetch(`/api/components/${componentId}/tests`);
    if (!response.ok) throw new Error('Failed to load integration tests');

    const data = await response.json();
    allIntegrationTests = data.scenarios || [];

    document.getElementById('integrationTestCount').textContent = `${data.total || 0} integration test${data.total !== 1 ? 's' : ''}`;
    updateChatContext(data.total || 0);

    // Update stats
    updateIntegrationStats();

    renderFilteredIntegrationTests();
  } catch (error) {
    console.error('Error loading integration tests:', error);
  }
}

function updateIntegrationStats() {
  const total = allIntegrationTests.length;
  const validated = allIntegrationTests.filter(s => s.validation_status === 'validated').length;
  const needsReview = allIntegrationTests.filter(s => s.validation_status === 'needs_review').length;

  document.getElementById('totalIntegrationScenarios').textContent = total;
  document.getElementById('validatedIntegrationScenarios').textContent = validated;
  document.getElementById('needsReviewIntegrationScenarios').textContent = needsReview;
}

async function loadDependencies() {
  try {
    // Load component dependencies
    const componentDeps = currentComponent?.dependencies || [];
    renderComponentDependencies(componentDeps);

    // Load page dependencies from all pages in the component
    const pages = currentComponent?.pages || [];
    const allPageDeps = [];

    for (const page of pages) {
      if (page.dependencies && page.dependencies.length > 0) {
        allPageDeps.push({
          page_name: page.name,
          page_id: page.page_id,
          dependencies: page.dependencies,
        });
      }
    }

    renderPageDependencies(allPageDeps);
  } catch (error) {
    console.error('Error loading dependencies:', error);
  }
}

function renderComponentDependencies(dependencies) {
  const list = document.getElementById('componentDependenciesList');

  if (!dependencies || dependencies.length === 0) {
    list.innerHTML = '<p class="muted">Žiadne závislosti na iné moduly neboli detekované</p>';
    return;
  }

  list.innerHTML = `
    <div class="dependencies-list">
      ${dependencies.map(dep => `
        <a href="/component/${escapeHtml(dep.component_id)}" class="dependency-item">
          <span class="dependency-name">${escapeHtml(dep.component_name || dep.component_id)}</span>
          ${dep.notes ? `<span class="dependency-notes">${escapeHtml(dep.notes)}</span>` : ''}
        </a>
      `).join('')}
    </div>
  `;
}

function renderPageDependencies(pageDeps) {
  const container = document.getElementById('pageDependenciesList');

  if (!pageDeps || pageDeps.length === 0) {
    container.innerHTML = '<p class="muted">Žiadne závislosti stránok neboli detekované</p>';
    return;
  }

  container.innerHTML = pageDeps.map(page => `
    <div class="page-dependency-group">
      <h4>
        <a href="/page/${escapeHtml(page.page_id)}">${escapeHtml(page.page_name)}</a>
      </h4>
      <div class="dependencies-list">
        ${page.dependencies.map(dep => `
          <a href="/page/${escapeHtml(dep.page_id)}" class="dependency-item">
            <span class="dependency-name">${escapeHtml(dep.page_name || dep.page_id)}</span>
            ${dep.notes ? `<span class="dependency-notes">${escapeHtml(dep.notes)}</span>` : ''}
          </a>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function renderFilteredIntegrationTests() {
  const filtered = allIntegrationTests.filter(scenario => {
    // Status filter
    if (filterState.status !== 'all' && scenario.validation_status !== filterState.status) {
      return false;
    }
    // Classification filter
    if (filterState.classification !== 'all' && scenario.scenario_classification !== filterState.classification) {
      return false;
    }
    // Search filter
    if (filterState.search) {
      const searchable = [
        scenario.test_name,
        scenario.description,
        scenario.test_id,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!searchable.includes(filterState.search)) {
        return false;
      }
    }
    return true;
  });

  renderIntegrationTests(filtered);
}

function renderIntegrationTests(scenarios) {
  const container = document.getElementById('integrationTestsContainer');
  const emptyState = document.getElementById('integrationEmptyState');
  const filterControls = document.getElementById('integrationFilterControls');

  if (allIntegrationTests.length === 0) {
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
        <h3>No matching scenarios</h3>
        <p>Try adjusting your filters</p>
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
        <h4>Preconditions</h4>
        <ul class="preconditions-list">
          ${(scenario.preconditions || []).length > 0
            ? (scenario.preconditions || []).map(p => `<li>${escapeHtml(p)}</li>`).join('')
            : '<li>None provided</li>'}
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
            ${(scenario.test_steps || []).map(step => `
              <tr>
                <td>${escapeHtml(step.step_number || '')}</td>
                <td>${escapeHtml(step.action || '')}</td>
                <td>${escapeHtml(step.input || '')}</td>
                <td>${escapeHtml(step.expected_result || '')}</td>
              </tr>
            `).join('') || '<tr><td colspan="4">No steps provided</td></tr>'}
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

      ${scenario.validation_notes ? `
        <div class="section review-notes">
          <h4>Validation Notes</h4>
          <p>${escapeHtml(scenario.validation_notes)}</p>
        </div>
      ` : ''}

      <div class="card-actions">
        ${scenario.validation_status === 'needs_review' ? `
          <button class="primary" data-action="accept" data-test-id="${escapeHtml(scenario.test_id)}">Accept</button>
        ` : ''}
        <button class="ghost" data-action="edit" data-test-id="${escapeHtml(scenario.test_id)}">Edit</button>
        ${scenario.validation_status !== 'dismissed' ? `
          <button class="warn" data-action="dismiss" data-test-id="${escapeHtml(scenario.test_id)}">Dismiss</button>
        ` : ''}
        <button class="danger" data-action="delete" data-test-id="${escapeHtml(scenario.test_id)}">Delete</button>
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

  const scenario = allIntegrationTests.find(s => s.test_id === testId);
  if (!scenario) return;

  try {
    if (action === 'accept') {
      await updateScenarioValidation(testId, 'validated');
      scenario.validation_status = 'validated';
      renderFilteredIntegrationTests();
      updateTestStats();
    } else if (action === 'dismiss') {
      if (!confirm('Dismiss this scenario? It will be hidden from validated list.')) return;
      await updateScenarioValidation(testId, 'dismissed', 'Dismissed via component review');
      scenario.validation_status = 'dismissed';
      renderFilteredIntegrationTests();
      updateTestStats();
    } else if (action === 'delete') {
      if (!confirm('Delete this scenario permanently? This cannot be undone.')) return;
      await deleteScenario(testId);
      allIntegrationTests = allIntegrationTests.filter(s => s.test_id !== testId);
      renderFilteredIntegrationTests();
      updateTestStats();
    } else if (action === 'edit') {
      openScenarioEditModal(scenario);
    }
  } catch (error) {
    alert('Action failed: ' + error.message);
  }
}

async function updateScenarioValidation(testId, status, notes) {
  const response = await fetch(`/api/components/${componentId}/tests/${testId}/validate`, {
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
  const response = await fetch(`/api/components/${componentId}/tests/${testId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.message || 'Failed to delete scenario');
  }
}

function updateTestStats() {
  const total = allIntegrationTests.length;
  document.getElementById('integrationTestCount').textContent = `${total} integration test${total !== 1 ? 's' : ''}`;
  updateChatContext(total);
  updateIntegrationStats();
}

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

  // Format preconditions
  const preconditions = Array.isArray(scenario.preconditions) ? scenario.preconditions : [];
  document.getElementById('editScenarioPreconditions').value = preconditions.join('\n');

  // Populate structured test steps
  const stepsContainer = document.getElementById('editScenarioStepsContainer');
  stepsContainer.innerHTML = '';

  const steps = Array.isArray(scenario.test_steps) ? scenario.test_steps : [];
  if (steps.length === 0) {
    // Add one empty step if no steps
    addStepToContainer(stepsContainer, 1, '', '', '');
  } else {
    steps.forEach((step, idx) => {
      addStepToContainer(
        stepsContainer,
        idx + 1,
        step.action || '',
        step.input || '',
        step.expected_result || ''
      );
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
      <input type="text" class="step-action" value="${escapeHtml(action)}" placeholder="Napr. Navigovať na stránku">
    </div>
    <div class="step-field">
      <span class="step-field-label">Vstup</span>
      <input type="text" class="step-input" value="${escapeHtml(input)}" placeholder="Napr. URL: /login">
    </div>
    <div class="step-field">
      <span class="step-field-label">Očakávaný výsledok</span>
      <input type="text" class="step-expected" value="${escapeHtml(expectedResult)}" placeholder="Napr. Zobrazí sa prihlasovacia obrazovka">
    </div>
    <button type="button" class="remove-step-btn" onclick="removeStep(this)" title="Odstrániť krok">&times;</button>
  `;
  container.appendChild(stepRow);
}

function addNewStep() {
  const container = document.getElementById('editScenarioStepsContainer');
  const currentSteps = container.querySelectorAll('.step-row').length;
  addStepToContainer(container, currentSteps + 1, '', '', '');
  // Focus on the new action input
  const newRow = container.lastElementChild;
  const actionInput = newRow.querySelector('.step-action');
  if (actionInput) actionInput.focus();
}

function removeStep(btn) {
  const stepRow = btn.closest('.step-row');
  const container = stepRow.parentElement;
  stepRow.remove();
  // Renumber remaining steps
  container.querySelectorAll('.step-row').forEach((row, idx) => {
    row.querySelector('.step-number').textContent = idx + 1;
  });
}

// Make functions globally accessible for inline onclick handlers
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
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  // Read from structured steps editor
  const stepsContainer = document.getElementById('editScenarioStepsContainer');
  const stepRows = stepsContainer.querySelectorAll('.step-row');
  const testSteps = [];

  stepRows.forEach((row, idx) => {
    const action = row.querySelector('.step-action')?.value.trim() || '';
    const input = row.querySelector('.step-input')?.value.trim() || '';
    const expectedResult = row.querySelector('.step-expected')?.value.trim() || '';

    if (action) {
      testSteps.push({
        step_number: idx + 1,
        action,
        input,
        expected_result: expectedResult,
      });
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
    submitBtn.textContent = 'Saving...';

    const response = await fetch(`/api/components/${componentId}/tests/${testId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || error.message || 'Failed to save changes');
    }

    // Update local state
    const scenario = allIntegrationTests.find(s => s.test_id === testId);
    if (scenario) {
      Object.assign(scenario, payload);
    }

    closeScenarioEditModal();
    renderFilteredIntegrationTests();
  } catch (error) {
    alert('Failed to save: ' + error.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

function openAddPageModal() {
  document.getElementById('addPageModal').classList.add('active');
  document.getElementById('confluenceLink').focus();
}

function closeAddPageModal() {
  document.getElementById('addPageModal').classList.remove('active');
  document.getElementById('addPageForm').reset();
}

function openEditModal() {
  document.getElementById('editModal').classList.add('active');
  document.getElementById('editComponentName').focus();
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('active');
}

async function handleAddPage(e) {
  e.preventDefault();

  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Adding...';

    const confluenceLink = document.getElementById('confluenceLink').value.trim();
    const name = document.getElementById('pageName').value.trim();

    const response = await fetch(`/api/pages/component/${componentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confluence_link: confluenceLink,
        name: name || undefined,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to add page');
    }

    const page = await response.json();
    closeAddPageModal();

    // Redirect to the new page
    window.location.href = `/page/${page.page_id}`;
  } catch (error) {
    console.error('Error adding page:', error);
    alert('Failed to add page: ' + error.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

async function handleEditComponent(e) {
  e.preventDefault();

  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    const name = document.getElementById('editComponentName').value.trim();
    const description = document.getElementById('editComponentDescription').value.trim();

    const response = await fetch(`/api/components/${componentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: description || undefined }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update component');
    }

    closeEditModal();
    loadComponent();
    if (window.sidebarRefresh) window.sidebarRefresh();
  } catch (error) {
    console.error('Error updating component:', error);
    alert('Failed to update component: ' + error.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

async function handleDeleteComponent() {
  if (!confirm(`Are you sure you want to delete "${currentComponent.name}"?\n\nThis will also delete all pages within this component. This action cannot be undone.`)) {
    return;
  }

  try {
    const response = await fetch(`/api/components/${componentId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete component');
    }

    window.location.href = `/project/${currentComponent.project_id}`;
  } catch (error) {
    console.error('Error deleting component:', error);
    alert('Failed to delete component: ' + error.message);
  }
}

async function handleGenerateIntegration() {
  const btn = document.getElementById('generateIntegrationBtn');
  const originalText = btn.textContent;
  const maxTestsInput = document.getElementById('maxIntegrationTestsInput');
  const maxTestsValue = maxTestsInput ? parseInt(maxTestsInput.value, 10) : NaN;
  const payload = Number.isFinite(maxTestsValue) && maxTestsValue > 0
    ? { max_tests: maxTestsValue }
    : null;

  try {
    btn.disabled = true;
    btn.textContent = 'Starting...';

    const response = await fetch(`/api/components/${componentId}/generate`, {
      method: 'POST',
      headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || error.message || 'Failed to generate integration tests');
    }

    const result = await response.json();
    showIntegrationGenerationStatus('processing', 'Integration test generation started...');
    startIntegrationPolling(result.job_id);
  } catch (error) {
    console.error('Error generating integration tests:', error);
    alert('Failed to generate integration tests: ' + error.message);
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function handleGenerateAll() {
  const btn = document.getElementById('generateAllBtn');
  const originalText = btn.textContent;
  const maxTestsInput = document.getElementById('maxIntegrationTestsInput');
  const maxTestsValue = maxTestsInput ? parseInt(maxTestsInput.value, 10) : NaN;
  const maxTests = Number.isFinite(maxTestsValue) && maxTestsValue > 0 ? maxTestsValue : 6;

  if (!currentComponent || !currentComponent.pages || currentComponent.pages.length === 0) {
    alert('No pages found in this component. Add pages first before generating tests.');
    return;
  }

  if (!confirm(`This will generate tests for all ${currentComponent.pages.length} pages and then generate integration tests.\n\nContinue?`)) {
    return;
  }

  try {
    btn.disabled = true;
    btn.textContent = 'Generating...';
    generateAllInProgress = true;

    showIntegrationGenerationStatus('processing', `Generating tests for ${currentComponent.pages.length} pages...`);

    // Generate tests for all pages first
    const pageResults = [];
    for (let i = 0; i < currentComponent.pages.length; i++) {
      const page = currentComponent.pages[i];
      showIntegrationGenerationStatus('processing', `Generating page tests (${i + 1}/${currentComponent.pages.length}): ${page.name}...`);

      try {
        const response = await fetch(`/api/pages/${page.page_id}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ max_tests: maxTests }),
        });

        if (response.ok) {
          const result = await response.json();
          pageResults.push({ page: page.name, job_id: result.job_id, status: 'started' });

          // Wait for this job to complete before moving to next
          await waitForJob(result.job_id);
          pageResults[pageResults.length - 1].status = 'completed';
        } else {
          const error = await response.json().catch(() => ({}));
          pageResults.push({ page: page.name, error: error.error || 'Failed', status: 'failed' });
        }
      } catch (err) {
        pageResults.push({ page: page.name, error: err.message, status: 'failed' });
      }
    }

    // Now generate integration tests
    showIntegrationGenerationStatus('processing', 'Generating integration tests...');

    const integrationResponse = await fetch(`/api/components/${componentId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_tests: maxTests }),
    });

    if (!integrationResponse.ok) {
      const error = await integrationResponse.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to generate integration tests');
    }

    const integrationResult = await integrationResponse.json();

    // Wait for integration tests to complete
    await waitForJob(integrationResult.job_id);

    const successCount = pageResults.filter(r => r.status === 'completed').length;
    const failCount = pageResults.filter(r => r.status === 'failed').length;

    showIntegrationGenerationStatus('success', `Generation complete! Pages: ${successCount} OK, ${failCount} failed. Integration tests generated.`);

    // Reload data
    loadComponent();
    loadIntegrationTests();
    loadIntegrationJobHistory();
  } catch (error) {
    console.error('Error in generate all:', error);
    showIntegrationGenerationStatus('error', `Generation failed: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
    generateAllInProgress = false;
  }
}

async function waitForJob(jobId, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) throw new Error('Failed to check job status');

      const job = await response.json();

      if (job.status === 'completed' || job.status === 'failed') {
        return job;
      }

      // Wait 2 seconds before next check
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error('Error checking job status:', error);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  throw new Error('Job timed out');
}

function startIntegrationPolling(jobId) {
  if (pollingInterval) clearInterval(pollingInterval);

  const btn = document.getElementById('generateIntegrationBtn');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  pollingInterval = setInterval(async () => {
    try {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) throw new Error('Failed to check job status');

      const job = await response.json();

      if (job.status === 'completed') {
        stopIntegrationPolling();
        showIntegrationGenerationStatus('success', 'Integration test generation completed!');
        loadIntegrationTests();
        loadIntegrationJobHistory();
        btn.disabled = false;
        btn.textContent = 'Generate Integration Tests';
      } else if (job.status === 'failed') {
        stopIntegrationPolling();
        showIntegrationGenerationStatus('error', `Generation failed: ${job.error || 'Unknown error'}`);
        btn.disabled = false;
        btn.textContent = 'Generate Integration Tests';
      } else {
        showIntegrationGenerationStatus('loading', 'Integration test generation in progress...');
      }
    } catch (error) {
      console.error('Error polling job status:', error);
    }
  }, 3000);
}

function stopIntegrationPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

function showIntegrationGenerationStatus(type, message) {
  const statusEl = document.getElementById('integrationGenerationStatus');
  const messageEl = document.getElementById('integrationGenerationStatusMessage');

  statusEl.style.display = 'block';
  statusEl.className = `status ${type}`;
  messageEl.textContent = message;

  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 5000);
  }
}

async function loadIntegrationJobHistory() {
  try {
    const response = await fetch(`/api/components/${componentId}/jobs`);
    if (!response.ok) throw new Error('Failed to load job history');

    const data = await response.json();
    renderIntegrationJobHistory(data.jobs || []);
  } catch (error) {
    console.error('Error loading integration job history:', error);
    // Show empty state if API doesn't exist yet
    renderIntegrationJobHistory([]);
  }
}

function renderIntegrationJobHistory(jobs) {
  const container = document.getElementById('integrationJobHistoryContainer');

  if (jobs.length === 0) {
    container.innerHTML = '<p class="muted">No generation history yet</p>';
    return;
  }

  container.innerHTML = `
    <table class="scenarios-table">
      <thead>
        <tr>
          <th>Job ID</th>
          <th>Status</th>
          <th>Scenarios</th>
          <th>Created</th>
          <th>Completed</th>
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

function formatDateTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleString();
}

async function handleClearAllIntegration() {
  const testCount = allIntegrationTests.length;
  if (testCount === 0) {
    alert('No integration tests to clear.');
    return;
  }

  if (!confirm(`Are you sure you want to delete all ${testCount} integration tests?\n\nThis action cannot be undone.`)) {
    return;
  }

  const btn = document.getElementById('clearAllIntegrationBtn');
  const originalText = btn.textContent;

  try {
    btn.disabled = true;
    btn.textContent = 'Clearing...';

    const response = await fetch(`/api/components/${componentId}/tests`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to clear integration tests');
    }

    const result = await response.json();
    allIntegrationTests = [];
    renderFilteredIntegrationTests();
    updateTestStats();
    alert(`Successfully deleted ${result.deleted_count} integration tests.`);
  } catch (error) {
    console.error('Error clearing integration tests:', error);
    alert('Failed to clear integration tests: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function truncateUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path.length > 50) {
      return '...' + path.slice(-47);
    }
    return path;
  } catch {
    return url.length > 50 ? '...' + url.slice(-47) : url;
  }
}

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString();
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

function updateChatContext(totalScenarios) {
  if (!chatElements.context) return;
  chatElements.context.textContent = `Using ${totalScenarios} scenario${totalScenarios === 1 ? '' : 's'}`;
}

function appendChatMessage(role, content) {
  if (!chatElements.log) return null;
  if (chatElements.empty) {
    chatElements.empty.style.display = 'none';
  }

  const message = document.createElement('div');
  message.className = `chat-message ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.textContent = content;
  message.appendChild(bubble);
  chatElements.log.appendChild(message);
  chatElements.log.scrollTop = chatElements.log.scrollHeight;
  return message;
}

function setChatPending(isPending) {
  if (!chatElements.sendBtn || !chatElements.input) return;
  chatElements.sendBtn.disabled = isPending;
  chatElements.input.disabled = isPending;

  if (isPending) {
    chatState.pendingEl = appendChatMessage('assistant pending', 'Thinking...');
  } else if (chatState.pendingEl) {
    chatState.pendingEl.remove();
    chatState.pendingEl = null;
  }
}

function resetChat() {
  if (!chatElements.log) return;
  chatState.messages = [];
  chatElements.log.innerHTML = '';
  if (chatElements.empty) {
    chatElements.empty.style.display = 'block';
  }
}

function getChatHistory() {
  return chatState.messages.slice(-10);
}

async function handleChatSubmit(event) {
  event.preventDefault();
  if (!chatElements.input) return;

  const message = chatElements.input.value.trim();
  if (!message) return;

  chatElements.input.value = '';
  chatState.messages.push({ role: 'user', content: message });
  appendChatMessage('user', message);
  setChatPending(true);

  try {
    const response = await fetch(`/api/chat/component/${componentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: getChatHistory().slice(0, -1),
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || data.message || 'Chat request failed');
    }

    const reply = data.reply || 'No response from assistant.';
    chatState.messages.push({ role: 'assistant', content: reply });
    setChatPending(false);
    appendChatMessage('assistant', reply);

    if (data.context && typeof data.context.scenario_count === 'number') {
      updateChatContext(data.context.scenario_count);
    }
  } catch (error) {
    setChatPending(false);
    appendChatMessage('assistant', error.message || 'Chat request failed.');
  }
}

function showError(message) {
  const grid = document.getElementById('pagesGrid');
  grid.innerHTML = `
    <div class="empty-state">
      <h3>Error</h3>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="primary" onclick="loadComponent()">Retry</button>
    </div>
  `;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Cleanup on page unload
window.addEventListener('beforeunload', stopIntegrationPolling);
