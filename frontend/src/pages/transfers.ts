import { api } from '../api.ts';
import type { Transfer, TransfersData } from '../api.ts';
import { iconRefresh, iconTrash, iconEye, iconX, iconFolder, iconFile, iconActivity, iconFileType, iconSearch, iconPlay, iconClipboard, iconZap, iconCheck } from '../icons.ts';
import { fmtSize } from '../api.ts';

let interval: ReturnType<typeof setInterval> | undefined;
let isAutoRefresh = true;
let currentTab: 'all' | 'running' | 'queued' | 'finished' | 'error' = 'all';
let transfersData: TransfersData = { running: [], queued: [], finished: [], error: [] };
let mainContainer: HTMLElement | null = null;
let currentSearch = '';

export function cleanupTransfers() {
  if (interval) {
    clearInterval(interval);
    interval = undefined;
  }
  // Don't null mainContainer — keep the DOM so revisiting doesn't flash
}

export async function renderTransfers(container: HTMLElement) {
  mainContainer = container;

  // Only build the shell if it's not already rendered
  if (!container.querySelector('#transfers-tbody')) {
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Transfers</h1>
          <p class="page-subtitle">Manage your MagicNZB downloads</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-sm" id="extract-links-btn" title="Extract video links from finished transfers" style="display:flex;align-items:center;gap:6px;font-size:12px;padding:6px 12px;background:var(--surface-2);border:1px solid var(--border);color:var(--fg);border-radius:6px;cursor:pointer;transition:all .2s">${iconZap()} Extract</button>
          <label class="toggle">
            <input type="checkbox" id="auto-refresh-toggle" ${isAutoRefresh ? 'checked' : ''}>
            <div class="toggle-track"><div class="toggle-thumb"></div></div>
            <span class="toggle-label">Auto-refresh</span>
          </label>
          <button class="btn btn-icon" id="refresh-btn" title="Refresh">${iconRefresh()}</button>
        </div>
      </div>

      <div class="search-wrap">
        ${iconSearch()}
        <input type="text" class="search-input" id="transfers-search" placeholder="Search transfers...">
        <div class="search-count" id="transfers-search-count"></div>
      </div>

      <div class="tab-bar" id="tab-bar"></div>
      <div class="card" style="padding:0">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th style="width:32px;padding:8px 4px 8px 12px"><input type="checkbox" id="extract-select-all" title="Select all for extraction"></th>
                <th>Name</th>
                <th style="width:80px;white-space:nowrap">Status</th>
                <th style="width:70px;white-space:nowrap">Actions</th>
              </tr>
            </thead>
            <tbody id="transfers-tbody"></tbody>
          </table>
        </div>
      </div>
      <div id="transfers-empty" style="display:none"></div>
    `;
    attachEvents();
  }
  await loadData();

  if (isAutoRefresh) {
    startAutoRefresh();
  }
}

function startAutoRefresh() {
  if (interval) clearInterval(interval);
  interval = setInterval(loadData, 8000);
}

async function loadData() {
  if (!mainContainer) return;
  try {
    transfersData = await api.transfers();
    renderTabs();
    renderTable();
  } catch (err: any) {
    (window as any).showToast(err.message || 'Failed to load transfers', 'error');
  }
}

function renderTabs() {
  if (!mainContainer) return;
  
  const total = (transfersData.running?.length || 0) + 
                (transfersData.queued?.length || 0) + 
                (transfersData.finished?.length || 0) + 
                (transfersData.error?.length || 0);

  const tabs = [
    { id: 'all', label: 'All', count: total },
    { id: 'running', label: 'Running', count: transfersData.running?.length || 0 },
    { id: 'queued', label: 'Queued', count: transfersData.queued?.length || 0 },
    { id: 'finished', label: 'Finished', count: transfersData.finished?.length || 0 },
    { id: 'error', label: 'Error', count: transfersData.error?.length || 0 }
  ];

  const html = tabs.map(t => `
    <div class="tab-item ${currentTab === t.id ? 'active' : ''}" data-tab="${t.id}">
      ${t.label} <span class="tab-count">${t.count}</span>
    </div>
  `).join('');

  const tabBar = mainContainer.querySelector('#tab-bar');
  if (tabBar) tabBar.innerHTML = html;
}

// Set of selected transfers: folder_id -> { folder_id, name }
const selectedTransfersMap = new Map<string, { folder_id: string; name: string }>();

function updateExtractBtnCount() {
  if (!mainContainer) return;
  const count = selectedTransfersMap.size;
  const btn = mainContainer.querySelector('#extract-links-btn');
  if (btn) {
    btn.innerHTML = `${iconZap()} Extract${count > 0 ? ` (${count})` : ''}`;
  }

  // Update header select-all checkbox
  const selectAllCb = mainContainer.querySelector('#extract-select-all') as HTMLInputElement | null;
  if (selectAllCb) {
    const visibleFinishedCbs = Array.from(mainContainer.querySelectorAll('.extract-row-cb')) as HTMLInputElement[];
    if (visibleFinishedCbs.length === 0) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
    } else {
      const checkedCount = visibleFinishedCbs.filter(cb => cb.checked).length;
      selectAllCb.checked = checkedCount === visibleFinishedCbs.length;
      selectAllCb.indeterminate = checkedCount > 0 && checkedCount < visibleFinishedCbs.length;
    }
  }
}

function renderTable() {
  if (!mainContainer) return;
  
  let list: Transfer[] = [];
  if (currentTab === 'all') {
    list = [
      ...(transfersData.running || []),
      ...(transfersData.queued || []),
      ...(transfersData.error || []),
      ...(transfersData.finished || [])
    ];
  } else {
    list = transfersData[currentTab] || [];
  }

  // Apply search filter — same logic as logs: split on separators, match all tokens
  if (currentSearch.trim()) {
    const tokens = currentSearch
      .replace(/[._\-\[\](){}]/g, ' ')
      .split(/\s+/)
      .map(t => t.toLowerCase())
      .filter(t => t.length >= 1);
    if (tokens.length) {
      list = list.filter(t => {
        const name = (t.name || '').toLowerCase().replace(/[._\-\[\](){}]/g, ' ');
        return tokens.every(tok => name.includes(tok));
      });
    }
  }

  const countEl = mainContainer.querySelector('#transfers-search-count');
  if (countEl) countEl.textContent = `${list.length} result${list.length !== 1 ? 's' : ''}`;

  const tbody = mainContainer.querySelector('#transfers-tbody');
  const empty = mainContainer.querySelector('#transfers-empty') as HTMLElement;
  const tableWrap = mainContainer.querySelector('.table-wrap') as HTMLElement;

  if (!tbody || !empty || !tableWrap) return;

  if (list.length === 0) {
    tableWrap.style.display = 'none';
    empty.style.display = 'block';
    empty.innerHTML = `
      <div class="empty">
        ${iconActivity()}
        <p>No transfers found in this category.</p>
      </div>
    `;
    updateExtractBtnCount();
    return;
  }

  tableWrap.style.display = 'block';
  empty.style.display = 'none';

  tbody.innerHTML = list.map(t => {
    let statusClass = '';
    let badgeText = t.status || '';
    
    if (t.status === 'downloading' || t.status === 'extracting') statusClass = 'badge-running';
    else if (t.status === 'queue') statusClass = 'badge-queued';
    else if (t.status === 'finished') statusClass = 'badge-finished';
    else statusClass = 'badge-error';

    const message = t.message ? `<div style="font-size:10px;color:var(--fg-3);margin-top:4px">${t.message}</div>` : '';

    // Progress as row background fill
    let pct = 0;
    if (t.progress !== undefined && t.progress !== null) {
      pct = typeof t.progress === 'string' ? parseFloat(t.progress) || 0 : (typeof t.progress === 'number' ? t.progress : 0);
      if (pct > 1) pct = pct / 100; // normalise if already 0–100
      pct = Math.min(1, Math.max(0, isNaN(pct) ? 0 : pct));
    }
    const isRunning = t.status === 'running' || t.status === 'downloading' || t.status === 'extracting';
    const rowStyle = isRunning && pct > 0
      ? `style="background: linear-gradient(to right, rgba(255,255,255,0.06) ${pct*100}%, transparent ${pct*100}%);"`
      : '';

    const isChecked = t.folder_id && selectedTransfersMap.has(t.folder_id);

    return `
      <tr ${rowStyle}>
        <td style="width:32px;padding:8px 4px 8px 12px">${t.status === 'finished' && t.folder_id ? `<input type="checkbox" class="extract-row-cb" data-folder-id="${t.folder_id}" data-name="${(t.name || '').replace(/"/g, '&quot;')}" ${isChecked ? 'checked' : ''}>` : ''}</td>
        <td>
          <div class="cell-name ${t.status === 'finished' ? 'cell-name-link' : ''}" title="${t.name || ''}" ${t.status === 'finished' ? `data-view-id="${t.id}"` : ''}>${t.name || 'Unknown'}</div>
          ${message}
        </td>
        <td><span class="badge ${statusClass}">${badgeText}</span></td>
        <td>
          <div class="cell-actions">
            ${t.status === 'finished' ? `<button class="btn-icon btn-view" data-id="${t.id}" title="View Contents">${iconEye()}</button>` : ''}
            <button class="btn-icon btn-delete" data-id="${t.id}" title="Delete">${iconTrash()}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  updateExtractBtnCount();
}

function attachEvents() {
  if (!mainContainer) return;

  const toggle = mainContainer.querySelector('#auto-refresh-toggle') as HTMLInputElement;
  toggle?.addEventListener('change', (e) => {
    isAutoRefresh = (e.target as HTMLInputElement).checked;
    if (isAutoRefresh) startAutoRefresh();
    else if (interval) clearInterval(interval);
  });

  mainContainer.querySelector('#refresh-btn')?.addEventListener('click', () => {
    loadData();
  });

  const searchInput = mainContainer.querySelector('#transfers-search') as HTMLInputElement;
  searchInput?.addEventListener('input', () => {
    currentSearch = searchInput.value;
    renderTable();
  });

  mainContainer.querySelector('#extract-links-btn')?.addEventListener('click', () => {
    extractFromCheckedRows();
  });

  // Select-all checkbox in table header
  mainContainer.querySelector('#extract-select-all')?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    mainContainer!.querySelectorAll('.extract-row-cb').forEach((cb) => {
      const input = cb as HTMLInputElement;
      input.checked = checked;
      const fId = input.getAttribute('data-folder-id');
      const fName = input.getAttribute('data-name') || '';
      if (fId) {
        if (checked) selectedTransfersMap.set(fId, { folder_id: fId, name: fName });
        else selectedTransfersMap.delete(fId);
      }
    });
    updateExtractBtnCount();
  });

  // Handle individual row checkbox clicks
  mainContainer.addEventListener('change', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('extract-row-cb')) {
      const input = target as HTMLInputElement;
      const fId = input.getAttribute('data-folder-id');
      const fName = input.getAttribute('data-name') || '';
      if (fId) {
        if (input.checked) selectedTransfersMap.set(fId, { folder_id: fId, name: fName });
        else selectedTransfersMap.delete(fId);
      }
      updateExtractBtnCount();
    }
  });

  mainContainer.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    
    // Tab click
    const tabEl = target.closest('.tab-item');
    if (tabEl) {
      currentTab = tabEl.getAttribute('data-tab') as any;
      renderTabs();
      renderTable();
      return;
    }

    // Delete click
    const deleteBtn = target.closest('.btn-delete');
    if (deleteBtn) {
      const id = deleteBtn.getAttribute('data-id');
      if (!id) return;
      if (confirm('Delete this transfer?')) {
        try {
          await api.deleteTransfer(id);
          (window as any).showToast('Transfer deleted', 'success');
          loadData();
        } catch (err: any) {
          (window as any).showToast(err.message, 'error');
        }
      }
      return;
    }

    // View click
    const viewBtn = target.closest('.btn-view');
    if (viewBtn) {
      const id = viewBtn.getAttribute('data-id');
      if (!id) return;
      showContentsModal(id);
      return;
    }

    // Name click (finished transfers)
    const nameEl = target.closest('.cell-name-link');
    if (nameEl) {
      const id = (nameEl as HTMLElement).getAttribute('data-view-id');
      if (!id) return;
      showContentsModal(id);
      return;
    }
  });
}

