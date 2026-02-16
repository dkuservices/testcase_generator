/**
 * Documents Page - Wizard Workflow
 * 1. Upload files
 * 2. Name the project
 * 3. Add manual/handbook
 * 4. Generate tests
 */

// State
let selectedFiles = [];
let currentStep = 1;
let createdProjectId = null;
let documentIds = [];
let manualData = {
  text: '',
  file: null,
  filename: ''
};
let isProcessingDocuments = false; // Track if document processing is in progress

// DOM Elements
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const selectedFilesSection = document.getElementById('selectedFilesSection');
const fileList = document.getElementById('fileList');
const fileCount = document.getElementById('fileCount');
const clearFilesBtn = document.getElementById('clearFilesBtn');
const toStep2Btn = document.getElementById('toStep2Btn');

const step2FileList = document.getElementById('step2FileList');
const step2FileCount = document.getElementById('step2FileCount');
const projectNameInput = document.getElementById('projectName');
const backToStep1Btn = document.getElementById('backToStep1Btn');
const startProcessingBtn = document.getElementById('startProcessingBtn');

// Manual upload elements
const manualTextWizard = document.getElementById('manualTextWizard');
const manualFileWizard = document.getElementById('manualFileWizard');
const textManualInputWizard = document.getElementById('textManualInputWizard');
const fileManualInputWizard = document.getElementById('fileManualInputWizard');
const currentManualDisplayWizard = document.getElementById('currentManualDisplayWizard');
const manualContentWizard = document.getElementById('manualContentWizard');
const manualMetaWizard = document.getElementById('manualMetaWizard');
const uploadManualFormWizard = document.getElementById('uploadManualFormWizard');
const backToStep2Btn = document.getElementById('backToStep2Btn');
const skipManualBtn = document.getElementById('skipManualBtn');
const continueToGenerationBtn = document.getElementById('continueToGenerationBtn');
const clearManualBtn = document.getElementById('clearManualBtn');

const processingTitle = document.getElementById('processingTitle');
const processingProgress = document.getElementById('processingProgress');
const processingStatus = document.getElementById('processingStatus');
const processingLog = document.getElementById('processingLog');
const step3Actions = document.getElementById('step3Actions');
const goToProjectBtn = document.getElementById('goToProjectBtn');

const refreshBtn = document.getElementById('refreshBtn');
const documentsContainer = document.getElementById('documentsContainer');
const emptyState = document.getElementById('emptyState');
const documentCount = document.getElementById('documentCount');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupUploadZone();
  setupWizardNavigation();
  loadExistingProjects();
});

function setupUploadZone() {
  uploadZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      addFiles(Array.from(e.target.files));
    }
  });

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  });

  clearFilesBtn.addEventListener('click', clearFiles);
}

function setupWizardNavigation() {
  toStep2Btn.addEventListener('click', () => goToStep(2));
  backToStep1Btn.addEventListener('click', () => goToStep(1));
  startProcessingBtn.addEventListener('click', startProcessing);

  // Step 3: Manual upload navigation
  if (backToStep2Btn) {
    backToStep2Btn.addEventListener('click', () => goToStep(2));
  }
  if (skipManualBtn) {
    skipManualBtn.addEventListener('click', skipManualAndGenerate);
  }
  if (continueToGenerationBtn) {
    continueToGenerationBtn.addEventListener('click', submitManualAndGenerate);
  }
  if (clearManualBtn) {
    clearManualBtn.addEventListener('click', clearManual);
  }

  // Manual type radio buttons
  const manualTypeRadios = document.querySelectorAll('input[name="manualTypeWizard"]');
  manualTypeRadios.forEach(radio => {
    radio.addEventListener('change', handleManualTypeChange);
  });

  // Manual file upload
  if (manualFileWizard) {
    manualFileWizard.addEventListener('change', handleManualFileUpload);
  }

  // Manual file upload zone click handler
  const manualFileUploadZone = document.getElementById('manualFileUploadZone');
  if (manualFileUploadZone && manualFileWizard) {
    manualFileUploadZone.addEventListener('click', (e) => {
      // Don't trigger if clicking on the input itself
      if (e.target !== manualFileWizard) {
        manualFileWizard.click();
      }
    });
  }

  // Manual text input
  if (manualTextWizard) {
    manualTextWizard.addEventListener('input', () => {
      manualData.text = manualTextWizard.value;
      manualData.file = null;
      manualData.filename = '';
    });
  }

  goToProjectBtn.addEventListener('click', () => {
    if (createdProjectId) {
      window.location.href = `/project/${createdProjectId}`;
    }
  });
  refreshBtn.addEventListener('click', loadExistingProjects);

  // Auto-suggest project name from first file
  projectNameInput.addEventListener('focus', () => {
    if (!projectNameInput.value && selectedFiles.length > 0) {
      const suggestedName = deriveProjectName(selectedFiles[0].name);
      projectNameInput.value = suggestedName;
      projectNameInput.select();
    }
  });
}

