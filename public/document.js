/**
 * Document Detail Page JavaScript
 * Handles displaying document details, modules, and generated test scenarios
 */

// State
let documentId = null;
let documentData = null;
let scenariosData = null;
let currentFilter = 'all';

// DOM Elements
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');
const documentContent = document.getElementById('documentContent');
const breadcrumbTitle = document.getElementById('breadcrumbTitle');

// Document info elements
const documentFilename = document.getElementById('documentFilename');
const documentStatus = document.getElementById('documentStatus');
const pagesCount = document.getElementById('pagesCount');
const changeRequestsCount = document.getElementById('changeRequestsCount');
const totalScenarios = document.getElementById('totalScenarios');
const validatedScenarios = document.getElementById('validatedScenarios');
const needsReviewScenarios = document.getElementById('needsReviewScenarios');
const parsedAt = document.getElementById('parsedAt');

// Lists
const pagesList = document.getElementById('pagesList');
const scenariosList = document.getElementById('scenariosList');

// Buttons
const requestManualBtn = document.getElementById('requestManualBtn');
const generateBtn = document.getElementById('generateBtn');
const refreshBtn = document.getElementById('refreshBtn');
const deleteBtn = document.getElementById('deleteBtn');

// Filter counts
const filterAllCount = document.getElementById('filterAllCount');
const filterValidatedCount = document.getElementById('filterValidatedCount');
const filterNeedsReviewCount = document.getElementById('filterNeedsReviewCount');

// Modal
const deleteModal = document.getElementById('deleteModal');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Extract document ID from URL
  const pathParts = window.location.pathname.split('/');
  documentId = pathParts[pathParts.length - 1];

  if (!documentId) {
    showError('Document ID not found in URL');
    return;
  }

  loadDocument();
  setupEventListeners();
});

function setupEventListeners() {
  // Refresh button
  refreshBtn.addEventListener('click', loadDocument);

  // Request Manual button
  if (requestManualBtn) {
    requestManualBtn.addEventListener('click', requestManual);
  }

  // Save Manual button
  const saveManualBtn = document.getElementById('saveManualBtn');
  if (saveManualBtn) {
    saveManualBtn.addEventListener('click', handleSaveManual);
  }

  // Manual type radio buttons
  const manualRadioButtons = document.querySelectorAll('input[name="manualType"]');
  manualRadioButtons.forEach(radio => {
    radio.addEventListener('change', handleManualTypeChange);
  });

  // Generate button
  generateBtn.addEventListener('click', generateTests);

  // Delete button
  deleteBtn.addEventListener('click', () => {
    deleteModal.classList.add('active');
  });

  // Delete modal buttons
  cancelDeleteBtn.addEventListener('click', () => {
    deleteModal.classList.remove('active');
  });

  confirmDeleteBtn.addEventListener('click', deleteDocument);

  // Filter tabs
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      renderScenarios();
    });
  });

  // Close modal on backdrop click
  deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) {
      deleteModal.classList.remove('active');
    }
  });
}

async function loadDocument() {
  showLoading();

  try {
    // Fetch document details
    const docResponse = await fetch(`/api/documents/${documentId}`);
    if (!docResponse.ok) {
      if (docResponse.status === 404) {
        throw new Error('Dokument nebol najdeny');
      }
      throw new Error('Nepodarilo sa nacitat dokument');
    }
    documentData = await docResponse.json();

    // Fetch scenarios
    const scenariosResponse = await fetch(`/api/documents/${documentId}/scenarios`);
    if (scenariosResponse.ok) {
      scenariosData = await scenariosResponse.json();
    } else {
      scenariosData = { total_scenarios: 0, scenarios: [] };
    }

    renderDocument();
    showContent();
  } catch (error) {
    showError(error.message);
  }
}

function showLoading() {
  loadingState.style.display = 'block';
  errorState.style.display = 'none';
  documentContent.style.display = 'none';
}

function showError(message) {
  loadingState.style.display = 'none';
  errorState.style.display = 'block';
  documentContent.style.display = 'none';
  errorMessage.textContent = message;
}

function showContent() {
  loadingState.style.display = 'none';
  errorState.style.display = 'none';
  documentContent.style.display = 'block';
}