// ─── Extract from Checked Rows ────────────────────────────────────────────────
async function extractFromCheckedRows() {
  const selected = Array.from(selectedTransfersMap.values());
  if (selected.length === 0) {
    (window as any).showToast('Please check at least one finished transfer on the left to extract', 'error');
    return;
  }

  const total = selected.length;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal modal-wide" style="max-width:700px">
      <div class="modal-header">
        <div class="modal-title">Extracted Video Links</div>
        <button class="modal-close" id="close-extract">${iconX()}</button>
      </div>
      <div class="modal-body" id="extract-content">
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 0;gap:16px">
          <div class="spinner"></div>
          <div style="font-size:14px;color:var(--fg-2)" id="extract-progress-label">0 / ${total}</div>
          <div style="width:240px;height:4px;background:var(--border);border-radius:2px;overflow:hidden">
            <div id="extract-progress-bar" style="height:100%;width:0%;background:var(--primary);border-radius:2px;transition:width .3s ease"></div>
          </div>
          <div style="font-size:12px;color:var(--fg-3)" id="extract-progress-name" style="max-width:300px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">Fetching direct streaming links...</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  let cancelled = false;
  const closeModal = () => {
    cancelled = true;
    modal.remove();
    document.removeEventListener('keydown', escHandler);
  };
  const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', escHandler);
  modal.querySelector('#close-extract')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  const contentEl = modal.querySelector('#extract-content')!;
  const progressLabel = modal.querySelector('#extract-progress-label')!;
  const progressBar = modal.querySelector('#extract-progress-bar') as HTMLElement;
  const progressName = modal.querySelector('#extract-progress-name')!;

  // ── Process each transfer individually so we can show live N/total ──
  const extractedItems: Array<{ name: string; link: string; transferName: string }> = [];
  const errors: string[] = [];

  for (let i = 0; i < selected.length; i++) {
    if (cancelled) return;

    const transfer = selected[i];
    const pct = Math.round((i / total) * 100);
    progressLabel.textContent = `${i} / ${total}`;
    progressBar.style.width = `${pct}%`;
    progressName.textContent = transfer.name || transfer.folder_id;

    try {
      // Use the existing transferContents endpoint which accepts transfer id.
      // The folder_id stored in the map IS the transfer id (same as what /view uses).
      const res = await api.transferContents(transfer.folder_id);
      const files: any[] = res.files || [];

      for (const f of files) {
        const name: string = (f.name || '').trim();
        const link: string = f.directlink || f.link || f.url || '';
        if (!name.match(/\.(mp4|mkv)$/i)) continue;
        if (/sample/i.test(name)) continue;
        if (/sample/i.test(link)) continue;
        extractedItems.push({ name, link, transferName: transfer.name || '' });
      }
    } catch (err: any) {
      errors.push(`${transfer.name || transfer.folder_id}: ${err.message}`);
    }
  }

  if (cancelled) return;

  // Final progress = 100%
  progressLabel.textContent = `${total} / ${total}`;
  progressBar.style.width = '100%';

  if (extractedItems.length === 0 && errors.length === 0) {
    contentEl.innerHTML = `<div style="text-align:center;padding:30px 0;color:var(--fg-3)">No video files (.mp4 / .mkv) found in selected transfers.</div>`;
    return;
  }

  const formatted = extractedItems.map(item => `${item.name}\n${item.link}`).join('\n\n');

  const itemsHtml = extractedItems.map((item, i) => `
    <div class="file-row" style="gap:10px;padding:8px 12px;border-bottom:1px solid var(--border)">
      <div style="width:22px;height:22px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--fg-3);background:var(--surface-2);border-radius:var(--radius-sm)">${i + 1}</div>
      <div style="flex:1;min-width:0;overflow:hidden">
        <div style="font-size:13px;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${item.name}">${item.name}</div>
        <div style="font-size:11px;color:var(--fg-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">
          <a href="${item.link}" target="_blank" style="color:var(--fg-2);text-decoration:underline" title="${item.link}">${item.link}</a>
        </div>
      </div>
      <button class="btn btn-ghost extract-copy-one" data-link="${item.link}" title="Copy Link" style="padding:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iconClipboard()}</button>
    </div>
  `).join('');

  const errorsHtml = errors.length > 0 ? `
    <div style="margin-top:12px;padding:10px 12px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-sm)">
      <div style="font-size:12px;font-weight:500;color:var(--error);margin-bottom:4px">${errors.length} issue${errors.length > 1 ? 's' : ''}</div>
      ${errors.map(e => `<div style="font-size:11px;color:var(--fg-3);margin-top:2px">• ${e}</div>`).join('')}
    </div>
  ` : '';

  contentEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-size:13px;font-weight:500;color:var(--fg)">${extractedItems.length} video link${extractedItems.length !== 1 ? 's' : ''} extracted from ${total} transfer${total !== 1 ? 's' : ''}</div>
      <button class="btn btn-primary" id="extract-copy-all">${iconClipboard()} Copy All</button>
    </div>
    <div style="max-height:350px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)">
      ${itemsHtml}
    </div>
    ${errorsHtml}
  `;

  // Copy all button
  modal.querySelector('#extract-copy-all')?.addEventListener('click', () => {
    navigator.clipboard.writeText(formatted).then(() => {
      const btn = modal.querySelector('#extract-copy-all')!;
      btn.innerHTML = `${iconCheck()} Copied`;
      setTimeout(() => { btn.innerHTML = `${iconClipboard()} Copy All`; }, 2000);
      (window as any).showToast('All links copied to clipboard', 'success');
    });
  });

  // Individual copy buttons
  modal.querySelectorAll('.extract-copy-one').forEach(btn => {
    btn.addEventListener('click', () => {
      const link = (btn as HTMLElement).getAttribute('data-link') || '';
      navigator.clipboard.writeText(link).then(() => {
        (window as any).showToast('Link copied', 'success');
      });
    });
  });
}

async function showContentsModal(id: string) {
  // Pre-load DPlayer fresh from jsDelivr whenever a new folder is opened
  currentFolderPlayerPromise = loadDPlayer();

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal modal-wide">
      <div class="modal-header">
        <div class="modal-title">Folder Contents</div>
        <button class="modal-close" id="close-modal">${iconX()}</button>
      </div>
      <div class="modal-body" id="modal-content">
        <div style="display:flex;justify-content:center;padding:40px 0"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => { modal.remove(); document.removeEventListener('keydown', escHandler); };
  const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', escHandler);
  modal.querySelector('#close-modal')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  try {
    const res = await api.transferContents(id);
    const files = res.files || [];

    const contentEl = modal.querySelector('#modal-content');
    if (!contentEl) return;

    if (files.length === 0) {
      contentEl.innerHTML = '<div style="text-align:center;padding:20px 0;color:var(--fg-3)">No files found in folder</div>';
      return;
    }

    const isImage = (name: string) => /\.(jpe?g|jpg|png|gif|webp|bmp|tiff?|svg|heic|avif)$/i.test(name);
    const isVideo = (name: string) => /\.(mp4|mkv|avi|mov|wmv|m4v|webm|flv|ts|mts|m2ts|3gp|vob|ogv|divx|xvid|rmvb|rm)$/i.test(name);

    const fileListHtml = files.map((f: any, i: number) => {
      const img = isImage(f.name);
      const vid = isVideo(f.name);

      const nameHtml = img && f.link
        ? `<span class="file-row-link img-preview-btn" data-idx="${i}" style="cursor:pointer;text-decoration:underline;color:var(--fg)">${f.name}</span>`
        : vid && f.link
          ? `<span class="file-row-link copy-link-btn" data-link="${f.link}" style="cursor:pointer;text-decoration:underline;color:var(--fg)">${f.name}</span>`
          : f.link
            ? `<a href="${f.link}" target="_blank" style="text-decoration:underline;color:var(--fg)">${f.name}</a>`
            : `<span>${f.name}</span>`;

      const actionHtml = vid && f.link
        ? `<div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
            <button class="btn btn-ghost play-video-btn" data-link="${f.link}" data-name="${f.name}" title="Play Video" style="padding:4px;display:flex;align-items:center;justify-content:center;color:var(--fg)">${iconPlay()}</button>
            <button class="btn btn-ghost copy-link-btn" data-link="${f.link}" title="Copy Link" style="padding:4px;display:flex;align-items:center;justify-content:center">${iconClipboard()}</button>
          </div>`
        : f.link
          ? `<div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
              <button class="btn btn-ghost copy-link-btn" data-link="${f.link}" title="Copy Link" style="padding:4px;display:flex;align-items:center;justify-content:center">${iconClipboard()}</button>
            </div>`
          : '';

      return `<div class="file-row" style="gap:10px">
        ${iconFileType(f.name)}
        <div class="file-row-name" title="${f.name}" style="flex:1;min-width:0">${nameHtml}</div>
        <div class="file-row-size" style="white-space:nowrap">${f.size ? fmtSize(f.size) : ''}</div>
        ${actionHtml}
      </div>`;
    }).join('');

    // Store links for image preview
    const imageFiles = files.filter((f: any) => isImage(f.name));

    contentEl.innerHTML = `
      <div style="max-height:60vh;overflow-y:auto;padding-right:6px">
        ${fileListHtml}
      </div>
    `;

    // Copy link buttons
    contentEl.querySelectorAll('.copy-link-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const link = (btn as HTMLElement).getAttribute('data-link') || '';
        navigator.clipboard.writeText(link).then(() => {
          (window as any).showToast('Link copied to clipboard', 'success');
        });
      });
    });

    // Play video buttons
    contentEl.querySelectorAll('.play-video-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const link = (btn as HTMLElement).getAttribute('data-link') || '';
        const name = (btn as HTMLElement).getAttribute('data-name') || 'Video';
        if (link) openVideoPlayer(link, name);
      });
    });

    // Image preview
    contentEl.querySelectorAll('.img-preview-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).getAttribute('data-idx') || '0', 10);
        const file = files[idx];
        if (!file?.link) return;

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;cursor:zoom-out';
        overlay.innerHTML = `
          <div style="position:relative;max-width:90vw;max-height:90vh">
            <img src="${file.link}" alt="${file.name}" style="max-width:90vw;max-height:85vh;object-fit:contain;border-radius:4px;display:block">
            <div style="text-align:center;color:#aaa;font-size:12px;margin-top:8px">${file.name}</div>
            <button style="position:absolute;top:-12px;right:-12px;background:var(--surface-2);border:1px solid var(--border);border-radius:50%;width:28px;height:28px;cursor:pointer;color:var(--fg);font-size:16px;display:flex;align-items:center;justify-content:center" id="close-img">✕</button>
          </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay || (e.target as HTMLElement).id === 'close-img') overlay.remove();
        });
        function imgEsc(e: KeyboardEvent) {
          if (e.key === 'Escape') {
            e.stopImmediatePropagation();
            overlay.remove();
            document.removeEventListener('keydown', imgEsc, true);
          }
        }
        document.addEventListener('keydown', imgEsc, true);
      });
    });

  } catch (err: any) {
    const contentEl = modal.querySelector('#modal-content');
    if (contentEl) contentEl.innerHTML = `<div style="color:var(--error);padding:20px 0">Failed to load contents: ${err.message}</div>`;
  }
}

