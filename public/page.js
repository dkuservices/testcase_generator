// Page Detail JavaScript

let pageId = null;
let currentPage = null;
let pollingInterval = null;
let allScenarios = []; // Store all scenarios for filtering
const chatState = {
  messages: [],
  pendingEl: null,
};

function saveChatMessages() {
  if (!pageId) return;
  try {
    localStorage.setItem(`page:${pageId}:chat`, JSON.stringify(chatState.messages));
  } catch (_) { /* quota exceeded – ignore */ }
}

function loadChatMessages() {
  if (!pageId) return;
  try {
    const stored = localStorage.getItem(`page:${pageId}:chat`);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        chatState.messages = parsed;
      }
    }
  } catch (_) { /* corrupted – ignore */ }
}

function restoreChatUI() {
  if (!chatElements.log || chatState.messages.length === 0) return;
  if (chatElements.empty) {
    chatElements.empty.style.display = 'none';
  }
  for (const msg of chatState.messages) {
    appendChatMessage(msg.role, msg.content);
  }
}

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

  pageId = getPageIdFromUrl();
  if (!pageId) {
    window.location.href = '/projects';
    return;
  }

  // Reset filter state when loading a new page
  resetFilterState();

  loadPage();
  setupEventListeners();
  setupContextEventListeners();

  // Restore persisted chat messages
  loadChatMessages();
  restoreChatUI();

  // Export modal
  if (typeof initExportModal === 'function') {
    initExportModal(
      () => allScenarios,
      () => currentPage ? currentPage.name : ''
    );
  }
});

function resetFilterState() {
  filterState.status = 'all';
  filterState.classification = 'all';
  filterState.search = '';

  // Reset UI filter controls
  const statusFilter = document.getElementById('statusFilter');
  const classificationFilter = document.getElementById('classificationFilter');
  const searchInput = document.getElementById('searchInput');

  if (statusFilter) statusFilter.value = 'all';
  if (classificationFilter) classificationFilter.value = 'all';
  if (searchInput) searchInput.value = '';
}

function getPageIdFromUrl() {
  const match = window.location.pathname.match(/\/page\/([^/]+)/);
  return match ? match[1] : null;
}

