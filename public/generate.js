const elements = {
  form: document.getElementById('generateForm'),
  linkInput: document.getElementById('linkInput'),
  submitButton: document.getElementById('submitButton'),
  resetButton: document.getElementById('resetButton'),
  statusPanel: document.getElementById('statusPanel'),
  statusMessage: document.getElementById('statusMessage'),
  statusMeta: document.getElementById('statusMeta'),
};

function clearStatus() {
  elements.statusPanel.classList.remove('loading', 'success', 'error');
  elements.statusMeta.innerHTML = '';
}

function setStatus(type, message, metaItems) {
  clearStatus();
  if (type) {
    elements.statusPanel.classList.add(type);
  }
  elements.statusMessage.textContent = message;
  if (Array.isArray(metaItems)) {
    metaItems.forEach(item => {
      const span = document.createElement('span');
      if (item.href) {
        const link = document.createElement('a');
        link.href = item.href;
        link.textContent = item.label;
        span.appendChild(link);
      } else {
        span.textContent = item.label;
      }
      elements.statusMeta.appendChild(span);
    });
  }
}

elements.form.addEventListener('submit', async event => {
  event.preventDefault();
  const link = elements.linkInput.value.trim();
  if (!link) {
    setStatus('error', 'Please provide a Confluence page link.');
    return;
  }

  elements.submitButton.disabled = true;
  setStatus('loading', 'Starting generation...');

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = payload.message || 'Failed to start generation.';
      setStatus('error', message);
      return;
    }

    const jobId = payload.job_id || payload.jobId;
    setStatus(
      'success',
      'Generation started.',
      [
        { label: jobId ? `Job: ${jobId}` : 'Job created' },
        jobId ? { label: 'Track status', href: `/api/status/${jobId}` } : null,
        { label: 'Open review desk', href: '/review' },
      ].filter(Boolean)
    );
  } catch (error) {
    setStatus('error', error.message || 'Request failed.');
  } finally {
    elements.submitButton.disabled = false;
  }
});

elements.resetButton.addEventListener('click', () => {
  elements.linkInput.value = '';
  setStatus('', 'Paste a link to begin.');
});