// ─── DPlayer Video Player ─────────────────────────────────────────

let currentFolderPlayerPromise: Promise<void> | null = null;

function loadDPlayer(): Promise<void> {
  return new Promise(async (resolve, reject) => {
    // Clean up old script/style elements to force a fresh download every time
    document.querySelectorAll('script[data-dplayer-script], link[data-dplayer-style]').forEach(el => el.remove());

    const timestamp = Date.now();
    let ver = 'beta';
    try {
      const res = await fetch(`https://data.jsdelivr.com/v1/packages/npm/dplayer-enhanced?t=${timestamp}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        if (data.tags?.beta) ver = data.tags.beta;
      }
    } catch (_) {}

    // Load CSS (forced un-cached with unique timestamp on every click)
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.dplayerStyle = 'true';
    link.href = `https://cdn.jsdelivr.net/npm/dplayer-enhanced@${ver}/dist/DPlayer.min.css?t=${timestamp}`;
    document.head.appendChild(link);

    // Load JS (forced un-cached with unique timestamp on every click)
    const script = document.createElement('script');
    script.dataset.dplayerScript = 'true';
    script.src = `https://cdn.jsdelivr.net/npm/dplayer-enhanced@${ver}/dist/DPlayer.min.js?t=${timestamp}`;
    script.onload = () => { resolve(); };
    script.onerror = () => reject(new Error('Failed to load DPlayer from jsDelivr'));
    document.head.appendChild(script);
  });
}

async function openVideoPlayer(url: string, name: string) {
  // Inject web-fullscreen CSS overrides (once)
  if (!document.getElementById('dplayer-wf-styles')) {
    const style = document.createElement('style');
    style.id = 'dplayer-wf-styles';
    style.textContent = `
      /* When DPlayer enters web-fullscreen ("W" key), remove container constraints */
      .video-player-overlay:has(.dplayer-fulled) {
        background: #000 !important;
      }
      .video-player-overlay:has(.dplayer-fulled) #dplayer-container {
        width: 100vw !important;
        max-width: 100vw !important;
        height: 100vh !important;
        max-height: 100vh !important;
        aspect-ratio: unset !important;
        border-radius: 0 !important;
        box-shadow: none !important;
      }
      /* Hide the title bar in web-fullscreen */
      .video-player-overlay:has(.dplayer-fulled) > div:first-child {
        display: none !important;
      }
      /* Ensure DPlayer fulled fills its container rather than using position:fixed */
      #dplayer-container .dplayer.dplayer-fulled {
        position: absolute !important;
        z-index: 1 !important;
      }
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.className = 'video-player-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.95);display:flex;flex-direction:column;align-items:center;justify-content:center';

  overlay.innerHTML = `
    <div style="position:absolute;top:12px;right:16px;left:16px;display:flex;align-items:center;justify-content:space-between;z-index:10">
      <div style="color:#ccc;font-size:13px;font-family:'Inter',sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:calc(100% - 50px)" title="${name}">${name}</div>
      <button id="close-player" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:50%;width:34px;height:34px;cursor:pointer;color:#fff;font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0;backdrop-filter:blur(8px);transition:background .2s" onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">✕</button>
    </div>
    <div id="dplayer-container" style="width:90vw;max-width:1200px;aspect-ratio:16/9;max-height:80vh;border-radius:8px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.5);background:#000">
    </div>
  `;

  document.body.appendChild(overlay);

  let dpInstance: any = null;

  const cleanup = () => {
    if (dpInstance) {
      try { dpInstance.destroy(); } catch (_) {}
      dpInstance = null;
    }
    overlay.remove();
    document.removeEventListener('keydown', escHandler, true);
  };

  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // If DPlayer is in web-fullscreen, exit that first instead of closing
      const fulled = overlay.querySelector('.dplayer-fulled');
      if (fulled && dpInstance) {
        e.stopImmediatePropagation();
        e.preventDefault();
        dpInstance.fullScreen?.cancel('web');
        return;
      }
      e.stopImmediatePropagation();
      cleanup();
    }
  };

  document.addEventListener('keydown', escHandler, true);
  overlay.querySelector('#close-player')?.addEventListener('click', cleanup);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cleanup();
  });

  try {
    if (!currentFolderPlayerPromise) {
      currentFolderPlayerPromise = loadDPlayer();
    }
    await currentFolderPlayerPromise;

    const DPlayer = (window as any).DPlayer;
    if (!DPlayer) throw new Error('DPlayer not available');

    const container = overlay.querySelector('#dplayer-container');
    if (!container) return;
    container.innerHTML = '';

    dpInstance = new DPlayer({
      container: container as HTMLElement,
      video: {
        url: url,
        type: 'auto',
      },
      autoplay: true,
      theme: '#e4e4e7',
      loop: false,
      screenshot: true,
      hotkey: true,
      preload: 'auto',
      volume: 0.8,
    });
  } catch (err: any) {
    const container = overlay.querySelector('#dplayer-container');
    if (container) {
      container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ef4444;font-size:14px;font-family:'Inter',sans-serif">Failed to load player: ${err.message}</div>`;
    }
    (window as any).showToast('Failed to load video player', 'error');
  }
}