function addFiles(files) {
  const validFiles = files.filter(file => {
    const ext = file.name.split('.').pop().toLowerCase();
    return ext === 'docx' || ext === 'doc';
  });

  if (validFiles.length === 0) {
    showToast('Iba .docx a .doc súbory sú povolené', 'warning');
    return;
  }

  // Check for duplicates
  for (const file of validFiles) {
    if (!selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
      selectedFiles.push(file);
    }
  }

  if (selectedFiles.length > 20) {
    selectedFiles = selectedFiles.slice(0, 20);
    showToast('Maximum 20 súborov. Prebytočné boli odstránené.', 'warning');
  }

  renderFileList();
  fileInput.value = '';
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  renderFileList();
}

function clearFiles() {
  selectedFiles = [];
  renderFileList();
}

function renderFileList() {
  const hasFiles = selectedFiles.length > 0;
  selectedFilesSection.style.display = hasFiles ? 'block' : 'none';
  toStep2Btn.disabled = !hasFiles;
  fileCount.textContent = selectedFiles.length;

  fileList.innerHTML = selectedFiles.map((file, index) => `
    <div class="file-item">
      <div>
        <span class="file-item-name">${escapeHtml(file.name)}</span>
        <span class="file-item-size">${formatFileSize(file.size)}</span>
      </div>
      <button type="button" class="file-item-remove" onclick="removeFile(${index})">&times;</button>
    </div>
  `).join('');
}

function goToStep(step) {
  currentStep = step;

  // Update step indicators
  document.querySelectorAll('.wizard-step').forEach((el, i) => {
    const stepNum = i + 1;
    el.classList.remove('active', 'completed');
    if (stepNum < step) el.classList.add('completed');
    if (stepNum === step) el.classList.add('active');
  });

  document.querySelectorAll('.wizard-step-connector').forEach((el, i) => {
    el.classList.toggle('completed', i < step - 1);
  });

  // Show/hide panels
  document.querySelectorAll('.wizard-panel').forEach(panel => panel.classList.remove('active'));
  document.getElementById(`step${step}Panel`).classList.add('active');

  // Step-specific actions
  if (step === 2) {
    renderStep2FileList();
    // Auto-suggest project name
    if (!projectNameInput.value && selectedFiles.length > 0) {
      projectNameInput.value = deriveProjectName(selectedFiles[0].name);
    }
  } else if (step === 3) {
    // Update button states when entering step 3
    updateStep3ButtonsState();
  }
}

function renderStep2FileList() {
  step2FileCount.textContent = selectedFiles.length;
  step2FileList.innerHTML = selectedFiles.map(file => `
    <div class="file-item">
      <div>
        <span class="file-item-name">${escapeHtml(file.name)}</span>
        <span class="file-item-size">${formatFileSize(file.size)}</span>
      </div>
    </div>
  `).join('');
}

