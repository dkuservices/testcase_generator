const state = {
  scenarios: [],
  status: 'needs_review',
  search: '',
  priorityFilter: 'all',
  classificationFilter: 'all',
  testTypeFilter: 'all',
  selected: new Set(),
};

const elements = {
  grid: document.getElementById('scenarioGrid'),
  empty: document.getElementById('emptyState'),
  countPill: document.getElementById('countPill'),
  refreshButton: document.getElementById('refreshButton'),
  cleanButton: document.getElementById('cleanButton'),
  statusFilter: document.getElementById('statusFilter'),
  priorityFilter: document.getElementById('priorityFilter'),
  classificationFilter: document.getElementById('classificationFilter'),
  testTypeFilter: document.getElementById('testTypeFilter'),
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
  expandAllButton: document.getElementById('expandAllButton'),
  collapseAllButton: document.getElementById('collapseAllButton'),
  statTotal: document.getElementById('statTotal'),
  statCritical: document.getElementById('statCritical'),
  statHigh: document.getElementById('statHigh'),
  statMedium: document.getElementById('statMedium'),
  statLow: document.getElementById('statLow'),
  statHappyPath: document.getElementById('statHappyPath'),
  statNegative: document.getElementById('statNegative'),
  statEdgeCase: document.getElementById('statEdgeCase'),
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

function formatCommentDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('sk-SK') + ' ' + d.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });
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

