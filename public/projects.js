// Projects Dashboard JavaScript

document.addEventListener('DOMContentLoaded', () => {
  loadProjects();
  setupEventListeners();
});

function setupEventListeners() {
  // Create project buttons
  document.getElementById('createProjectBtn').addEventListener('click', openCreateModal);
  document.getElementById('createProjectEmptyBtn')?.addEventListener('click', openCreateModal);
  document.getElementById('cancelCreateBtn').addEventListener('click', closeCreateModal);

  // Modal overlay click to close
  document.getElementById('createModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      closeCreateModal();
    }
  });

  // Create project form
  document.getElementById('createProjectForm').addEventListener('submit', handleCreateProject);
}

async function loadProjects() {
  const grid = document.getElementById('projectsGrid');
  grid.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const response = await fetch('/api/projects');
    if (!response.ok) throw new Error('Failed to load projects');

    const data = await response.json();
    renderProjects(data.projects);
    updateStats(data);
  } catch (error) {
    console.error('Error loading projects:', error);
    showError('Failed to load projects');
  }
}

function renderProjects(projects) {
  const grid = document.getElementById('projectsGrid');
  const emptyState = document.getElementById('emptyState');
  const projectCount = document.getElementById('projectCount');

  projectCount.textContent = `${projects.length} projektov`;

  if (projects.length === 0) {
    grid.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  grid.style.display = 'grid';
  emptyState.style.display = 'none';

  grid.innerHTML = projects.map(project => `
    <a href="/project/${project.project_id}" class="item-card">
      <h3>${escapeHtml(project.name)}</h3>
      <p>${escapeHtml(project.description || 'Bez popisu')}</p>
      <div class="item-card-meta">
        <span>${project.component_count || 0} komponentov</span>
        <span>${project.total_pages || 0} stránok</span>
        <span>${project.total_tests || 0} testov</span>
      </div>
    </a>
  `).join('');
}

function updateStats(data) {
  document.getElementById('totalProjects').textContent = data.total || 0;

  // Calculate totals from projects
  let totalComponents = 0;
  let totalPages = 0;
  let totalTests = 0;

  if (data.projects) {
    data.projects.forEach(p => {
      totalComponents += p.component_count || 0;
      totalPages += p.total_pages || 0;
      totalTests += p.total_tests || 0;
    });
  }

  document.getElementById('totalComponents').textContent = totalComponents;
  document.getElementById('totalPages').textContent = totalPages;
  document.getElementById('totalTests').textContent = totalTests;
}

function openCreateModal() {
  document.getElementById('createModal').classList.add('active');
  document.getElementById('projectName').focus();
}

function closeCreateModal() {
  document.getElementById('createModal').classList.remove('active');
  document.getElementById('createProjectForm').reset();
}

async function handleCreateProject(e) {
  e.preventDefault();

  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Vytváram...';

    const name = document.getElementById('projectName').value.trim();
    const description = document.getElementById('projectDescription').value.trim();

    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: description || undefined }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create project');
    }

    const project = await response.json();
    closeCreateModal();

    // Redirect to the new project
    window.location.href = `/project/${project.project_id}`;
  } catch (error) {
    console.error('Error creating project:', error);
    showToast('Nepodarilo sa vytvoriť projekt: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

function showError(message) {
  const grid = document.getElementById('projectsGrid');
  grid.innerHTML = `
    <div class="empty-state">
      <h3>Chyba</h3>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="primary" onclick="loadProjects()">Skúsiť znova</button>
    </div>
  `;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
