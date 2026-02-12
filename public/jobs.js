// Jobs Page JavaScript

let allJobs = [];
let currentPage = 0;
let totalJobs = 0;
let pollingInterval = null;
const PAGE_SIZE = 20;

const filterState = {
  status: 'all',
  search: '',
};

document.addEventListener('DOMContentLoaded', () => {
  loadJobs();
  setupEventListeners();
  startPolling();
});

function setupEventListeners() {
  // Refresh button
  document.getElementById('refreshBtn').addEventListener('click', () => {
    currentPage = 0;
    loadJobs();
  });

  // Filter controls
  const statusFilter = document.getElementById('statusFilter');
  const searchInput = document.getElementById('searchInput');

  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      filterState.status = e.target.value;
      currentPage = 0;
      loadJobs();
    });
  }

  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        filterState.search = e.target.value.trim().toLowerCase();
        renderFilteredJobs();
      }, 300);
    });
  }

  // Pagination
  document.getElementById('prevPageBtn').addEventListener('click', () => {
    if (currentPage > 0) {
      currentPage--;
      loadJobs();
    }
  });

  document.getElementById('nextPageBtn').addEventListener('click', () => {
    if ((currentPage + 1) * PAGE_SIZE < totalJobs) {
      currentPage++;
      loadJobs();
    }
  });

  // Modal
  document.getElementById('jobDetailModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeJobDetailModal();
  });
  document.getElementById('closeJobDetailBtn').addEventListener('click', closeJobDetailModal);

  // Jobs container click delegation
  document.getElementById('jobsContainer').addEventListener('click', handleJobClick);
}

async function loadJobs() {
  try {
    const params = new URLSearchParams({
      limit: PAGE_SIZE.toString(),
      offset: (currentPage * PAGE_SIZE).toString(),
    });

    if (filterState.status !== 'all') {
      params.append('status', filterState.status);
    }

    const response = await fetch(`/api/jobs?${params}`);
    if (!response.ok) throw new Error('Nepodarilo sa načítať joby');

    const data = await response.json();
    allJobs = data.jobs || [];
    totalJobs = data.total || 0;

    updateStats();
    renderFilteredJobs();
    updatePagination();
  } catch (error) {
    console.error('Chyba pri načítavaní jobov:', error);
    showError('Nepodarilo sa načítať joby');
  }
}

function updateStats() {
  // We need to load all jobs to get accurate stats, so make a separate call
  fetch('/api/jobs?limit=200')
    .then(res => res.json())
    .then(data => {
      const jobs = data.jobs || [];
      const processing = jobs.filter(j => j.status === 'processing').length;
      const completed = jobs.filter(j => j.status === 'completed').length;
      const failed = jobs.filter(j => j.status === 'failed').length;

      document.getElementById('totalJobs').textContent = data.total || 0;
      document.getElementById('processingJobs').textContent = processing;
      document.getElementById('completedJobs').textContent = completed;
      document.getElementById('failedJobs').textContent = failed;
    })
    .catch(err => console.error('Chyba pri načítavaní štatistík:', err));
}

function renderFilteredJobs() {
  let filtered = allJobs;

  // Apply search filter
  if (filterState.search) {
    filtered = filtered.filter(job => {
      const searchable = [
        job.job_id,
        job.parent_jira_issue_id,
        job.status,
      ].filter(Boolean).join(' ').toLowerCase();
      return searchable.includes(filterState.search);
    });
  }

  renderJobs(filtered);
}