async function startProcessing() {
  const projectName = projectNameInput.value.trim();
  if (!projectName) {
    showToast('Zadajte názov projektu', 'warning');
    projectNameInput.focus();
    return;
  }

  if (selectedFiles.length === 0) {
    showToast('Nie sú vybrané žiadne súbory', 'warning');
    return;
  }

  goToStep(3);
  startProcessingBtn.disabled = true;
  isProcessingDocuments = true;
  updateStep3ButtonsState();

  // Reset processing UI
  processingProgress.style.width = '0%';
  processingLog.innerHTML = '';
  step3Actions.style.display = 'none';
  createdProjectId = null;

  try {
    addLogEntry('Zacinam spracovanie...', 'info');

    // Create FormData with files and project name
    const formData = new FormData();
    formData.append('projectName', projectName);
    selectedFiles.forEach(file => {
      formData.append('files', file);
    });

    addLogEntry(`Nahravanie ${selectedFiles.length} suborov...`, 'info');
    processingStatus.textContent = 'Nahravanie suborov...';
    processingProgress.style.width = '10%';

    // Call the new API endpoint
    const response = await fetch('/api/documents/create-project', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Nepodarilo sa vytvorit projekt');
    }

    const result = await response.json();
    createdProjectId = result.project_id;
    documentIds = result.document_ids;

    addLogEntry(`Projekt "${result.project_name}" vytvoreny`, 'success');
    processingProgress.style.width = '30%';

    // Poll for document processing status
    await pollDocumentProcessing(documentIds);

    // Transition documents to awaiting_manual
    addLogEntry('Pripravujem dokumenty pre pridanie prirucky...', 'info');
    await prepareManualUpload(documentIds);

    // Move to step 3 (manual upload)
    addLogEntry('Dokumenty pripravene', 'success');
    processingProgress.style.width = '100%';
    isProcessingDocuments = false;
    updateStep3ButtonsState();
    goToStep(3);

  } catch (error) {
    console.error('Processing error:', error);
    processingTitle.textContent = 'Chyba';
    processingStatus.textContent = error.message;
    addLogEntry(`Chyba: ${error.message}`, 'error');
    processingProgress.style.width = '0%';
    processingProgress.style.background = 'var(--danger)';
    isProcessingDocuments = false;
    updateStep3ButtonsState();
  }
}

// Update step 3 buttons state based on processing status
function updateStep3ButtonsState() {
  const shouldDisable = isProcessingDocuments || !documentIds || documentIds.length === 0;
  if (skipManualBtn) skipManualBtn.disabled = shouldDisable;
  if (continueToGenerationBtn) continueToGenerationBtn.disabled = shouldDisable;
  if (backToStep2Btn) backToStep2Btn.disabled = isProcessingDocuments;
}

async function pollDocumentProcessing(documentIds) {
  const maxAttempts = 360; // 30 minutes max (360 * 5s = 1800s)
  let attempts = 0;

  while (attempts < maxAttempts) {
    let allReady = true;
    let parsed = 0;

    for (const docId of documentIds) {
      try {
        const res = await fetch(`/api/documents/${docId}`);
        if (res.ok) {
          const doc = await res.json();
          if (doc.status === 'pages_detected' || doc.status === 'completed') {
            parsed++;
          } else if (doc.status === 'failed') {
            addLogEntry(`Dokument zlyhal: ${doc.filename}`, 'error');
            parsed++;
          } else {
            allReady = false;
          }
        }
      } catch (e) {
        // ignore
      }
    }

    const progress = 30 + (parsed / documentIds.length) * 30;
    processingProgress.style.width = `${progress}%`;
    processingStatus.textContent = `Spracovanych ${parsed}/${documentIds.length} dokumentov...`;

    if (allReady) {
      addLogEntry(`Vsetky dokumenty sparsovane (${parsed}/${documentIds.length})`, 'success');
      return;
    }

    await sleep(5000);
    attempts++;
  }

  throw new Error('Casovy limit vyprsany pri spracovani dokumentov');
}

