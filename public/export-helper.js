// Shared export modal logic for Page and Component pages.
// Requires: an #exportModal element in the HTML and a getExportScenarios() function.

function initExportModal(getScenariosFn, getTitleFn) {
  const exportBtn = document.getElementById('exportBtn');
  const exportModal = document.getElementById('exportModal');
  const exportForm = document.getElementById('exportForm');
  const closeExportModal = document.getElementById('closeExportModal');
  const cancelExport = document.getElementById('cancelExport');
  const downloadExport = document.getElementById('downloadExport');

  if (!exportBtn || !exportModal) return;

  let selectedFormat = 'excel';

  function openModal() {
    exportModal.classList.add('active');
  }

  function closeModal() {
    exportModal.classList.remove('active');
  }

  exportBtn.addEventListener('click', openModal);
  closeExportModal.addEventListener('click', closeModal);
  cancelExport.addEventListener('click', closeModal);
  exportModal.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeModal();
  });

  document.querySelectorAll('.export-format-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.export-format-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedFormat = btn.dataset.format;
    });
  });

  exportForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const checkboxes = document.querySelectorAll('input[name="exportStatus"]:checked');
    const statuses = Array.from(checkboxes).map(cb => cb.value);

    if (statuses.length === 0) {
      window.alert('Vyberte aspon jeden status na export.');
      return;
    }

    const scenarios = getScenariosFn();
    const filtered = scenarios.filter(s => statuses.includes(s.validation_status));

    if (filtered.length === 0) {
      window.alert('Ziadne scenare so zvolenym statusom.');
      return;
    }

    downloadExport.disabled = true;
    downloadExport.textContent = 'Generujem...';

    try {
      const response = await fetch(`/api/export/${selectedFormat}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarios: filtered,
          title: getTitleFn ? getTitleFn() : '',
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || error.error || 'Export zlyhal');
      }

      const blob = await response.blob();
      const ext = selectedFormat === 'excel' ? 'xlsx' : 'pdf';
      const filename = `test-scenarios-${new Date().toISOString().slice(0, 10)}.${ext}`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);

      closeModal();
    } catch (error) {
      window.alert(error.message || 'Export zlyhal');
    } finally {
      downloadExport.disabled = false;
      downloadExport.textContent = 'Stiahnuť';
    }
  });
}