function renderDocument() {
  // Update breadcrumb
  breadcrumbTitle.textContent = documentData.filename;

  // Update document info
  documentFilename.textContent = documentData.filename;
  documentStatus.textContent = getStatusText(documentData.status);
  documentStatus.className = `status-badge ${documentData.status}`;

  const pages = documentData.pages || [];
  pagesCount.textContent = pages.length;

  const crCount = pages.reduce(
    (sum, page) => sum + (page.change_requests?.length || 0),
    0
  );
  changeRequestsCount.textContent = crCount;

  // Update scenario counts
  const validated = scenariosData?.validated_count || 0;
  const needsReview = scenariosData?.needs_review_count || 0;
  const total = scenariosData?.total_scenarios || 0;

  totalScenarios.textContent = total;
  validatedScenarios.textContent = validated;
  needsReviewScenarios.textContent = needsReview;

  // Update filter counts
  filterAllCount.textContent = total;
  filterValidatedCount.textContent = validated;
  filterNeedsReviewCount.textContent = needsReview;

  // Update parsed date
  if (documentData.parsed_at) {
    parsedAt.textContent = new Date(documentData.parsed_at).toLocaleString('sk-SK');
  }

  // Show/hide buttons based on status
  const hasManual = documentData.project_context && documentData.project_context.manual_text;

  // Request Manual button - show only for pages_detected
  if (documentData.status === 'pages_detected') {
    requestManualBtn.style.display = 'inline-block';
  } else {
    requestManualBtn.style.display = 'none';
  }

  // Generate button logic
  if (documentData.status === 'generating') {
    generateBtn.style.display = 'inline-block';
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generujem...';
  } else if (documentData.status === 'awaiting_manual') {
    // Show generate button but only enable if manual is uploaded
    generateBtn.style.display = 'inline-block';
    if (hasManual) {
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generovat testy';
    } else {
      generateBtn.disabled = true;
      generateBtn.textContent = 'Najprv nahrajte prirucku';
    }
  } else if (documentData.status === 'awaiting_context' || documentData.status === 'completed' || documentData.status === 'failed') {
    generateBtn.style.display = 'inline-block';
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generovat testy';
  } else {
    // pages_detected, uploaded, parsed
    generateBtn.style.display = 'none';
  }

  // Show manual section for awaiting_manual, awaiting_context, completed, failed (if manual exists)
  const manualSection = document.getElementById('manualSection');
  const showManualStatuses = ['awaiting_manual', 'awaiting_context', 'generating', 'completed', 'failed'];
  if (showManualStatuses.includes(documentData.status)) {
    manualSection.style.display = 'block';
    displayProjectContext(documentData.project_context);
  } else {
    manualSection.style.display = 'none';
  }

  // Update workflow progress indicator
  updateWorkflowProgress(documentData.status, hasManual);

  // Render pages
  renderPages(pages);

  // Render scenarios
  renderScenarios();
}

function updateWorkflowProgress(status, hasManual) {
  const workflowProgress = document.getElementById('workflowProgress');
  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const step3 = document.getElementById('step3');
  const line1 = document.getElementById('line1');
  const line2 = document.getElementById('line2');

  // Show workflow only for relevant statuses
  const showWorkflowStatuses = ['pages_detected', 'awaiting_manual', 'awaiting_context', 'generating', 'completed'];
  if (!showWorkflowStatuses.includes(status)) {
    workflowProgress.style.display = 'none';
    return;
  }

  workflowProgress.style.display = 'block';

  // Reset all classes
  [step1, step2, step3].forEach(s => s.classList.remove('completed', 'active'));
  [line1, line2].forEach(l => l.classList.remove('completed'));

  // Step 1: Upload document - always completed at this point
  step1.classList.add('completed');
  line1.classList.add('completed');

  // Step 2: Add manual
  if (status === 'pages_detected') {
    step2.classList.add('active');
  } else if (status === 'awaiting_manual') {
    if (hasManual) {
      step2.classList.add('completed');
      line2.classList.add('completed');
      step3.classList.add('active');
    } else {
      step2.classList.add('active');
    }
  } else if (['awaiting_context', 'generating', 'completed'].includes(status)) {
    step2.classList.add('completed');
    line2.classList.add('completed');
    step3.classList.add(status === 'completed' ? 'completed' : 'active');
  }
}

function getStatusText(status) {
  const statusMap = {
    'uploaded': 'Nahrany',
    'parsed': 'Spracovany',
    'pages_detected': 'Celky detekovane',
    'awaiting_manual': 'Caka na prirucku',
    'awaiting_context': 'Caka na kontext',
    'generating': 'Generujem testy...',
    'completed': 'Dokonceny',
    'failed': 'Zlyhalo'
  };
  return statusMap[status] || status;
}