async function pollGenerationStatus(documentIds) {
  const maxAttempts = 720; // 60 minutes max (720 * 5s = 3600s)
  let attempts = 0;

  while (attempts < maxAttempts) {
    let allDone = true;
    let completed = 0;
    let totalScenarios = 0;

    for (const docId of documentIds) {
      try {
        const res = await fetch(`/api/documents/${docId}`);
        if (res.ok) {
          const doc = await res.json();
          if (doc.status === 'completed') {
            completed++;
            if (doc.generation_result) {
              totalScenarios += doc.generation_result.total_scenarios;
            }
          } else if (doc.status === 'failed') {
            completed++;
          } else {
            // Any other status means document is still processing
            // (uploaded, parsing, pages_detected, generating, etc.)
            allDone = false;
          }
        }
      } catch (e) {
        // ignore
      }
    }

    const progress = 60 + (completed / documentIds.length) * 40;
    processingProgress.style.width = `${progress}%`;
    processingStatus.textContent = `Generujem testy... (${completed}/${documentIds.length} dokumentov, ${totalScenarios} scenariov)`;

    if (allDone) {
      addLogEntry(`Generovanie dokoncene: ${totalScenarios} scenariov`, 'success');
      return;
    }

    await sleep(5000);
    attempts++;
  }

  throw new Error('Casovy limit vyprsany pri generovani testov');
}

function addLogEntry(message, type = '') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  processingLog.appendChild(entry);
  processingLog.scrollTop = processingLog.scrollHeight;
}

