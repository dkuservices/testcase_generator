// Sidebar Tree Component

const MOBILE_BREAKPOINT = 900;

document.addEventListener('DOMContentLoaded', () => {
  loadHierarchy();
  setupSidebarToggle();
});

function setupSidebarToggle() {
  const toggleButton = document.getElementById('mobileMenuToggle');
  const sidebar = document.getElementById('sidebar') || document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');

  if (!toggleButton || !sidebar || !backdrop) return;

  const closeSidebar = () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('active');
    toggleButton.setAttribute('aria-expanded', 'false');
    toggleButton.setAttribute('aria-label', 'Otvoriť navigáciu');
  };

  const openSidebar = () => {
    sidebar.classList.add('open');
    backdrop.classList.add('active');
    toggleButton.setAttribute('aria-expanded', 'true');
    toggleButton.setAttribute('aria-label', 'Zavrieť navigáciu');
  };

  toggleButton.addEventListener('click', () => {
    if (sidebar.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  backdrop.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeSidebar();
    }
  });

  const sidebarTree = document.getElementById('sidebarTree');
  if (sidebarTree) {
    sidebarTree.addEventListener('click', (event) => {
      if (window.innerWidth > MOBILE_BREAKPOINT) return;
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('a')) {
        closeSidebar();
      }
    });
  }

  window.addEventListener('resize', () => {
    if (window.innerWidth > MOBILE_BREAKPOINT) {
      closeSidebar();
    }
  });
}

async function loadHierarchy() {
  const sidebarTree = document.getElementById('sidebarTree');
  if (!sidebarTree) return;

  try {
    const response = await fetch('/api/hierarchy');
    if (!response.ok) throw new Error('Nepodarilo sa načítať hierarchiu');

    const data = await response.json();
    renderTree(sidebarTree, data.hierarchy);
    highlightCurrentNode();
  } catch (error) {
    console.error('Error loading hierarchy:', error);
    sidebarTree.innerHTML = '<div class="sidebar-empty">Nepodarilo sa načítať hierarchiu</div>';
  }
}

function renderTree(container, nodes) {
  if (!nodes || nodes.length === 0) {
    container.innerHTML = `
      <div class="sidebar-empty">
        <p>Žiadne projekty</p>
        <a href="/projects">Vytvoriť projekt</a>
      </div>
    `;
    return;
  }

  container.innerHTML = nodes.map(node => renderNode(node)).join('');

  container.querySelectorAll('.tree-toggle').forEach(toggle => {
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleNode(event.target.closest('.tree-node'));
    });

    toggle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleNode(event.target.closest('.tree-node'));
      }
    });
  });
}

function renderNode(node) {
  const hasChildren = node.children && node.children.length > 0;
  const href = getNodeHref(node);
  const icon = getNodeIcon(node.type);
  const count = hasChildren ? node.children.length : null;
  const toggleMarkup = hasChildren
    ? '<span class="tree-toggle" role="button" tabindex="0" aria-expanded="false">&#9654;</span>'
    : '<span class="tree-toggle placeholder" aria-hidden="true">&#9654;</span>';

  return `
    <div class="tree-node" data-id="${node.id}" data-type="${node.type}">
      <a href="${href}" class="tree-node-header">
        ${toggleMarkup}
        <span class="tree-icon ${node.type}">${icon}</span>
        <span class="tree-label">${escapeHtml(node.name)}</span>
        ${count !== null ? `<span class="tree-count">${count}</span>` : ''}
      </a>
      ${hasChildren ? `
        <div class="tree-children">
          ${node.children.map(child => renderNode(child)).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function getNodeHref(node) {
  switch (node.type) {
    case 'project': return `/project/${node.id}`;
    case 'component': return `/component/${node.id}`;
    case 'page': return `/page/${node.id}`;
    default: return '#';
  }
}

function getNodeIcon(type) {
  switch (type) {
    case 'project': return '&#128193;';
    case 'component': return '&#128230;';
    case 'page': return '&#128196;';
    default: return '&#128196;';
  }
}

function toggleNode(nodeElement) {
  if (!nodeElement) return;
  const toggle = nodeElement.querySelector('.tree-toggle');
  const children = nodeElement.querySelector('.tree-children');

  if (children && toggle) {
    const isExpanded = children.classList.toggle('expanded');
    toggle.classList.toggle('expanded', isExpanded);
    toggle.setAttribute('aria-expanded', String(isExpanded));
  }
}

function highlightCurrentNode() {
  const path = window.location.pathname;
  const match = path.match(/\/(project|component|page)\/([^/]+)/);

  if (match) {
    const [, , id] = match;
    const node = document.querySelector(`.tree-node[data-id="${id}"]`);

    if (node) {
      node.querySelector('.tree-node-header').classList.add('active');

      let parent = node.parentElement;
      while (parent) {
        if (parent.classList.contains('tree-children')) {
          parent.classList.add('expanded');
          const parentNode = parent.closest('.tree-node');
          if (parentNode) {
            const toggle = parentNode.querySelector('.tree-toggle');
            toggle?.classList.add('expanded');
            toggle?.setAttribute('aria-expanded', 'true');
          }
        }
        parent = parent.parentElement;
      }
    }
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.sidebarRefresh = loadHierarchy;
