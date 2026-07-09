import { api, uploadFile, fmtSize, fmtDate } from '../api.ts';
import type { FileEntry } from '../api.ts';
import { iconTrash, iconEdit, iconUpload, iconClipboard, iconZap, iconFile, iconCheck, iconX } from '../icons.ts';

let filesData: FileEntry[] = [];
let mainContainer: HTMLElement | null = null;
let uploadsInProgress = 0;

// Per-filename thumbnail URL set before upload
const pendingThumbs = new Map<string, string>();

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

  tbody.innerHTML = filesData.map(f => {
    const savedThumb = pendingThumbs.get(f.name) || '';
    return `
    <tr data-name="${f.name}">
      <td>
        <div class="cell-name filename-display">${f.name}</div>
        <div class="filename-edit" style="display:none;align-items:center;gap:6px">
          <input type="text" class="inline-rename" value="${f.name}">
          <button class="btn-icon btn-rename-save" style="color:var(--success)">${iconCheck()}</button>
          <button class="btn-icon btn-rename-cancel">${iconX()}</button>
        </div>
        <div class="file-thumb-url-row">
          <input type="url" class="file-thumb-input search-input" placeholder="Thumbnail URL (optional)" value="${savedThumb}" style="font-size:11px;height:26px;padding:3px 8px">
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
      </td>
    </tr>
  `}).join('');
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

  // Thumbnail URL clear button
  mainContainer.querySelector('#thumb-url-clear')?.addEventListener('click', () => {
    const input = mainContainer?.querySelector('#thumb-url-input') as HTMLInputElement;
    if (input) input.value = '';
    pendingThumbs.clear();
  });

  // Per-row thumbnail URL input — persist to map so value survives table re-render
  mainContainer.addEventListener('input', (e) => {
    const input = (e.target as HTMLElement).closest('.file-thumb-input') as HTMLInputElement | null;
    if (!input) return;
    const tr = input.closest('tr') as HTMLElement | null;
    const name = tr?.getAttribute('data-name');
    if (!name) return;
    if (input.value.trim()) pendingThumbs.set(name, input.value.trim());
    else pendingThumbs.delete(name);
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
      const btn = target.closest('.btn-magic') as HTMLButtonElement;
      await performRowAction(tr, name, 'magic', undefined, btn);
      return;
    }

    // Upload Log
    if (target.closest('.btn-log')) {
      // Read per-row thumbnail URL input
      const thumbInput = tr.querySelector('.file-thumb-input') as HTMLInputElement;
      const thumbUrl = thumbInput?.value.trim() || pendingThumbs.get(name) || '';
      if (thumbUrl) {
        pendingThumbs.delete(name);
        await performRowAction(tr, name, 'log', thumbUrl);
      } else {
        showSendToLogModal(tr, name);
      }
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

    // Update in-place
    const nameDisplay = tr.querySelector('.cell-name.filename-display') as HTMLElement;
    if (nameDisplay) nameDisplay.textContent = newName;
    input.value = newName;
    tr.setAttribute('data-name', newName);

    // Update pending thumbs key if it existed
    if (pendingThumbs.has(oldName)) {
      pendingThumbs.set(newName, pendingThumbs.get(oldName)!);
      pendingThumbs.delete(oldName);
    }

    // Collapse edit UI back to display
    (tr.querySelector('.filename-display') as HTMLElement).style.display = 'block';
    (tr.querySelector('.filename-edit') as HTMLElement).style.display = 'none';

    (window as any).showToast(`Renamed to: ${newName}`, 'success');
  } catch (err: any) {
    (window as any).showToast(err.message, 'error');
  }
}

async function performRowAction(tr: HTMLElement, name: string, type: 'magic' | 'log', imageUrl?: string, btn?: HTMLButtonElement) {
  // If button passed, animate it; otherwise disable all buttons in the row
  const actionsEl = tr.querySelector('.action-buttons') as HTMLElement;
  const allBtns = actionsEl.querySelectorAll<HTMLButtonElement>('button');

  if (btn) {
    btn.disabled = true;
    btn.classList.add('btn-magic-sending');
  } else {
    allBtns.forEach(b => { b.disabled = true; b.style.opacity = '0.4'; });
  }

  // If no imageUrl passed in, read from the per-row input
  const thumbInput = tr.querySelector('.file-thumb-input') as HTMLInputElement | null;
  const thumbUrl = imageUrl || thumbInput?.value.trim() || pendingThumbs.get(name) || '';

  try {
    let msgId = 0;

    if (type === 'magic') {
      const res = await api.uploadToMagic(name);
      msgId = (res as any)?.msg_id ?? 0;
      (window as any).showToast(`Uploaded ${name} to MagicNZB`, 'success');
    } else {
      const res = await api.uploadToLog(name);
      msgId = (res as any)?.msg_id ?? 0;
      (window as any).showToast(`Sent ${name} to Telegram Log`, 'success');
    }

    // Save thumbnail for both actions if URL provided and msg_id valid
    if (thumbUrl && msgId > 0) {
      try {
        await api.setCustomThumbnail(msgId, thumbUrl);
        (window as any).showToast('Thumbnail saved', 'success');
        pendingThumbs.delete(name);
        if (thumbInput) thumbInput.value = '';
      } catch (thumbErr: any) {
        (window as any).showToast(`Thumbnail failed: ${thumbErr.message}`, 'error');
      }
    }

    loadData();
  } catch (err: any) {
    (window as any).showToast(err.message, 'error');
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('btn-magic-sending');
    } else {
      allBtns.forEach(b => { b.disabled = false; b.style.opacity = ''; });
    }
  }
}