async function loadExistingProjects() {
  try {
    // Load projects with source_type=document
    const response = await fetch('/api/projects');
    if (!response.ok) throw new Error('Nepodarilo sa nacitat projekty');

    const data = await response.json();

    // Filter to document-based projects only
    const docProjects = data.projects.filter(p => p.source_type === 'document');

    documentCount.textContent = `${docProjects.length} projektov`;

    if (docProjects.length === 0) {
      documentsContainer.innerHTML = '';
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';
    documentsContainer.innerHTML = docProjects.map(project => `
      <div class="document-card">
        <div class="document-header">
          <h3 class="document-title">${escapeHtml(project.name)}</h3>
          <span class="badge completed">Projekt</span>
        </div>
        <div class="document-meta">
          <span>${project.component_count} modulov</span>
          <span>${project.total_tests} testov</span>
          <span>Vytvorene: ${formatDateTime(project.created_at)}</span>
        </div>
        <div class="document-actions">
          <a href="/project/${escapeHtml(project.project_id)}" class="primary small" style="text-decoration: none;">Otvorit projekt</a>
        </div>
      </div>
    `).join('');

  } catch (error) {
    console.error('Error loading projects:', error);
    documentsContainer.innerHTML = `<p class="error">Nepodarilo sa nacitat projekty</p>`;
  }
}

// Utility functions
function deriveProjectName(filename) {
  let name = filename.replace(/\.(docx?|DOCX?)$/, '');
  name = name.replace(/[_-]+/g, ' ');
  name = name.charAt(0).toUpperCase() + name.slice(1);
  return name;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function prepareManualUpload(docIds) {
  console.log('[DEBUG] prepareManualUpload called with docIds:', docIds);

  for (const docId of docIds) {
    try {
      // Request manual mode for this document
      console.log('[DEBUG] Requesting manual mode for document:', docId);
      const response = await fetch(`/api/documents/${docId}/request-manual`, {
        method: 'POST',
      });

      console.log('[DEBUG] Request manual response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ERROR] Failed to request manual for document ${docId}:`, errorText);
        addLogEntry(`Chyba pri priprave dokumentu: ${errorText}`, 'error');
      }
    } catch (error) {
      console.error(`[ERROR] Failed to prepare manual for document ${docId}:`, error);
      addLogEntry(`Chyba pri priprave: ${error.message}`, 'error');
    }
  }
}

function handleManualTypeChange(e) {
  const selectedType = e.target.value;
  if (textManualInputWizard) {
    textManualInputWizard.style.display = selectedType === 'text' ? 'block' : 'none';
  }
  if (fileManualInputWizard) {
    fileManualInputWizard.style.display = selectedType === 'file' ? 'block' : 'none';
  }
}

function handleManualFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const ext = file.name.split('.').pop().toLowerCase();
  if (!['docx', 'pdf', 'txt'].includes(ext)) {
    showToast('Podporované sú iba docx, pdf a txt súbory', 'warning');
    e.target.value = '';
    return;
  }

  // Updated limit: 200MB for large manuals (will be chunked automatically)
  const maxSizeMB = 200;
  if (file.size > maxSizeMB * 1024 * 1024) {
    showToast(`Súbor je príliš veľký (max ${maxSizeMB} MB)`, 'warning');
    e.target.value = '';
    return;
  }

  manualData.file = file;
  manualData.filename = file.name;
  manualData.text = '';

  // Check if file is large (will be chunked)
  const fileSizeMB = file.size / (1024 * 1024);
  const willBeChunked = fileSizeMB > 10; // Files > 10MB will be chunked

  // Show uploaded file with size info
  const uploadedFilesList = document.getElementById('uploadedManualFileList');
  if (uploadedFilesList) {
    uploadedFilesList.innerHTML = `
      <div class="uploaded-file-item">
        <div>
          <span>📎 ${escapeHtml(file.name)}</span>
          <span class="file-size-badge">${formatFileSize(file.size)}</span>
        </div>
        <button type="button" onclick="removeManualFile()">×</button>
      </div>
      ${willBeChunked ? `
        <div class="chunking-notice">
          <span class="chunking-icon">📊</span>
          <span>Velky subor - bude automaticky rozdeleny na sekcie pre efektivne spracovanie.</span>
          <span>Pri generovani sa pouziju iba relevantne casti.</span>
        </div>
      ` : ''}
    `;
  }
}

function removeManualFile() {
  manualData.file = null;
  manualData.filename = '';
  if (manualFileWizard) manualFileWizard.value = '';
  const uploadedFilesList = document.getElementById('uploadedManualFileList');
  if (uploadedFilesList) uploadedFilesList.innerHTML = '';
}

function clearManual() {
  manualData = { text: '', file: null, filename: '' };
  if (manualTextWizard) manualTextWizard.value = '';
  if (manualFileWizard) manualFileWizard.value = '';
  const uploadedFilesList = document.getElementById('uploadedManualFileList');
  if (uploadedFilesList) uploadedFilesList.innerHTML = '';
  if (currentManualDisplayWizard) currentManualDisplayWizard.style.display = 'none';
  if (uploadManualFormWizard) uploadManualFormWizard.style.display = 'block';
}

function displayManualPreview() {
  if (!currentManualDisplayWizard || !manualContentWizard || !manualMetaWizard) return;

  const text = manualData.text || '';
  if (!text && !manualData.file) {
    currentManualDisplayWizard.style.display = 'none';
    return;
  }

  currentManualDisplayWizard.style.display = 'block';

  if (text) {
    const truncated = text.length > 500 ? text.substring(0, 500) + '...' : text;
    manualContentWizard.textContent = truncated;
    manualMetaWizard.textContent = `Dlzka: ${text.length} znakov`;
  } else if (manualData.file) {
    manualContentWizard.textContent = `Subor: ${manualData.filename}`;
    manualMetaWizard.textContent = `Velkost: ${formatFileSize(manualData.file.size)}`;
  }
}

async function skipManualAndGenerate() {
  // Disable buttons to prevent double-click
  if (skipManualBtn) skipManualBtn.disabled = true;
  if (continueToGenerationBtn) continueToGenerationBtn.disabled = true;

  goToStep(4);
  await startTestGeneration();
}

async function submitManualAndGenerate() {
  // Disable buttons to prevent double-click
  if (skipManualBtn) skipManualBtn.disabled = true;
  if (continueToGenerationBtn) continueToGenerationBtn.disabled = true;

  // Get manual text from textarea if not already set
  if (!manualData.text && manualTextWizard) {
    manualData.text = manualTextWizard.value.trim();
  }

  // Check if we have manual to upload
  const hasManual = manualData.text || manualData.file;

  if (hasManual) {
    try {
      // Upload manual to each document
      for (const docId of documentIds) {
        if (manualData.file) {
          // Upload file
          const formData = new FormData();
          formData.append('file', manualData.file);

          addLogEntry(`Nahravanie prirucky pre dokument...`, 'info');

          const response = await fetch(`/api/documents/${docId}/manual/file`, {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            console.error(`Failed to upload manual file for ${docId}:`, error);
            addLogEntry(`Chyba: ${error.error || 'Nepodarilo sa nahrat prirucku'}`, 'error');
          } else {
            const result = await response.json();
            if (result.is_chunked) {
              addLogEntry(`Prirucka nahrana a rozdelena na ${result.chunking_info.total_chunks} sekcii (~${Math.round(result.chunking_info.total_tokens / 1000)}k tokenov)`, 'success');
            } else {
              addLogEntry(`Prirucka nahrana (${Math.round(result.text_length / 1000)}k znakov)`, 'success');
            }
          }
        } else if (manualData.text) {
          // Upload text
          const response = await fetch(`/api/documents/${docId}/manual/text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ manual_text: manualData.text }),
          });

          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            console.error(`Failed to upload manual text for ${docId}:`, error);
          } else {
            addLogEntry(`Prirucka nahrana pre dokument ${docId}`, 'success');
          }
        }
      }
    } catch (error) {
      console.error('Failed to upload manual:', error);
      addLogEntry(`Chyba pri nahravani prirucky: ${error.message}`, 'error');
    }
  }

  goToStep(4);
  await startTestGeneration();
}

async function startTestGeneration() {
  processingTitle.textContent = 'Generujem testy...';
  processingProgress.style.width = '0%';
  processingStatus.textContent = 'Spustam generovanie...';
  processingLog.innerHTML = '';
  step3Actions.style.display = 'none';

  // Check if documentIds are available
  if (!documentIds || documentIds.length === 0) {
    addLogEntry('Chyba: Dokumenty este neboli spracovane. Pockajte na dokoncenie uploadu.', 'error');
    processingTitle.textContent = 'Chyba';
    processingStatus.textContent = 'Dokumenty este neboli spracovane';
    // Re-enable buttons
    if (skipManualBtn) skipManualBtn.disabled = false;
    if (continueToGenerationBtn) continueToGenerationBtn.disabled = false;
    return;
  }

  try {
    addLogEntry('Spustam generovanie testov...', 'info');
    processingProgress.style.width = '10%';

    const generateResponse = await fetch('/api/documents/generate-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_ids: documentIds }),
    });

    if (!generateResponse.ok) {
      const error = await generateResponse.json().catch(() => ({}));
      throw new Error(error.error || 'Nepodarilo sa spustit generovanie');
    }

    const genResult = await generateResponse.json();
    addLogEntry(`Generovanie spustene pre ${genResult.total_documents} dokumentov`, 'info');
    processingProgress.style.width = '30%';

    // Poll for generation completion
    await pollGenerationStatus(documentIds);

    // Done
    processingProgress.style.width = '100%';
    processingTitle.textContent = 'Hotovo!';
    processingStatus.textContent = 'Projekt bol uspesne vytvoreny a testy vygenerovane.';
    addLogEntry('Vsetky testy boli vygenerovane!', 'success');

    step3Actions.style.display = 'flex';

    // Refresh sidebar
    if (window.sidebarRefresh) {
      window.sidebarRefresh();
    }

    // Load existing projects
    loadExistingProjects();

  } catch (error) {
    console.error('Generation error:', error);
    processingTitle.textContent = 'Chyba';
    processingStatus.textContent = error.message;
    addLogEntry(`Chyba: ${error.message}`, 'error');
    processingProgress.style.width = '0%';
    processingProgress.style.background = 'var(--danger)';
    // Re-enable buttons on error
    if (skipManualBtn) skipManualBtn.disabled = false;
    if (continueToGenerationBtn) continueToGenerationBtn.disabled = false;
  }
}

function formatDateTime(dateString) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleString('sk-SK');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Make functions available globally
window.removeFile = removeFile;
window.removeManualFile = removeManualFile;
window.clearManual = clearManual;