function renderPages(pages) {
  if (!pages || pages.length === 0) {
    pagesList.innerHTML = '<p class="empty-scenarios">Ziadne celky neboli detekovane</p>';
    return;
  }

  const canAddContext = documentData && documentData.status === 'awaiting_context';

  pagesList.innerHTML = pages.map(page => `
    <div class="page-card">
      <h4 style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          ${escapeHtml(page.name)}
          <span class="priority-badge priority-${page.priority}">${page.priority}</span>
        </div>
        ${canAddContext ? `
          <button type="button" class="ghost small" onclick="openContextModal('${escapeHtml(page.page_id)}', '${escapeHtml(page.name)}')">+ Pridat kontext</button>
        ` : ''}
      </h4>
      <p class="module-description">${escapeHtml(page.description)}</p>

      ${page.supplementary_context && page.supplementary_context.additional_text ? `
        <div style="background: var(--bg-2); padding: 12px; border-radius: 6px; margin-top: 12px;">
          <strong style="font-size: 13px; color: var(--muted);">Dodatocny kontext:</strong>
          <p style="font-size: 13px; margin-top: 6px; white-space: pre-wrap;">${escapeHtml(page.supplementary_context.additional_text.substring(0, 200))}${page.supplementary_context.additional_text.length > 200 ? '...' : ''}</p>
          ${page.supplementary_context.source_file ? `
            <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">
              Zdroj: ${escapeHtml(page.supplementary_context.source_file.filename)} (${page.supplementary_context.source_file.file_type})
            </div>
          ` : ''}
        </div>
      ` : ''}

      ${page.change_requests && page.change_requests.length > 0 ? `
        <div class="change-requests-list">
          <strong style="font-size: 13px; color: var(--muted);">Zmenove poziadavky (${page.change_requests.length}):</strong>
          ${page.change_requests.map(cr => `
            <div class="change-request">
              <div class="change-request-title">${escapeHtml(cr.title)}</div>
              ${cr.description ? `<div style="font-size: 13px; color: var(--muted); margin-top: 4px;">${escapeHtml(cr.description)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `).join('');
}

function renderScenarios() {
  if (!scenariosData?.scenarios || scenariosData.scenarios.length === 0) {
    scenariosList.innerHTML = '<div class="empty-scenarios">Ziadne testovacie scenare neboli vygenerovane</div>';
    return;
  }

  let filteredScenarios = scenariosData.scenarios;
  if (currentFilter === 'validated') {
    filteredScenarios = scenariosData.scenarios.filter(s => s.validation_status === 'validated');
  } else if (currentFilter === 'needs_review') {
    filteredScenarios = scenariosData.scenarios.filter(s => s.validation_status === 'needs_review');
  }

  if (filteredScenarios.length === 0) {
    scenariosList.innerHTML = `<div class="empty-scenarios">Ziadne scenare pre vybrany filter</div>`;
    return;
  }

  scenariosList.innerHTML = filteredScenarios.map(scenario => `
    <div class="scenario-card ${scenario.validation_status}">
      <div class="scenario-header">
        <h4 class="scenario-title">${escapeHtml(scenario.test_name)}</h4>
        <div class="scenario-badges">
          <span class="scenario-badge badge-${scenario.scenario_classification}">${scenario.scenario_classification}</span>
          <span class="scenario-badge badge-${scenario.test_type}">${scenario.test_type}</span>
          <span class="priority-badge priority-${scenario.priority}">${scenario.priority}</span>
        </div>
      </div>
      <div class="scenario-meta">
        <span>Celok: ${escapeHtml(scenario.module_name || 'N/A')}</span>
        <span>Status: ${scenario.validation_status === 'validated' ? 'Validovany' : 'Na kontrolu'}</span>
      </div>
      <div class="scenario-content">
        <div class="scenario-section">
          <div class="scenario-section-title">Predpoklady</div>
          <div class="scenario-section-content">${escapeHtml(scenario.preconditions)}</div>
        </div>
        <div class="scenario-section">
          <div class="scenario-section-title">Testovacie kroky</div>
          <div class="scenario-section-content">
            <ol class="test-steps-list">
              ${scenario.test_steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
            </ol>
          </div>
        </div>
        <div class="scenario-section">
          <div class="scenario-section-title">Ocakavany vysledok</div>
          <div class="scenario-section-content">${escapeHtml(scenario.expected_result)}</div>
        </div>
        ${scenario.validation_issues && scenario.validation_issues.length > 0 ? `
          <div class="validation-issues">
            <div class="validation-issues-title">Problemy s validaciou:</div>
            <ul class="validation-issues-list">
              ${scenario.validation_issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');
}

async function generateTests() {
  generateBtn.disabled = true;
  generateBtn.textContent = 'Spustam...';

  try {
    const response = await fetch(`/api/documents/${documentId}/generate`, {
      method: 'POST'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Nepodarilo sa spustit generovanie');
    }

    // Reload document to show generating status
    await loadDocument();

    // Start polling for completion
    pollForCompletion();
  } catch (error) {
    alert('Chyba: ' + error.message);
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generovat testy';
  }
}

function pollForCompletion() {
  const pollInterval = setInterval(async () => {
    try {
      const response = await fetch(`/api/documents/${documentId}`);
      if (response.ok) {
        const doc = await response.json();
        if (doc.status !== 'generating') {
          clearInterval(pollInterval);
          await loadDocument();
        }
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, 3000);
}

async function deleteDocument() {
  confirmDeleteBtn.disabled = true;
  confirmDeleteBtn.textContent = 'Mazem...';

  try {
    const response = await fetch(`/api/documents/${documentId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Nepodarilo sa zmazat dokument');
    }

    // Redirect to documents list
    window.location.href = '/documents';
  } catch (error) {
    alert('Chyba: ' + error.message);
    confirmDeleteBtn.disabled = false;
    confirmDeleteBtn.textContent = 'Zmazat';
    deleteModal.classList.remove('active');
  }
}

// ===== Supplementary Context Management =====

let currentContextPageId = null;

function openContextModal(pageId, pageName) {
  currentContextPageId = pageId;
  const modal = document.getElementById('contextModal');
  const pageNameEl = document.getElementById('contextModalPageName');

  pageNameEl.textContent = `Celok: ${pageName}`;
  modal.classList.add('active');
}

function setupContextModal() {
  const modal = document.getElementById('contextModal');
  const cancelBtn = document.getElementById('cancelContextBtn');
  const saveBtn = document.getElementById('saveContextModalBtn');

  // Radio buttons for context type
  const radioButtons = document.querySelectorAll('input[name="contextTypeModal"]');
  radioButtons.forEach(radio => {
    radio.addEventListener('change', handleContextTypeChangeModal);
  });

  cancelBtn.addEventListener('click', () => {
    modal.classList.remove('active');
    resetContextForm();
  });

  saveBtn.addEventListener('click', handleSaveContextModal);

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
      resetContextForm();
    }
  });
}

function handleContextTypeChangeModal(e) {
  const selectedType = e.target.value;
  document.getElementById('textContextInputModal').style.display = selectedType === 'text' ? 'block' : 'none';
  document.getElementById('fileContextInputModal').style.display = selectedType === 'file' ? 'block' : 'none';
}

async function handleSaveContextModal() {
  if (!currentContextPageId) return;

  const saveBtn = document.getElementById('saveContextModalBtn');
  const originalText = saveBtn.textContent;

  try {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Ukladam...';

    const selectedType = document.querySelector('input[name="contextTypeModal"]:checked').value;

    let response;
    if (selectedType === 'text') {
      const text = document.getElementById('contextTextModal').value.trim();
      if (!text) {
        alert('Zadajte text kontextu');
        return;
      }

      response = await fetch(`/api/documents/${documentId}/pages/${currentContextPageId}/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ additional_text: text }),
      });
    } else if (selectedType === 'file') {
      const fileInput = document.getElementById('contextFileModal');
      const file = fileInput.files[0];
      if (!file) {
        alert('Vyberte subor');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);

      response = await fetch(`/api/documents/${documentId}/pages/${currentContextPageId}/context/file`, {
        method: 'POST',
        body: formData,
      });
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Nepodarilo sa ulozit kontext');
    }

    // Close modal and reload document
    document.getElementById('contextModal').classList.remove('active');
    resetContextForm();
    await loadDocument();

    alert('Kontext uspesne ulozeny');
  } catch (error) {
    alert('Chyba pri ukladani: ' + error.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
}

function resetContextForm() {
  document.getElementById('contextTextModal').value = '';
  document.getElementById('contextFileModal').value = '';

  // Reset to text type
  const textRadio = document.querySelector('input[name="contextTypeModal"][value="text"]');
  if (textRadio) {
    textRadio.checked = true;
    handleContextTypeChangeModal({ target: textRadio });
  }

  currentContextPageId = null;
}

// Make function globally accessible
window.openContextModal = openContextModal;

// Setup modal on page load
document.addEventListener('DOMContentLoaded', () => {
  setupContextModal();
});

// ===== Manual/Handbook Management (NEW WORKFLOW) =====

async function requestManual() {
  if (!documentId) return;

  const btn = requestManualBtn;
  const originalText = btn.textContent;

  try {
    btn.disabled = true;
    btn.textContent = 'Pripravujem...';

    const response = await fetch(`/api/documents/${documentId}/request-manual`, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Nepodarilo sa pripravit na prirucku');
    }

    // Reload document to show manual section
    await loadDocument();
  } catch (error) {
    alert('Chyba: ' + error.message);
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function handleManualTypeChange(e) {
  const selectedType = e.target.value;
  document.getElementById('textManualInput').style.display = selectedType === 'text' ? 'block' : 'none';
  document.getElementById('fileManualInput').style.display = selectedType === 'file' ? 'block' : 'none';
}

async function handleSaveManual() {
  const saveBtn = document.getElementById('saveManualBtn');
  const originalText = saveBtn.textContent;

  try {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Ukladam...';

    const selectedType = document.querySelector('input[name="manualType"]:checked').value;

    let response;
    if (selectedType === 'text') {
      const text = document.getElementById('manualText').value.trim();
      if (!text) {
        alert('Zadajte text prirucky');
        return;
      }

      response = await fetch(`/api/documents/${documentId}/manual/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manual_text: text }),
      });
    } else if (selectedType === 'file') {
      const fileInput = document.getElementById('manualFile');
      const file = fileInput.files[0];
      if (!file) {
        alert('Vyberte subor');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);

      response = await fetch(`/api/documents/${documentId}/manual/file`, {
        method: 'POST',
        body: formData,
      });
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Nepodarilo sa ulozit prirucku');
    }

    // Reload document
    await loadDocument();
    alert('Prirucka uspesne ulozena! Mozete teraz generovat testy.');
  } catch (error) {
    alert('Chyba pri ukladani: ' + error.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
}

function displayProjectContext(projectContext) {
  const display = document.getElementById('currentManualDisplay');
  const uploadForm = document.getElementById('uploadManualForm');
  const content = document.getElementById('manualContent');
  const meta = document.getElementById('manualMeta');

  // Check if we're in a status that allows editing
  const canEdit = documentData && ['awaiting_manual', 'awaiting_context'].includes(documentData.status);

  if (!projectContext || !projectContext.manual_text) {
    display.style.display = 'none';
    uploadForm.style.display = canEdit ? 'block' : 'none';
    return;
  }

  display.style.display = 'block';
  // Show upload form for replacement if editing is allowed
  uploadForm.style.display = canEdit ? 'block' : 'none';

  // Show truncated text
  const text = projectContext.manual_text;
  const truncated = text.length > 500 ? text.substring(0, 500) + '...' : text;
  content.textContent = truncated;

  // Show metadata
  const metaParts = [];
  if (projectContext.added_at) {
    metaParts.push(`Pridane: ${formatDateTime(projectContext.added_at)}`);
  }
  if (projectContext.manual_file) {
    metaParts.push(`Subor: ${projectContext.manual_file.filename} (${projectContext.manual_file.file_type})`);
  }
  metaParts.push(`Dlzka: ${text.length} znakov`);

  meta.innerHTML = metaParts.map(p => `<span>${escapeHtml(p)}</span>`).join(' | ');

  // Update upload form header and button if manual exists
  if (canEdit && projectContext.manual_text) {
    const saveBtn = document.getElementById('saveManualBtn');
    const formTitle = document.getElementById('uploadFormTitle');
    if (saveBtn) {
      saveBtn.textContent = 'Nahradit prirucku';
    }
    if (formTitle) {
      formTitle.textContent = 'Nahradit prirucku (volitelne)';
    }
  } else {
    const saveBtn = document.getElementById('saveManualBtn');
    const formTitle = document.getElementById('uploadFormTitle');
    if (saveBtn) {
      saveBtn.textContent = 'Ulozit prirucku';
    }
    if (formTitle) {
      formTitle.textContent = 'Nahrat prirucku';
    }
  }
}

function formatDateTime(isoString) {
  if (!isoString) return '-';
  try {
    return new Date(isoString).toLocaleString('sk-SK', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return isoString;
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
