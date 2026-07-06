import { api, uploadFile, fmtSize, fmtDate } from '../api.ts';
import type { FileEntry } from '../api.ts';
import { iconTrash, iconEdit, iconUpload, iconClipboard, iconZap, iconFile, iconCheck, iconX } from '../icons.ts';

let filesData: FileEntry[] = [];
let mainContainer: HTMLElement | null = null;
let uploadsInProgress = 0;

export function cleanupFiles() {
  // Don't null mainContainer — preserve DOM to avoid flicker on revisit
}

export async function renderFiles(container: HTMLElement) {
  mainContainer = container;

  if (!container.querySelector('#files-tbody')) {
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Files</h1>
          <p class="page-subtitle">Manage .nzb files on server</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-danger" id="clear-all-btn">${iconTrash()} Clear All</button>
        </div>
      </div>
      
      <div class="drop-zone" id="drop-zone">
        ${iconUpload()}
        <div class="drop-zone-text">
          <strong>Choose files</strong> or drag them here
        </div>
        <input type="file" id="file-input" multiple accept=".nzb" style="display:none">
      </div>

      <div id="upload-queue"></div>

      <div class="card" style="padding:0">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th style="width:100px">Size</th>
                <th style="width:120px">Date</th>
                <th style="width:140px">Actions</th>
              </tr>
            </thead>
            <tbody id="files-tbody"></tbody>
          </table>
        </div>
      </div>
      <div id="files-empty" style="display:none"></div>
    `;
    attachEvents();
  }

  await loadData();
}

async function loadData() {
  if (!mainContainer) return;
  try {
    filesData = await api.files();
    renderTable();
  } catch (err: any) {
    (window as any).showToast(err.message || 'Failed to load files', 'error');
  }
}

function renderTable() {
  if (!mainContainer) return;
  
  const tbody = mainContainer.querySelector('#files-tbody');
  const empty = mainContainer.querySelector('#files-empty') as HTMLElement;
  const tableWrap = mainContainer.querySelector('.table-wrap') as HTMLElement;

  if (!tbody || !empty || !tableWrap) return;

  if (filesData.length === 0) {
    tableWrap.style.display = 'none';
    empty.style.display = 'block';
    empty.innerHTML = `
      <div class="empty">
        ${iconFile()}
        <p>No files on server.</p>
      </div>
    `;
    return;
  }

  tableWrap.style.display = 'block';
  empty.style.display = 'none';

  tbody.innerHTML = filesData.map(f => `
    <tr data-name="${f.name}">
      <td>
        <div class="cell-name filename-display">${f.name}</div>
        <div class="filename-edit" style="display:none;align-items:center;gap:6px">
          <input type="text" class="inline-rename" value="${f.name}">
          <button class="btn-icon btn-rename-save" style="color:var(--success)">${iconCheck()}</button>
          <button class="btn-icon btn-rename-cancel">${iconX()}</button>
        </div>
      </td>
      <td class="cell-mono">${fmtSize(f.size)}</td>
      <td class="cell-mono">${fmtDate(f.mtime)}</td>
      <td>
        <div class="cell-actions action-buttons">
          <button class="btn-icon btn-rename" title="Rename">${iconEdit()}</button>
          <button class="btn-icon btn-magic" title="Upload to MagicNZB">${iconZap()}</button>
          <button class="btn-icon btn-log" title="Send to Telegram Log">${iconClipboard()}</button>
          <button class="btn-icon btn-delete" title="Delete">${iconTrash()}</button>
        </div>
        <div class="action-loading" style="display:none;justify-content:flex-end;padding-right:12px">
          <div class="spinner spinner-sm"></div>
        </div>
      </td>
    </tr>
  `).join('');
}

function attachEvents() {
  if (!mainContainer) return;

  // Clear All
  mainContainer.querySelector('#clear-all-btn')?.addEventListener('click', async () => {
    if (confirm('Delete ALL files on server?')) {
      try {
        await api.clearFiles();
        (window as any).showToast('All files cleared', 'success');
        loadData();
      } catch (err: any) {
        (window as any).showToast(err.message, 'error');
      }
    }
  });

  // Drag and Drop
  const dropZone = mainContainer.querySelector('#drop-zone') as HTMLElement;
  const fileInput = mainContainer.querySelector('#file-input') as HTMLInputElement;

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer?.files) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (fileInput.files) {
      handleFiles(Array.from(fileInput.files));
      fileInput.value = ''; // reset
    }
  });

  // Table actions
  mainContainer.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const tr = target.closest('tr');
    if (!tr) return;
    const name = tr.getAttribute('data-name');
    if (!name) return;

    // Delete
    if (target.closest('.btn-delete')) {
      if (confirm(`Delete ${name}?`)) {
        try {
          await api.deleteFile(name);
          loadData();
        } catch (err: any) {
          (window as any).showToast(err.message, 'error');
        }
      }
      return;
    }

    // Rename toggle
    if (target.closest('.btn-rename')) {
      (tr.querySelector('.filename-display') as HTMLElement)!.style.display = 'none';
      const editDiv = tr.querySelector('.filename-edit') as HTMLElement;
      editDiv.style.display = 'flex';
      const input = editDiv.querySelector('input')!;
      input.focus();
      // place cursor before .nzb
      const dotIdx = input.value.lastIndexOf('.');
      if (dotIdx > 0) input.setSelectionRange(0, dotIdx);
      else input.select();
      return;
    }

    // Rename cancel
    if (target.closest('.btn-rename-cancel')) {
      (tr.querySelector('.filename-display') as HTMLElement)!.style.display = 'block';
      (tr.querySelector('.filename-edit') as HTMLElement)!.style.display = 'none';
      return;
    }

    // Rename save
    if (target.closest('.btn-rename-save')) {
      await saveRename(tr, name);
      return;
    }

    // Upload Magic
    if (target.closest('.btn-magic')) {
      await performRowAction(tr, name, 'magic');
      return;
    }

    // Upload Log
    if (target.closest('.btn-log')) {
      await performRowAction(tr, name, 'log');
      return;
    }
  });

  // Handle Enter/Esc in rename input
  mainContainer.addEventListener('keydown', async (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('inline-rename')) {
      const tr = target.closest('tr');
      if (!tr) return;
      if (e.key === 'Enter') {
        await saveRename(tr, tr.getAttribute('data-name')!);
      } else if (e.key === 'Escape') {
        tr.querySelector('.btn-rename-cancel')!.dispatchEvent(new Event('click', { bubbles: true }));
      }
    }
  });
}

async function saveRename(tr: HTMLElement, oldName: string) {
  const input = tr.querySelector('.inline-rename') as HTMLInputElement;
  const newName = input.value.trim();
  if (!newName || newName === oldName) {
    tr.querySelector('.btn-rename-cancel')!.dispatchEvent(new Event('click', { bubbles: true }));
    return;
  }

  try {
    await api.renameFile(oldName, newName);
    loadData();
  } catch (err: any) {
    (window as any).showToast(err.message, 'error');
  }
}

async function performRowAction(tr: HTMLElement, name: string, type: 'magic' | 'log') {
  const actionsEl = tr.querySelector('.action-buttons') as HTMLElement;
  const loadingEl = tr.querySelector('.action-loading') as HTMLElement;
  
  actionsEl.style.display = 'none';
  loadingEl.style.display = 'flex';

  try {
    if (type === 'magic') {
      await api.uploadToMagic(name);
      (window as any).showToast(`Uploaded ${name} to MagicNZB`, 'success');
    } else {
      await api.uploadToLog(name);
      (window as any).showToast(`Sent ${name} to Telegram Log`, 'success');
    }
    // Delete file locally after successful upload? Depends on backend behavior, but let's reload anyway
    loadData();
  } catch (err: any) {
    (window as any).showToast(err.message, 'error');
    actionsEl.style.display = 'flex';
    loadingEl.style.display = 'none';
  }
}

async function handleFiles(files: File[]) {
  const nzbFiles = files.filter(f => f.name.toLowerCase().endsWith('.nzb'));
  if (nzbFiles.length === 0) {
    (window as any).showToast('Only .nzb files are supported', 'error');
    return;
  }

  const queueEl = mainContainer?.querySelector('#upload-queue');
  if (!queueEl) return;

  for (const file of nzbFiles) {
    const id = 'up-' + Math.random().toString(36).substr(2, 9);
    
    const ui = document.createElement('div');
    ui.className = 'upload-progress';
    ui.id = id;
    ui.innerHTML = `
      <div style="display:flex;justify-content:space-between">
        <span class="upload-progress-text filename-display" style="color:var(--fg)">${file.name}</span>
        <span class="upload-progress-text pct">0%</span>
      </div>
      <div class="upload-progress-bar">
        <div class="upload-progress-fill" style="width:0%"></div>
      </div>
    `;
    queueEl.appendChild(ui);

    uploadsInProgress++;
    
    try {
      await uploadFile(file, (pct) => {
        const fill = ui.querySelector('.upload-progress-fill') as HTMLElement;
        const pctTxt = ui.querySelector('.pct') as HTMLElement;
        if (fill) fill.style.width = `${pct}%`;
        if (pctTxt) pctTxt.textContent = `${pct}%`;
      });
      ui.remove();
    } catch (err: any) {
      (ui.querySelector('.upload-progress-fill') as HTMLElement)!.style.background = 'var(--error)';
      ui.querySelector('.pct')!.textContent = 'Error';
      (ui.querySelector('.pct') as HTMLElement)!.style.color = 'var(--error)';
      (window as any).showToast(`Failed to upload ${file.name}: ${err.message}`, 'error');
      setTimeout(() => ui.remove(), 4000);
    }
    
    uploadsInProgress--;
    if (uploadsInProgress === 0) {
      loadData();
    }
  }
}