function showSendToLogModal(tr: HTMLElement, name: string) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-header">
        <div class="modal-title">Send to Telegram Log</div>
        <button class="modal-close" id="stl-close">${iconX()}</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
        <div style="font-size:12px;color:var(--fg-2);word-break:break-all">${name}</div>
        <div>
          <label style="font-size:11px;color:var(--fg-3);display:block;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">
            Custom Thumbnail URL <span style="color:var(--fg-3)">(optional)</span>
          </label>
          <input
            id="stl-img-url"
            type="url"
            class="search-input"
            style="width:100%"
            placeholder="https://example.com/poster.jpg"
          >
          <div style="font-size:11px;color:var(--fg-3);margin-top:4px">Paste a direct image URL — only the URL will be stored in the database.</div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost" id="stl-cancel">Cancel</button>
          <button class="btn btn-primary" id="stl-confirm">Send to Log</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#stl-close')?.addEventListener('click', close);
  modal.querySelector('#stl-cancel')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  modal.querySelector('#stl-confirm')?.addEventListener('click', async () => {
    const imgUrl = (modal.querySelector('#stl-img-url') as HTMLInputElement).value.trim();
    close();
    await performRowAction(tr, name, 'log', imgUrl || undefined);
  });
}

// ─── Provider-prefix thumbnail resolver ──────────────────────────────────────
// DS_<hash>_thumb.jpg  → https://drunkenslug.com/covers/sample/<hash>_thumb.jpg
// TR_<hash>_thumb.jpg  → https://www.tabula-rasa.pw/covers/sample/<hash>_thumb.jpg
// https://...          → plain URL, passed through as-is
function resolveThumbPrefix(prefix: string): string | null {
  if (prefix.startsWith('DS_')) return `https://drunkenslug.com/covers/sample/${prefix.slice(3)}`;
  if (prefix.startsWith('TR_')) return `https://www.tabula-rasa.pw/covers/sample/${prefix.slice(3)}`;
  if (/^https?:\/\//i.test(prefix)) return prefix;
  return null;
}

// Parse a filename that may contain a thumbnail prefix token before the .nzb title
function parseFilenameWithThumb(filename: string): { thumbUrl: string; nzbName: string } {
  const spaceIdx = filename.indexOf(' ');
  if (spaceIdx > 0) {
    const prefix = filename.slice(0, spaceIdx);
    const rest = filename.slice(spaceIdx + 1).trim();
    if (rest.toLowerCase().endsWith('.nzb')) {
      const thumbUrl = resolveThumbPrefix(prefix);
      if (thumbUrl) return { thumbUrl, nzbName: rest };
    }
  }
  return { thumbUrl: '', nzbName: filename };
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

    // Parse encoded or plain URL prefix from the filename
    const { thumbUrl: parsedThumbUrl, nzbName } = parseFilenameWithThumb(file.name);

    let resolvedThumbUrl = parsedThumbUrl;
    const resolvedDisplayName = nzbName;

    if (resolvedThumbUrl) {
      // Pre-fill the per-row thumb input if the row already exists
      const existingRow = mainContainer?.querySelector(`tr[data-name="${CSS.escape(file.name)}"]`);
      const thumbInput = existingRow?.querySelector('.file-thumb-input') as HTMLInputElement | null;
      if (thumbInput && !thumbInput.value) thumbInput.value = resolvedThumbUrl;
      // Key by nzbName (clean name without prefix) so it survives re-render after upload
      pendingThumbs.set(nzbName, resolvedThumbUrl);
    }

    // Also honour any thumb URL already stored in the pending map (set via per-row input)
    const thumbUrl = resolvedThumbUrl || pendingThumbs.get(nzbName) || pendingThumbs.get(file.name) || '';

    const ui = document.createElement('div');
    ui.className = 'upload-progress';
    ui.id = id;
    ui.innerHTML = `
      <div style="display:flex;justify-content:space-between">
        <span class="upload-progress-text filename-display" style="color:var(--fg)">${resolvedDisplayName}</span>
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
      }, thumbUrl || undefined);
      ui.remove();
    } catch (err: any) {
      (ui.querySelector('.upload-progress-fill') as HTMLElement)!.style.background = 'var(--error)';
      ui.querySelector('.pct')!.textContent = 'Error';
      (ui.querySelector('.pct') as HTMLElement)!.style.color = 'var(--error)';
      (window as any).showToast(`Failed to upload ${resolvedDisplayName}: ${err.message}`, 'error');
      setTimeout(() => ui.remove(), 4000);
    }

    uploadsInProgress--;
    if (uploadsInProgress === 0) {
      loadData();
    }
  }
}