function renderJobs(jobs) {
  const container = document.getElementById('jobsContainer');
  const emptyState = document.getElementById('emptyState');

  document.getElementById('jobCount').textContent = `${totalJobs} jobov`;

  if (jobs.length === 0 && currentPage === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  container.innerHTML = `
    <table class="scenarios-table">
      <thead>
        <tr>
          <th>Job ID</th>
          <th>Status</th>
          <th>Scenárov</th>
          <th>Vytvorený</th>
          <th>Dokončený</th>
          <th>Akcie</th>
        </tr>
      </thead>
      <tbody>
        ${jobs.map(job => `
          <tr class="job-row" data-job-id="${escapeHtml(job.job_id)}">
            <td>
              <code class="job-id">${escapeHtml(job.job_id.slice(0, 8))}...</code>
            </td>
            <td>
              <span class="badge ${job.status}">${getStatusLabel(job.status)}</span>
            </td>
            <td>${job.scenario_count ?? '-'}</td>
            <td>${formatDateTime(job.created_at)}</td>
            <td>${job.completed_at ? formatDateTime(job.completed_at) : '-'}</td>
            <td>
              <button class="ghost small" data-action="detail" data-job-id="${escapeHtml(job.job_id)}">Detail</button>
              ${job.status !== 'processing' ? `
                <button class="ghost small danger" data-action="delete" data-job-id="${escapeHtml(job.job_id)}">Zmazať</button>
              ` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function updatePagination() {
  const pagination = document.getElementById('pagination');
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  const pageInfo = document.getElementById('pageInfo');

  const totalPages = Math.ceil(totalJobs / PAGE_SIZE);

  if (totalPages <= 1) {
    pagination.style.display = 'none';
    return;
  }

  pagination.style.display = 'flex';
  prevBtn.disabled = currentPage === 0;
  nextBtn.disabled = (currentPage + 1) >= totalPages;
  pageInfo.textContent = `Strana ${currentPage + 1} z ${totalPages}`;
}

async function handleJobClick(e) {
  const button = e.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const jobId = button.dataset.jobId;

  if (action === 'detail') {
    await showJobDetail(jobId);
  } else if (action === 'delete') {
    await deleteJob(jobId);
  }
}

async function showJobDetail(jobId) {
  try {
    const response = await fetch(`/api/jobs/${jobId}`);
    if (!response.ok) throw new Error('Nepodarilo sa načítať detail jobu');

    const job = await response.json();
    renderJobDetail(job);
    openJobDetailModal(job);
  } catch (error) {
    console.error('Chyba pri načítavaní detailu jobu:', error);
    alert('Nepodarilo sa načítať detail jobu');
  }
}

function renderJobDetail(job) {
  const container = document.getElementById('jobDetailContent');
  const deleteBtn = document.getElementById('deleteJobBtn');

  deleteBtn.style.display = job.status !== 'processing' ? 'inline-block' : 'none';
  deleteBtn.onclick = () => deleteJob(job.job_id);

  const scenarioCount = job.results?.total_scenarios ?? 0;
  const validatedCount = job.results?.validated_scenarios ?? 0;
  const needsReviewCount = job.results?.needs_review_scenarios ?? 0;

  container.innerHTML = `
    <div class="job-detail">
      <div class="detail-section">
        <h4>Základné informácie</h4>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">Job ID</span>
            <span class="detail-value"><code>${escapeHtml(job.job_id)}</code></span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Status</span>
            <span class="detail-value"><span class="badge ${job.status}">${getStatusLabel(job.status)}</span></span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Vytvorený</span>
            <span class="detail-value">${formatDateTime(job.created_at)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Dokončený</span>
            <span class="detail-value">${job.completed_at ? formatDateTime(job.completed_at) : '-'}</span>
          </div>
        </div>
      </div>

      ${job.input ? `
        <div class="detail-section">
          <h4>Vstup</h4>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">Názov</span>
              <span class="detail-value">${escapeHtml(job.input.title || '-')}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Popis</span>
              <span class="detail-value">${escapeHtml(job.input.description || '-')}</span>
            </div>
            ${job.input.metadata?.parent_jira_issue_id ? `
              <div class="detail-item">
                <span class="detail-label">Parent Jira Issue</span>
                <span class="detail-value">${escapeHtml(job.input.metadata.parent_jira_issue_id)}</span>
              </div>
            ` : ''}
          </div>
        </div>
      ` : ''}

      ${job.component_id || job.project_id || job.page_id ? `
        <div class="detail-section">
          <h4>Hierarchia</h4>
          <div class="detail-grid">
            ${job.project_id ? `
              <div class="detail-item">
                <span class="detail-label">Projekt</span>
                <span class="detail-value"><a href="/project/${escapeHtml(job.project_id)}">${escapeHtml(job.project_id.slice(0, 8))}...</a></span>
              </div>
            ` : ''}
            ${job.component_id ? `
              <div class="detail-item">
                <span class="detail-label">Komponent</span>
                <span class="detail-value"><a href="/component/${escapeHtml(job.component_id)}">${escapeHtml(job.component_id.slice(0, 8))}...</a></span>
              </div>
            ` : ''}
            ${job.page_id ? `
              <div class="detail-item">
                <span class="detail-label">Stránka</span>
                <span class="detail-value"><a href="/page/${escapeHtml(job.page_id)}">${escapeHtml(job.page_id.slice(0, 8))}...</a></span>
              </div>
            ` : ''}
          </div>
        </div>
      ` : ''}

      ${job.results ? `
        <div class="detail-section">
          <h4>Výsledky</h4>
          <div class="stats-row compact">
            <div class="stat-box">
              <div class="stat-value">${scenarioCount}</div>
              <div class="stat-label">Celkom scenárov</div>
            </div>
            <div class="stat-box">
              <div class="stat-value validated">${validatedCount}</div>
              <div class="stat-label">Validovaných</div>
            </div>
            <div class="stat-box">
              <div class="stat-value needs-review">${needsReviewCount}</div>
              <div class="stat-label">Na review</div>
            </div>
          </div>
        </div>
      ` : ''}

      ${job.error ? `
        <div class="detail-section error">
          <h4>Chyba</h4>
          <pre class="error-message">${escapeHtml(job.error)}</pre>
        </div>
      ` : ''}
    </div>
  `;
}

function openJobDetailModal(job) {
  document.getElementById('jobDetailModal').classList.add('active');
}

function closeJobDetailModal() {
  document.getElementById('jobDetailModal').classList.remove('active');
}

async function deleteJob(jobId) {
  if (!confirm('Naozaj chcete zmazať tento job? Táto akcia sa nedá vrátiť späť.')) {
    return;
  }

  try {
    const response = await fetch(`/api/jobs/${jobId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Nepodarilo sa zmazať job');
    }

    closeJobDetailModal();
    loadJobs();
  } catch (error) {
    console.error('Chyba pri mazaní jobu:', error);
    alert('Nepodarilo sa zmazať job: ' + error.message);
  }
}

function startPolling() {
  // Poll every 10 seconds for updates
  pollingInterval = setInterval(() => {
    // Only refresh if there are processing jobs
    const processingCount = parseInt(document.getElementById('processingJobs').textContent, 10);
    if (processingCount > 0) {
      loadJobs();
    }
  }, 10000);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

function getStatusLabel(status) {
  switch (status) {
    case 'processing': return 'Spracováva sa';
    case 'completed': return 'Dokončené';
    case 'failed': return 'Zlyhalo';
    default: return status;
  }
}

function formatDateTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleString('sk-SK');
}

function showError(message) {
  const container = document.getElementById('jobsContainer');
  container.innerHTML = `
    <div class="empty-state">
      <h3>Chyba</h3>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="primary" onclick="loadJobs()">Skúsiť znova</button>
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
window.addEventListener('beforeunload', stopPolling);