function setupEventListeners() {
  // Edit page
  document.getElementById('editPageBtn').addEventListener('click', openEditModal);
  document.getElementById('cancelEditBtn').addEventListener('click', closeEditModal);

  // Delete page
  document.getElementById('deletePageBtn').addEventListener('click', handleDeletePage);

  // Clear all tests
  document.getElementById('clearAllTestsBtn').addEventListener('click', handleClearAllTests);

  // Generate tests
  document.getElementById('generateTestsBtn').addEventListener('click', handleGenerateTests);
  document.getElementById('generateTestsEmptyBtn')?.addEventListener('click', handleGenerateTests);

  // Modal overlay
  document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeEditModal();
  });

  // Form
  document.getElementById('editPageForm').addEventListener('submit', handleEditPage);

  const maxTestsInput = document.getElementById('maxTestsInput');
  if (maxTestsInput) {
    const stored = localStorage.getItem(`page:${pageId}:maxTests`);
    if (stored) {
      maxTestsInput.value = stored;
    }
    maxTestsInput.addEventListener('change', () => {
      localStorage.setItem(`page:${pageId}:maxTests`, maxTestsInput.value);
    });
  }

  if (chatElements.form) {
    chatElements.form.addEventListener('submit', handleChatSubmit);
  }
  if (chatElements.clearBtn) {
    chatElements.clearBtn.addEventListener('click', resetChat);
  }

  // Filter controls
  const statusFilter = document.getElementById('statusFilter');
  const classificationFilter = document.getElementById('classificationFilter');
  const searchInput = document.getElementById('searchInput');

  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      filterState.status = e.target.value;
      renderFilteredTests();
    });
  }
  if (classificationFilter) {
    classificationFilter.addEventListener('change', (e) => {
      filterState.classification = e.target.value;
      renderFilteredTests();
    });
  }
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterState.search = e.target.value.trim().toLowerCase();
      renderFilteredTests();
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
  const scenariosContainer = document.getElementById('scenariosContainer');
  if (scenariosContainer) {
    scenariosContainer.addEventListener('click', handleScenarioAction);

    // Comment form submission (delegated)
    scenariosContainer.addEventListener('submit', async (e) => {
      const form = e.target.closest('.comment-form');
      if (!form) return;
      e.preventDefault();

      const testId = form.dataset.testId;
      const authorInput = form.querySelector('.comment-author-input');
      const contentInput = form.querySelector('.comment-content-input');
      const submitBtn = form.querySelector('button[type="submit"]');
      const author = authorInput.value.trim();
      const content = contentInput.value.trim();

      if (!author || !content) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Odosielam...';

      try {
        const response = await fetch(`/api/pages/${pageId}/tests/${testId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ author, content }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || 'Nepodarilo sa pridať komentár');
        }

        const comment = await response.json();

        // Update local state
        const scenario = allScenarios.find(s => s.test_id === testId);
        if (scenario) {
          if (!scenario.comments) scenario.comments = [];
          scenario.comments.push(comment);
        }

        // Append to thread without re-rendering the whole page
        const thread = form.parentElement.querySelector('.comments-thread');
        if (thread) {
          const div = document.createElement('div');
          div.className = 'comment-item';
          div.innerHTML = `
            <div class="comment-header">
              <strong class="comment-author">${escapeHtml(comment.author)}</strong>
              <time class="comment-time">${formatCommentDate(comment.created_at)}</time>
            </div>
            <p class="comment-content">${escapeHtml(comment.content)}</p>
          `;
          thread.appendChild(div);
        }

        // Update comment count
        const h4 = form.parentElement.querySelector('h4');
        if (h4 && scenario) {
          h4.textContent = `Komentáre (${scenario.comments.length})`;
        }

        // Save author for reuse, clear content
        localStorage.setItem('comment_author', author);
        contentInput.value = '';
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Odoslať';
      }
    });
  }
}

async function loadPage() {
  document.getElementById('scenariosContainer').innerHTML = '<div class="loading-spinner"></div>';

  try {
    const response = await fetch(`/api/pages/${pageId}`);
    if (!response.ok) {
      if (response.status === 404) {
        showToast('Stránka nebola nájdená', 'error');
        window.location.href = '/projects';
        return;
      }
      throw new Error('Nepodarilo sa načítať stránku');
    }

    const page = await response.json();
    currentPage = page;
    renderPage(page);
    loadTests();
    loadJobHistory();
    loadSupplementaryContext();

    // Load source document data if this page was created from a document
    if (page.source_type === 'document' && page.document_id) {
      loadSourceDocument();
    }
  } catch (error) {
    console.error('Error loading page:', error);
    showError('Nepodarilo sa načítať stránku');
  }
}

function renderPage(page) {
  document.title = `${page.name} - Generátor testovacích scenárov`;
  document.getElementById('breadcrumbName').textContent = page.name;
  document.getElementById('pageName').textContent = page.name;

  const linkEl = document.getElementById('confluenceLink');
  if (page.source_type === 'document') {
    linkEl.innerHTML = `<span class="muted">Zdroj: dokumentový celok</span>`;
  } else {
    linkEl.innerHTML = `<a href="${escapeHtml(page.confluence_link)}" target="_blank" rel="noopener">${escapeHtml(page.confluence_link)}</a>`;
  }

  // Set breadcrumb links
  document.getElementById('breadcrumbProject').href = `/project/${page.project_id}`;
  document.getElementById('breadcrumbComponent').href = `/component/${page.component_id}`;

  // Populate edit form
  document.getElementById('editPageName').value = page.name;
  document.getElementById('editConfluenceLink').value = page.confluence_link;

  // Render dependencies
  renderDependencies(page.dependencies || []);

  // Check if there's a processing job
  if (page.latest_job && page.latest_job.status === 'processing') {
    startPolling(page.latest_job.job_id);
  }
}

function renderDependencies(dependencies) {
  const section = document.getElementById('dependenciesSection');
  const list = document.getElementById('dependenciesList');

  if (!dependencies || dependencies.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  list.innerHTML = dependencies.map(dep => `
    <a href="/page/${escapeHtml(dep.page_id)}" class="dependency-item">
      <span class="dependency-name">${escapeHtml(dep.page_name || dep.page_id)}</span>
      ${dep.notes ? `<span class="dependency-notes">${escapeHtml(dep.notes)}</span>` : ''}
    </a>
  `).join('');
}

async function loadSourceDocument() {
  try {
    const response = await fetch(`/api/pages/${pageId}/source-document`);
    if (!response.ok) {
      console.warn('Nepodarilo sa načítať zdrojový dokument');
      return;
    }

    const data = await response.json();
    if (!data.has_source_document) {
      return;
    }

    renderSourceDocument(data);
  } catch (error) {
    console.error('Error loading source document:', error);
  }
}

function renderSourceDocument(data) {
  const section = document.getElementById('sourceDocumentSection');
  if (!section) return;

  section.style.display = 'block';

  // Document info
  document.getElementById('sourceDocFilename').textContent = data.document?.filename || 'Neznamy dokument';

  const metaParts = [];
  if (data.document?.parsed_at) {
    metaParts.push(`Nahrane: ${formatDateTime(data.document.parsed_at)}`);
  }
  if (data.document?.status) {
    metaParts.push(`Status: ${data.document.status}`);
  }
  document.getElementById('sourceDocMeta').textContent = metaParts.join(' | ');

  // Document page details
  if (data.document_page) {
    // Description
    const descContent = document.getElementById('sourceDocDescriptionContent');
    descContent.textContent = data.document_page.description || 'Bez popisu';

    // Change requests
    const crList = document.getElementById('changeRequestsList');
    if (data.document_page.change_requests && data.document_page.change_requests.length > 0) {
      crList.innerHTML = data.document_page.change_requests.map(cr => `
        <div class="change-request-item" style="background: white; padding: 0.75rem; border-radius: 4px; margin-bottom: 0.5rem;">
          <div style="font-weight: 500; margin-bottom: 0.25rem;">${escapeHtml(cr.title)}</div>
          <div style="font-size: 0.85rem; color: #666; margin-bottom: 0.5rem;">${escapeHtml(cr.description || '')}</div>
          ${cr.acceptance_criteria && cr.acceptance_criteria.length > 0 ? `
            <div style="font-size: 0.85rem;">
              <strong>Akceptacne kriteria:</strong>
              <ul style="margin: 0.25rem 0 0 1rem; padding: 0;">
                ${cr.acceptance_criteria.map(ac => `<li>${escapeHtml(ac)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${cr.affected_areas && cr.affected_areas.length > 0 ? `
            <div style="font-size: 0.85rem; margin-top: 0.5rem;">
              <strong>Ovplyvnene oblasti:</strong> ${cr.affected_areas.map(a => escapeHtml(a)).join(', ')}
            </div>
          ` : ''}
        </div>
      `).join('');
    } else {
      crList.innerHTML = '<p class="muted">Ziadne zmenove poziadavky</p>';
    }
  }

  // Manual info
  if (data.document?.has_manual) {
    const manualSection = document.getElementById('sourceDocManualInfo');
    const manualContent = document.getElementById('sourceDocManualContent');
    const downloadBtn = document.getElementById('downloadManualBtn');
    manualSection.style.display = 'block';

    if (data.document.manual_info?.is_chunked) {
      manualContent.innerHTML = `
        <span style="color: #059669;">&#10003;</span> Prirucka nahrana a rozdelena na sekcie
        ${data.document.manual_info.manual_filename ? ` (${escapeHtml(data.document.manual_info.manual_filename)})` : ''}
      `;
    } else {
      manualContent.innerHTML = `
        <span style="color: #059669;">&#10003;</span> Prirucka nahrana
        ${data.document.manual_info?.manual_filename ? ` (${escapeHtml(data.document.manual_info.manual_filename)})` : ''}
      `;
    }

    // Show download button if manual file exists
    if (data.document?.document_id && downloadBtn) {
      downloadBtn.href = `/api/documents/${data.document.document_id}/manual/download`;
      downloadBtn.style.display = 'inline-block';
    }
  }

  // Toggle button
  const toggleBtn = document.getElementById('toggleSourceDocBtn');
  const detailsDiv = document.getElementById('sourceDocDetails');

  toggleBtn.addEventListener('click', () => {
    if (detailsDiv.style.display === 'none') {
      detailsDiv.style.display = 'block';
      toggleBtn.textContent = 'Skryt detaily';
    } else {
      detailsDiv.style.display = 'none';
      toggleBtn.textContent = 'Zobrazit detaily';
    }
  });
}

async function loadTests() {
  try {
    const response = await fetch(`/api/pages/${pageId}/tests`);
    if (!response.ok) throw new Error('Nepodarilo sa načítať testy');

    const data = await response.json();
    allScenarios = data.scenarios || [];

    // Update stats
    document.getElementById('testCount').textContent = `${data.total || 0} testovacích scenárov`;
    document.getElementById('totalScenarios').textContent = data.total || 0;
    document.getElementById('validatedScenarios').textContent = data.validated || 0;
    document.getElementById('needsReviewScenarios').textContent = data.needs_review || 0;
    updateChatContext(data.total || 0);

    renderFilteredTests();
  } catch (error) {
    console.error('Error loading tests:', error);
  }
}

function renderFilteredTests() {
  const filtered = allScenarios.filter(scenario => {
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

  renderTests(filtered);
}

function renderTests(scenarios) {
  const container = document.getElementById('scenariosContainer');
  const emptyState = document.getElementById('emptyState');
  const filterControls = document.getElementById('filterControls');

  if (allScenarios.length === 0) {
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
        <h3>Žiadne zodpovedajúce scenáre</h3>
        <p>Skúste upraviť filtre</p>
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
            : '<li>Neuvedené</li>'}
        </ul>
      </div>

      <div class="section">
        <h4>Testovacie kroky</h4>
        <table class="steps-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Akcia</th>
              <th>Vstup</th>
              <th>Očakávaný výsledok</th>
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
            `).join('') || '<tr><td colspan="4">Žiadne kroky</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="section">
        <h4>Metadáta</h4>
        <div class="meta">
          <span>Priečinok: ${escapeHtml(scenario.test_repository_folder || 'N/A')}</span>
          <span>Automatizácia: ${escapeHtml(formatLabel(scenario.automation_status || 'N/A'))}</span>
        </div>
      </div>

      ${scenario.validation_notes ? `
        <div class="section review-notes">
          <h4>Poznámky z validácie</h4>
          <p>${escapeHtml(scenario.validation_notes)}</p>
        </div>
      ` : ''}

      <div class="card-actions">
        ${scenario.validation_status === 'needs_review' ? `
          <button class="primary" data-action="accept" data-test-id="${escapeHtml(scenario.test_id)}">Prijať</button>
        ` : ''}
        <button class="ghost" data-action="edit" data-test-id="${escapeHtml(scenario.test_id)}">Upraviť</button>
        ${scenario.validation_status !== 'dismissed' ? `
          <button class="warn" data-action="dismiss" data-test-id="${escapeHtml(scenario.test_id)}">Zamietnuť</button>
        ` : ''}
        <button class="danger" data-action="delete" data-test-id="${escapeHtml(scenario.test_id)}">Zmazať</button>
      </div>

      <div class="scenario-comments" data-test-id="${escapeHtml(scenario.test_id)}">
        <h4>Komentáre ${(scenario.comments || []).length > 0 ? `(${scenario.comments.length})` : ''}</h4>
        <div class="comments-thread">
          ${(scenario.comments || []).map(c => `
            <div class="comment-item">
              <div class="comment-header">
                <strong class="comment-author">${escapeHtml(c.author)}</strong>
                <time class="comment-time">${formatCommentDate(c.created_at)}</time>
              </div>
              <p class="comment-content">${escapeHtml(c.content)}</p>
            </div>
          `).join('')}
        </div>
        <form class="comment-form" data-test-id="${escapeHtml(scenario.test_id)}">
          <input type="text" placeholder="Meno" class="comment-author-input" maxlength="100" required>
          <div class="comment-form-row">
            <textarea placeholder="Pridať komentár..." class="comment-content-input" maxlength="2000" rows="2" required></textarea>
            <button type="submit" class="ghost small">Odoslať</button>
          </div>
        </form>
      </div>
    </div>
  `).join('');

  // Auto-fill saved author name
  const savedAuthor = localStorage.getItem('comment_author');
  if (savedAuthor) {
    container.querySelectorAll('.comment-author-input').forEach(input => {
      if (!input.value) input.value = savedAuthor;
    });
  }
}

async function handleScenarioAction(e) {
  const button = e.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const testId = button.dataset.testId;
  if (!action || !testId) return;

  const scenario = allScenarios.find(s => s.test_id === testId);
  if (!scenario) return;

  try {
    if (action === 'accept') {
      await updateScenarioValidation(testId, 'validated');
      scenario.validation_status = 'validated';
      renderFilteredTests();
      updateStats();
    } else if (action === 'dismiss') {
      if (!await showConfirm('Zamietnuť tento scenár?')) return;
      await updateScenarioValidation(testId, 'dismissed', 'Dismissed via page review');
      scenario.validation_status = 'dismissed';
      renderFilteredTests();
      updateStats();
    } else if (action === 'delete') {
      if (!await showConfirm('Zmazať tento scenár natrvalo? Túto akciu nie je možné vrátiť.', 'Zmazať', 'Zrušiť', true)) return;
      await deleteScenario(testId);
      allScenarios = allScenarios.filter(s => s.test_id !== testId);
      renderFilteredTests();
      updateStats();
    } else if (action === 'edit') {
      openScenarioEditModal(scenario);
    }
  } catch (error) {
    showToast('Akcia zlyhala: ' + error.message, 'error');
  }
}

async function updateScenarioValidation(testId, status, notes) {
  const response = await fetch(`/api/pages/${pageId}/tests/${testId}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      validation_status: status,
      validation_notes: notes || undefined,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.message || 'Nepodarilo sa aktualizovať validáciu');
  }
}

async function deleteScenario(testId) {
  const response = await fetch(`/api/pages/${pageId}/tests/${testId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.message || 'Nepodarilo sa zmazať scenár');
  }
}

function updateStats() {
  const total = allScenarios.length;
  const validated = allScenarios.filter(s => s.validation_status === 'validated').length;
  const needsReview = allScenarios.filter(s => s.validation_status === 'needs_review').length;

  document.getElementById('testCount').textContent = `${total} testovacích scenárov`;
  document.getElementById('totalScenarios').textContent = total;
  document.getElementById('validatedScenarios').textContent = validated;
  document.getElementById('needsReviewScenarios').textContent = needsReview;
  updateChatContext(total);
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
    submitBtn.textContent = 'Ukladám...';

    const response = await fetch(`/api/pages/${pageId}/tests/${testId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || error.message || 'Nepodarilo sa uložiť zmeny');
    }

    // Update local state
    const scenario = allScenarios.find(s => s.test_id === testId);
    if (scenario) {
      Object.assign(scenario, payload);
    }

    closeScenarioEditModal();
    renderFilteredTests();
  } catch (error) {
    showToast('Nepodarilo sa uložiť: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

async function loadJobHistory() {
  try {
    const response = await fetch(`/api/pages/${pageId}/jobs`);
    if (!response.ok) throw new Error('Nepodarilo sa načítať históriu úloh');

    const data = await response.json();
    renderJobHistory(data.jobs || []);
  } catch (error) {
    console.error('Error loading job history:', error);
  }
}

function renderJobHistory(jobs) {
  const container = document.getElementById('jobHistoryContainer');

  if (jobs.length === 0) {
    container.innerHTML = '<p class="muted">Zatiaľ žiadna história generovania</p>';
    return;
  }

  container.innerHTML = `
    <table class="scenarios-table">
      <thead>
        <tr>
          <th>ID úlohy</th>
          <th>Stav</th>
          <th>Scenáre</th>
          <th>Vytvorené</th>
          <th>Dokončené</th>
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

function openEditModal() {
  document.getElementById('editModal').classList.add('active');
  document.getElementById('editPageName').focus();
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('active');
}

async function handleEditPage(e) {
  e.preventDefault();

  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Ukladám...';

    const name = document.getElementById('editPageName').value.trim();
    const confluenceLink = document.getElementById('editConfluenceLink').value.trim();

    const response = await fetch(`/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, confluence_link: confluenceLink }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Nepodarilo sa aktualizovať stránku');
    }

    closeEditModal();
    loadPage();
    if (window.sidebarRefresh) window.sidebarRefresh();
  } catch (error) {
    console.error('Error updating page:', error);
    showToast('Nepodarilo sa aktualizovať stránku: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

async function handleDeletePage() {
  if (!await showConfirm(`Naozaj chcete zmazať "${currentPage.name}"?\n\nTúto akciu nie je možné vrátiť.`, 'Zmazať', 'Zrušiť', true)) {
    return;
  }

  try {
    const response = await fetch(`/api/pages/${pageId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Nepodarilo sa zmazať stránku');
    }

    window.location.href = `/component/${currentPage.component_id}`;
  } catch (error) {
    console.error('Error deleting page:', error);
    showToast('Nepodarilo sa zmazať stránku: ' + error.message, 'error');
  }
}

async function handleClearAllTests() {
  const testCount = allScenarios.length;
  if (testCount === 0) {
    showToast('Žiadne testy na vymazanie.', 'warning');
    return;
  }

  if (!await showConfirm(`Naozaj chcete vymazať všetky ${testCount} testovacie scenáre?\n\nTúto akciu nie je možné vrátiť.`, 'Zmazať', 'Zrušiť', true)) {
    return;
  }

  const btn = document.getElementById('clearAllTestsBtn');
  const originalText = btn.textContent;

  try {
    btn.disabled = true;
    btn.textContent = 'Mažem...';

    const response = await fetch(`/api/pages/${pageId}/tests`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Nepodarilo sa vymazať testy');
    }

    const result = await response.json();
    allScenarios = [];
    renderFilteredTests();
    updateStats();
    showToast(`Úspešne vymazaných ${result.deleted_count} testovacích scenárov.`, 'success');
  } catch (error) {
    console.error('Error clearing tests:', error);
    showToast('Nepodarilo sa vymazať testy: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function handleGenerateTests() {
  const btn = document.getElementById('generateTestsBtn');
  const originalText = btn.textContent;
  const maxTestsInput = document.getElementById('maxTestsInput');
  const maxTestsValue = maxTestsInput ? parseInt(maxTestsInput.value, 10) : NaN;
  const payload = Number.isFinite(maxTestsValue) && maxTestsValue > 0
    ? { max_tests: maxTestsValue }
    : null;

  try {
    btn.disabled = true;
    btn.textContent = 'Spúšťam...';

    const response = await fetch(`/api/pages/${pageId}/generate`, {
      method: 'POST',
      headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Nepodarilo sa spustiť generovanie');
    }

    const result = await response.json();
    showGenerationStatus('processing', 'Generovanie testov spustené...');
    if (window.trackJob) window.trackJob(result.job_id, currentPage ? currentPage.name : 'Test generovanie');
    startPolling(result.job_id);
  } catch (error) {
    console.error('Error starting generation:', error);
    showToast('Nepodarilo sa spustiť generovanie: ' + error.message, 'error');
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function startPolling(jobId) {
  if (pollingInterval) clearInterval(pollingInterval);

  const btn = document.getElementById('generateTestsBtn');
  btn.disabled = true;
  btn.textContent = 'Generujem...';

  pollingInterval = setInterval(async () => {
    try {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) throw new Error('Nepodarilo sa skontrolovať stav úlohy');

      const job = await response.json();

      if (job.status === 'completed') {
        stopPolling();
        if (window.untrackJob) window.untrackJob(jobId);
        showGenerationStatus('success', 'Generovanie testov dokončené!');
        loadTests();
        loadJobHistory();
        btn.disabled = false;
        btn.textContent = 'Generovať testy';
      } else if (job.status === 'failed') {
        stopPolling();
        if (window.untrackJob) window.untrackJob(jobId);
        showGenerationStatus('error', `Generovanie zlyhalo: ${job.error || 'Neznáma chyba'}`);
        btn.disabled = false;
        btn.textContent = 'Generovať testy';
      } else {
        showGenerationStatus('loading', 'Generovanie testov prebieha...');
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
  const statusEl = document.getElementById('generationStatus');
  const messageEl = document.getElementById('generationStatusMessage');

  statusEl.style.display = 'block';
  statusEl.className = `status ${type}`;
  messageEl.textContent = message;

  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 5000);
  }
}

function formatDateTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleString();
}

function formatLabel(value) {
  if (!value) return 'Neznáme';
  const text = String(value).replace(/_/g, ' ');
  return text.replace(/\b\w/g, match => match.toUpperCase());
}

function formatShortId(value, length = 8) {
  if (!value) return 'Neznáme';
  const text = String(value);
  if (text.length <= length) return text;
  return `${text.slice(0, length)}...`;
}

function formatCommentDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('sk-SK') + ' ' + d.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });
}

function updateChatContext(totalScenarios) {
  if (!chatElements.context) return;
  chatElements.context.textContent = `Používa ${totalScenarios} scenárov`;
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
    chatState.pendingEl = appendChatMessage('assistant pending', 'Premýšľam...');
  } else if (chatState.pendingEl) {
    chatState.pendingEl.remove();
    chatState.pendingEl = null;
  }
}

function resetChat() {
  if (!chatElements.log) return;
  chatState.messages = [];
  saveChatMessages();
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
  saveChatMessages();
  appendChatMessage('user', message);
  setChatPending(true);

  try {
    const response = await fetch(`/api/chat/page/${pageId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: getChatHistory().slice(0, -1),
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || data.message || 'Požiadavka na chat zlyhala');
    }

    const reply = data.reply || 'Žiadna odpoveď od asistenta.';
    chatState.messages.push({ role: 'assistant', content: reply });
    saveChatMessages();
    setChatPending(false);
    appendChatMessage('assistant', reply);

    if (data.context && typeof data.context.scenario_count === 'number') {
      updateChatContext(data.context.scenario_count);
    }
  } catch (error) {
    setChatPending(false);
    appendChatMessage('assistant', error.message || 'Požiadavka na chat zlyhala.');
  }
}

function showError(message) {
  const container = document.getElementById('scenariosContainer');
  container.innerHTML = `
    <div class="empty-state">
      <h3>Chyba</h3>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="primary" onclick="loadPage()">Skúsiť znova</button>
    </div>
  `;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== Supplementary Context Management =====

function setupContextEventListeners() {
  // Toggle context form
  const toggleBtn = document.getElementById('toggleContextFormBtn');
  const addForm = document.getElementById('addContextForm');
  const cancelBtn = document.getElementById('cancelContextBtn');
  const saveBtn = document.getElementById('saveContextBtn');
  const clearBtn = document.getElementById('clearContextBtn');

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const isVisible = addForm.style.display !== 'none';
      addForm.style.display = isVisible ? 'none' : 'block';
      toggleBtn.textContent = isVisible ? '+ Pridať kontext' : '- Zavrieť';
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      addForm.style.display = 'none';
      if (toggleBtn) toggleBtn.textContent = '+ Pridať kontext';
      resetContextForm();
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', handleSaveContext);
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', handleClearContext);
  }

  // Context type radio buttons
  const radioButtons = document.querySelectorAll('input[name="contextType"]');
  radioButtons.forEach(radio => {
    radio.addEventListener('change', handleContextTypeChange);
  });
}

function handleContextTypeChange(e) {
  const selectedType = e.target.value;

  document.getElementById('textContextInput').style.display = selectedType === 'text' ? 'block' : 'none';
  document.getElementById('fileContextInput').style.display = selectedType === 'file' ? 'block' : 'none';
  document.getElementById('linkContextInput').style.display = selectedType === 'link' ? 'block' : 'none';
}

async function loadSupplementaryContext() {
  try {
    const response = await fetch(`/api/pages/${pageId}/context`);
    if (!response.ok) {
      console.warn('Nepodarilo sa načítať doplnkový kontext');
      return;
    }

    const data = await response.json();
    if (data.supplementary_context) {
      displaySupplementaryContext(data.supplementary_context);
    }
  } catch (error) {
    console.error('Error loading supplementary context:', error);
  }
}

function displaySupplementaryContext(context) {
  const display = document.getElementById('currentContextDisplay');
  const content = document.getElementById('contextContent');
  const meta = document.getElementById('contextMeta');

  if (!context || !context.additional_text) {
    display.style.display = 'none';
    return;
  }

  display.style.display = 'block';

  // Show truncated text
  const text = context.additional_text;
  const truncated = text.length > 500 ? text.substring(0, 500) + '...' : text;
  content.textContent = truncated;

  // Show metadata
  const metaParts = [];
  if (context.added_at) {
    metaParts.push(`Pridané: ${formatDateTime(context.added_at)}`);
  }
  if (context.source_file) {
    metaParts.push(`Súbor: ${context.source_file.filename} (${context.source_file.file_type})`);
  }
  metaParts.push(`Dĺžka: ${text.length} znakov`);

  meta.innerHTML = metaParts.map(p => `<span>${escapeHtml(p)}</span>`).join('');
}

async function handleSaveContext() {
  const saveBtn = document.getElementById('saveContextBtn');
  const originalText = saveBtn.textContent;

  try {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Ukladám...';

    const selectedType = document.querySelector('input[name="contextType"]:checked').value;

    let response;
    if (selectedType === 'text') {
      const text = document.getElementById('contextText').value.trim();
      if (!text) {
        showToast('Zadajte text kontextu', 'warning');
        return;
      }

      response = await fetch(`/api/pages/${pageId}/context/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } else if (selectedType === 'file') {
      const fileInput = document.getElementById('contextFile');
      const file = fileInput.files[0];
      if (!file) {
        showToast('Vyberte súbor', 'warning');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);

      response = await fetch(`/api/pages/${pageId}/context/file`, {
        method: 'POST',
        body: formData,
      });
    } else if (selectedType === 'link') {
      const link = document.getElementById('contextLink').value.trim();
      if (!link) {
        showToast('Zadajte Confluence link', 'warning');
        return;
      }

      response = await fetch(`/api/pages/${pageId}/context/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link }),
      });
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Nepodarilo sa uložiť kontext');
    }

    const result = await response.json();
    displaySupplementaryContext(result.supplementary_context);

    // Hide form and reset
    document.getElementById('addContextForm').style.display = 'none';
    const toggleBtn = document.getElementById('toggleContextFormBtn');
    if (toggleBtn) toggleBtn.textContent = '+ Pridať kontext';
    resetContextForm();

    showToast('Kontext úspešne uložený', 'success');
  } catch (error) {
    showToast('Chyba pri ukladaní: ' + error.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
}

async function handleClearContext() {
  if (!await showConfirm('Naozaj chcete odstrániť dodatočný kontext? Táto akcia sa nedá vrátiť späť.', 'Zmazať', 'Zrušiť', true)) {
    return;
  }

  const clearBtn = document.getElementById('clearContextBtn');
  const originalText = clearBtn.textContent;

  try {
    clearBtn.disabled = true;
    clearBtn.textContent = 'Odstraňujem...';

    const response = await fetch(`/api/pages/${pageId}/context`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Nepodarilo sa odstrániť kontext');
    }

    document.getElementById('currentContextDisplay').style.display = 'none';
    showToast('Kontext úspešne odstránený', 'success');
  } catch (error) {
    showToast('Chyba pri odstraňovaní: ' + error.message, 'error');
  } finally {
    clearBtn.disabled = false;
    clearBtn.textContent = originalText;
  }
}

function resetContextForm() {
  document.getElementById('contextText').value = '';
  document.getElementById('contextFile').value = '';
  document.getElementById('contextLink').value = '';

  // Reset to text type
  const textRadio = document.querySelector('input[name="contextType"][value="text"]');
  if (textRadio) {
    textRadio.checked = true;
    handleContextTypeChange({ target: textRadio });
  }
}

// Cleanup on page unload
window.addEventListener('beforeunload', stopPolling);