function computeStats(items) {
  const stats = {
    total: items.length,
    critical: 0, high: 0, medium: 0, low: 0,
    happy_path: 0, negative: 0, edge_case: 0,
  };

  items.forEach(item => {
    const s = item.scenario || {};
    const p = String(s.priority || '').toLowerCase();
    const c = String(s.scenario_classification || '').toLowerCase();
    if (p in stats) stats[p]++;
    if (c in stats) stats[c]++;
  });

  elements.statTotal.textContent = stats.total;
  elements.statCritical.textContent = stats.critical;
  elements.statHigh.textContent = stats.high;
  elements.statMedium.textContent = stats.medium;
  elements.statLow.textContent = stats.low;
  elements.statHappyPath.textContent = stats.happy_path;
  elements.statNegative.textContent = stats.negative;
  elements.statEdgeCase.textContent = stats.edge_case;
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
  const selectionKey = `${item.job_id}::${scenario.test_id}`;
  const isChecked = state.selected.has(selectionKey);

  card.className = 'card review-card collapsed';
  card.innerHTML = `
    <div class="card-header-row">
      <input type="checkbox" class="scenario-checkbox" data-key="${escapeHtml(selectionKey)}" ${isChecked ? 'checked' : ''}>
      <button type="button" class="card-toggle" aria-expanded="false" aria-label="Rozbaliť detaily">
        <span class="toggle-icon">&#9654;</span>
      </button>
      <div class="card-header-info">
        <h3 class="card-title">${escapeHtml(scenario.test_name || 'Nepomenovaný scenár')}</h3>
        <div class="badge-row">
          ${buildBadge(scenario.test_type)}
          ${buildBadge(scenario.scenario_classification)}
          ${buildBadge(scenario.priority)}
          ${buildBadge(scenario.validation_status)}
        </div>
      </div>
      <div class="card-header-actions">
        <button class="primary small" data-action="accept" data-job="${escapeHtml(item.job_id)}" data-test="${escapeHtml(scenario.test_id)}">Prijať</button>
        <button class="ghost small" data-action="edit" data-job="${escapeHtml(item.job_id)}" data-test="${escapeHtml(scenario.test_id)}">Upraviť</button>
        <button class="warn small" data-action="dismiss" data-job="${escapeHtml(item.job_id)}" data-test="${escapeHtml(scenario.test_id)}">Zamietnuť</button>
      </div>
      <div class="card-header-meta">
        <span>ID: ${escapeHtml(formatShortId(scenario.test_id))}</span>
        <span>${steps.length} krokov</span>
      </div>
    </div>
    <div class="card-body">
      <p class="review-card-description">${escapeHtml(scenario.description || 'Bez popisu.')}</p>
      <div class="section">
        <h4>Predpoklady</h4>
        <ul class="preconditions-list">
          ${preconditions.length > 0 ? preconditions.map(p => `<li>${escapeHtml(p)}</li>`).join('') : '<li>Neuvedené</li>'}
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
            ${stepRows || '<tr><td colspan="4">Žiadne kroky</td></tr>'}
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
      ${notes.length > 0 ? `
        <div class="section review-notes">
          <h4>Poznámky z validácie</h4>
          <ul>
            ${notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
      <div class="scenario-comments" data-job-id="${escapeHtml(item.job_id)}" data-test-id="${escapeHtml(scenario.test_id)}">
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
        <form class="comment-form" data-job-id="${escapeHtml(item.job_id)}" data-test-id="${escapeHtml(scenario.test_id)}">
          <input type="text" placeholder="Meno" class="comment-author-input" value="${escapeHtml(localStorage.getItem('comment_author') || '')}" maxlength="100" required>
          <div class="comment-form-row">
            <textarea placeholder="Pridať komentár..." class="comment-content-input" maxlength="2000" rows="2" required></textarea>
            <button type="submit" class="ghost small">Odoslať</button>
          </div>
        </form>
      </div>
    </div>
  `;

  return card;
}

async function loadScenarios() {
  elements.grid.innerHTML = '<div class="loading-spinner"></div>';
  elements.empty.classList.remove('active');
  elements.countPill.textContent = 'Načítavam...';

  try {
    const response = await fetch(`/api/review?status=${encodeURIComponent(state.status)}`);
    const data = await response.json();
    state.scenarios = Array.isArray(data.scenarios) ? data.scenarios : [];
    computeStats(state.scenarios);
    renderScenarios();
  } catch (error) {
    elements.countPill.textContent = 'Chyba načítania';
    elements.empty.classList.add('active');
  }
}

function renderScenarios() {
  const filtered = state.scenarios.filter(item => {
    const scenario = item.scenario || {};

    // Priority filter
    if (state.priorityFilter !== 'all' &&
        String(scenario.priority || '').toLowerCase() !== state.priorityFilter) {
      return false;
    }

    // Classification filter
    if (state.classificationFilter !== 'all' &&
        String(scenario.scenario_classification || '').toLowerCase() !== state.classificationFilter) {
      return false;
    }

    // Test type filter
    if (state.testTypeFilter !== 'all' &&
        String(scenario.test_type || '').toLowerCase() !== state.testTypeFilter) {
      return false;
    }

    // Text search
    if (state.search) {
      const needle = state.search.toLowerCase();
      return [
        scenario.test_name,
        item.job_id,
        item.parent_jira_issue_id,
        scenario.test_id,
        scenario.description,
      ]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(needle));
    }

    return true;
  });

  elements.grid.innerHTML = '';
  elements.countPill.textContent = `${filtered.length} scenár${filtered.length === 1 ? '' : filtered.length < 5 ? 'e' : 'ov'}`;

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
      (group.confluence_page_id ? `Page ${group.confluence_page_id}` : 'Manuálny vstup');

    const sourceLink = group.source_link;
    const titleHtml = sourceLink
      ? `<a class="review-group-title-link" href="${escapeHtml(sourceLink)}" target="_blank" rel="noopener">${escapeHtml(sourceLabel)}</a>`
      : escapeHtml(sourceLabel);

    const subtitleParts = [
      `Job ${escapeHtml(formatShortId(group.job_id))}`,
      group.parent_jira_issue_id ? `Jira: ${escapeHtml(group.parent_jira_issue_id)}` : null,
      escapeHtml(formatDate(group.job_created_at)),
    ].filter(Boolean).join(' &middot; ');

    groupEl.innerHTML = `
      <header class="review-group-header">
        <div>
          <h2 class="review-group-title">${titleHtml}</h2>
          <div class="review-group-subtitle">${subtitleParts}</div>
        </div>
        <div class="review-group-count">${group.items.length} scenár${group.items.length === 1 ? '' : group.items.length < 5 ? 'e' : 'ov'}</div>
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

// Toggle card expand/collapse
elements.grid.addEventListener('click', event => {
  const toggle = event.target instanceof Element ? event.target.closest('.card-toggle') : null;
  if (toggle) {
    const card = toggle.closest('.review-card');
    if (card) {
      const isCollapsed = card.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', String(!isCollapsed));
    }
    return;
  }

  // Action buttons
  const target = event.target instanceof Element ? event.target.closest('button[data-action]') : null;
  if (!target) return;

  const action = target.dataset.action;
  const jobId = target.dataset.job;
  const testId = target.dataset.test;
  if (!action || !jobId || !testId) return;

  const scenarioEntry = state.scenarios.find(item => item.job_id === jobId && item.scenario.test_id === testId);
  if (!scenarioEntry) return;

  (async () => {
    try {
      if (action === 'accept') {
        await updateValidation(jobId, testId, 'validated');
        state.scenarios = state.scenarios.filter(item => item !== scenarioEntry);
        computeStats(state.scenarios);
        renderScenarios();
      }

      if (action === 'dismiss') {
        const confirmDismiss = await showConfirm('Zamietnuť tento scenár? Zostane v histórií, ale nebude viditeľný v review.');
        if (!confirmDismiss) return;
        await updateValidation(jobId, testId, 'dismissed', 'Dismissed via review UI');
        state.scenarios = state.scenarios.filter(item => item !== scenarioEntry);
        computeStats(state.scenarios);
        renderScenarios();
      }

      if (action === 'edit') {
        openModal(scenarioEntry);
      }
    } catch (error) {
      showToast(error.message || 'Akcia zlyhala', 'error');
    }
  })();
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
    computeStats(state.scenarios);
    renderScenarios();
  } catch (error) {
    showToast(error.message || 'Uloženie zlyhalo', 'error');
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
  const confirmClean = await showConfirm(
    'Toto natrvalo vymaže VŠETKY scenáre vyžadujúce kontrolu. Túto akciu nie je možné vrátiť späť.',
    'Vymazať všetko', 'Zrušiť', true
  );
  if (!confirmClean) return;

  try {
    elements.cleanButton.disabled = true;
    elements.cleanButton.textContent = 'Mažem...';

    const response = await fetch('/api/review/clean', {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to clean scenarios');
    }

    const result = await response.json();
    showToast(`Vymazaných ${result.cleaned} scenárov z ${result.jobs_modified} jobov.`, 'success');
    await loadScenarios();
  } catch (error) {
    showToast(error.message || 'Mazanie zlyhalo', 'error');
  } finally {
    elements.cleanButton.disabled = false;
    elements.cleanButton.textContent = 'Vyčistiť všetko';
  }
});

// Filter event listeners
elements.statusFilter.addEventListener('change', event => {
  state.status = event.target.value;
  loadScenarios();
});

elements.priorityFilter.addEventListener('change', event => {
  state.priorityFilter = event.target.value;
  renderScenarios();
});

elements.classificationFilter.addEventListener('change', event => {
  state.classificationFilter = event.target.value;
  renderScenarios();
});

elements.testTypeFilter.addEventListener('change', event => {
  state.testTypeFilter = event.target.value;
  renderScenarios();
});

elements.searchInput.addEventListener('input', event => {
  state.search = event.target.value.trim();
  renderScenarios();
});

// Expand/Collapse All
elements.expandAllButton.addEventListener('click', () => {
  elements.grid.querySelectorAll('.review-card.collapsed').forEach(card => {
    card.classList.remove('collapsed');
    const toggle = card.querySelector('.card-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  });
});

elements.collapseAllButton.addEventListener('click', () => {
  elements.grid.querySelectorAll('.review-card:not(.collapsed)').forEach(card => {
    card.classList.add('collapsed');
    const toggle = card.querySelector('.card-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  });
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
    showToast('Vyberte aspoň jeden status na export.', 'warning');
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
    showToast(error.message || 'Export zlyhal', 'error');
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = 'Stiahnuť';
  }
});

// Bulk selection handling
const bulkBar = document.getElementById('bulkBar');
const bulkCount = document.getElementById('bulkCount');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');

function updateBulkBar() {
  const count = state.selected.size;
  if (count > 0) {
    bulkBar.style.display = 'flex';
    bulkCount.textContent = `${count} vybraných`;
  } else {
    bulkBar.style.display = 'none';
  }
}

// Comment form submission (delegated)
elements.grid.addEventListener('submit', async (event) => {
  const form = event.target.closest('.comment-form');
  if (!form) return;
  event.preventDefault();

  const jobId = form.dataset.jobId;
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
    const response = await fetch(`/api/review/${jobId}/${testId}/comments`, {
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
    const entry = state.scenarios.find(item => item.job_id === jobId && item.scenario.test_id === testId);
    if (entry) {
      if (!entry.scenario.comments) entry.scenario.comments = [];
      entry.scenario.comments.push(comment);
    }

    // Append to thread
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

    // Update count header
    const h4 = form.parentElement.querySelector('h4');
    if (h4 && entry) {
      h4.textContent = `Komentáre (${entry.scenario.comments.length})`;
    }

    localStorage.setItem('comment_author', author);
    contentInput.value = '';
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Odoslať';
  }
});

elements.grid.addEventListener('change', event => {
  const checkbox = event.target.closest('.scenario-checkbox');
  if (!checkbox) return;

  const key = checkbox.dataset.key;
  if (checkbox.checked) {
    state.selected.add(key);
  } else {
    state.selected.delete(key);
  }
  updateBulkBar();
});

selectAllCheckbox.addEventListener('change', () => {
  const checkboxes = elements.grid.querySelectorAll('.scenario-checkbox');
  if (selectAllCheckbox.checked) {
    checkboxes.forEach(cb => {
      cb.checked = true;
      state.selected.add(cb.dataset.key);
    });
  } else {
    checkboxes.forEach(cb => {
      cb.checked = false;
    });
    state.selected.clear();
  }
  updateBulkBar();
});

document.getElementById('bulkClearBtn').addEventListener('click', () => {
  state.selected.clear();
  selectAllCheckbox.checked = false;
  elements.grid.querySelectorAll('.scenario-checkbox').forEach(cb => { cb.checked = false; });
  updateBulkBar();
});

async function executeBulkAction(action) {
  const testIds = Array.from(state.selected).map(key => {
    const [job_id, test_id] = key.split('::');
    return { job_id, test_id };
  });

  if (testIds.length === 0) return;

  const label = action === 'accept' ? 'prijať' : 'zamietnuť';
  const confirmed = await showConfirm(
    `Naozaj chcete ${label} ${testIds.length} vybraných scenárov?`,
    action === 'accept' ? 'Prijať' : 'Zamietnuť',
    'Zrušiť',
    action === 'dismiss'
  );
  if (!confirmed) return;

  try {
    const response = await fetch('/api/review/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, test_ids: testIds }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Hromadná akcia zlyhala');
    }

    const result = await response.json();
    showToast(`Aktualizovaných ${result.updated} scenárov.`, 'success');
    state.selected.clear();
    selectAllCheckbox.checked = false;
    updateBulkBar();
    await loadScenarios();
  } catch (error) {
    showToast(error.message || 'Hromadná akcia zlyhala', 'error');
  }
}

document.getElementById('bulkAcceptBtn').addEventListener('click', () => executeBulkAction('accept'));
document.getElementById('bulkDismissBtn').addEventListener('click', () => executeBulkAction('dismiss'));

loadScenarios();
