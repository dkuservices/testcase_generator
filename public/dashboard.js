// Dashboard Page JavaScript

document.addEventListener('DOMContentLoaded', loadDashboard);

async function loadDashboard() {
  try {
    const response = await fetch('/api/dashboard/stats');
    if (!response.ok) throw new Error('Nepodarilo sa načítať štatistiky');

    const data = await response.json();
    renderStats(data.stats);
    renderRecentJobs(data.recent_jobs);
  } catch (error) {
    console.error('Chyba pri načítavaní dashboardu:', error);
    document.getElementById('recentJobsContainer').innerHTML = '';
  }
}

function renderStats(stats) {
  document.getElementById('totalProjects').textContent = stats.total_projects || 0;
  document.getElementById('totalComponents').textContent = stats.total_components || 0;
  document.getElementById('totalPages').textContent = stats.total_pages || 0;
  document.getElementById('totalTests').textContent = stats.total_tests || 0;
}

function renderRecentJobs(jobs) {
  const container = document.getElementById('recentJobsContainer');
  const empty = document.getElementById('noRecentJobs');

  if (!jobs || jobs.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  container.innerHTML = `
    <table class="scenarios-table">
      <thead>
        <tr>
          <th>Job ID</th>
          <th>Status</th>
          <th>Scenárov</th>
          <th>Vytvorený</th>
        </tr>
      </thead>
      <tbody>
        ${jobs.map(job => `
          <tr>
            <td><a href="/jobs"><code>${escapeHtml(job.job_id.slice(0, 8))}...</code></a></td>
            <td><span class="badge ${job.status}">${getStatusLabel(job.status)}</span></td>
            <td>${job.scenario_count ?? '-'}</td>
            <td>${formatDateTime(job.created_at)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function getStatusLabel(status) {
  switch (status) {
    case 'processing': return 'Spracováva sa';
    case 'completed': return 'Dokončené';
    case 'failed': return 'Zlyhalo';
    case 'cancelled': return 'Zrušené';
    default: return status;
  }
}

function formatDateTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleString('sk-SK');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
