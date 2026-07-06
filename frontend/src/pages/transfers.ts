import { api } from '../api.ts';
import type { Transfer, TransfersData } from '../api.ts';
import { iconRefresh, iconTrash, iconEye, iconX, iconFolder, iconFile, iconActivity, iconFileType } from '../icons.ts';
import { fmtSize } from '../api.ts';

let interval: ReturnType<typeof setInterval> | undefined;
let isAutoRefresh = true;
let currentTab: 'all' | 'running' | 'queued' | 'finished' | 'error' = 'all';
let transfersData: TransfersData = { running: [], queued: [], finished: [], error: [] };
let mainContainer: HTMLElement | null = null;

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
          <label class="toggle">
            <input type="checkbox" id="auto-refresh-toggle" ${isAutoRefresh ? 'checked' : ''}>
            <div class="toggle-track"><div class="toggle-thumb"></div></div>
            <span class="toggle-label">Auto-refresh</span>
          </label>
          <button class="btn btn-icon" id="refresh-btn" title="Refresh">${iconRefresh()}</button>
        </div>
      </div>
      
      <div id="stats-container"></div>
      <div class="tab-bar" id="tab-bar"></div>
      <div class="card" style="padding:0">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th style="width:80px;white-space:nowrap">Status</th>
                <th style="width:140px;white-space:nowrap">Progress</th>
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
    renderStats();
    renderTabs();
    renderTable();
  } catch (err: any) {
    (window as any).showToast(err.message || 'Failed to load transfers', 'error');
  }
}

function renderStats() {
  if (!mainContainer) return;
  const runningCount = transfersData.running?.length || 0;
  const queuedCount = transfersData.queued?.length || 0;
  const finishedCount = transfersData.finished?.length || 0;
  const errorCount = transfersData.error?.length || 0;

  const html = `
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value">${runningCount}</div>
        <div class="stat-label">Running</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${queuedCount}</div>
        <div class="stat-label">Queued</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${finishedCount}</div>
        <div class="stat-label">Finished</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${errorCount}</div>
        <div class="stat-label">Error</div>
      </div>
    </div>
  `;
  const statsEl = mainContainer.querySelector('#stats-container');
  if (statsEl) statsEl.innerHTML = html;
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

    let progressHtml = '';
    if (t.progress !== undefined && t.progress !== null) {
      let pct = 0;
      if (typeof t.progress === 'string') pct = parseFloat(t.progress) || 0;
      else pct = typeof t.progress === 'number' ? t.progress : 0;
      if (isNaN(pct)) pct = 0;
      
      progressHtml = `
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;width:32px;text-align:right">${pct.toFixed(0)}%</span>
          <div class="progress-bar" style="flex:1">
            <div class="progress-fill" style="width:${Math.min(100, Math.max(0, pct))}%"></div>
          </div>
        </div>
      `;
    }

    const message = t.message ? `<div style="font-size:10px;color:var(--fg-3);margin-top:4px">${t.message}</div>` : '';

    return `
      <tr>
        <td>
          <div class="cell-name ${t.status === 'finished' ? 'cell-name-link' : ''}" title="${t.name || ''}" ${t.status === 'finished' ? `data-view-id="${t.id}"` : ''}>${t.name || 'Unknown'}</div>
          ${message}
        </td>
        <td><span class="badge ${statusClass}">${badgeText}</span></td>
        <td style="min-width:120px">${progressHtml}</td>
        <td>
          <div class="cell-actions">
            ${t.status === 'finished' ? `<button class="btn-icon btn-view" data-id="${t.id}" title="View Contents">${iconEye()}</button>` : ''}
            <button class="btn-icon btn-delete" data-id="${t.id}" title="Delete">${iconTrash()}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
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

async function showContentsModal(id: string) {
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
        ? `<button class="btn btn-ghost copy-link-btn" data-link="${f.link}" style="font-size:11px;padding:2px 8px;white-space:nowrap">Copy Link</button>`
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
