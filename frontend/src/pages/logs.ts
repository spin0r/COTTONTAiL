import { api } from '../api.ts';
import type { LogEntry } from '../api.ts';
import { iconSearch, iconDownload, iconEdit, iconSparkle, iconTrash, iconCheck, iconX, iconClipboard, iconImage, iconTelegram } from '../icons.ts';
import { fmtDate } from '../api.ts';

let mainContainer: HTMLElement | null = null;
let currentQuery = '';
let searchTimeout: ReturnType<typeof setTimeout> | undefined;

export function cleanupLogs() {
  if (searchTimeout) clearTimeout(searchTimeout);
}

export async function renderLogs(container: HTMLElement) {
  mainContainer = container;

  if (!container.querySelector('#logs-tbody')) {
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">NZB Index Logs</h1>
          <p class="page-subtitle" id="stats-subtitle">Loading stats...</p>
        </div>
      </div>
      
      <div class="search-wrap">
        ${iconSearch()}
        <input type="text" class="search-input" id="search-input" placeholder="Search NZB index...">
        <div class="search-count" id="search-count"></div>
      </div>

      <div class="card" style="padding:0">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>File Name</th>
                <th style="width:120px">Date</th>
                <th style="width:160px">Actions</th>
              </tr>
            </thead>
            <tbody id="logs-tbody"></tbody>
          </table>
        </div>
      </div>
      <div id="logs-empty" style="display:none"></div>
    `;
    attachEvents();
  }

  loadStats();
  await loadData();
}

async function loadStats() {
  try {
    const stats = await api.logStats();
    const sub = mainContainer?.querySelector('#stats-subtitle');
    if (sub) sub.textContent = `${stats.total.toLocaleString()} entries indexed`;
  } catch { /* ignore */ }
}

async function loadData() {
  if (!mainContainer) return;
  const tbody = mainContainer.querySelector('#logs-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="3"><div class="loading-page" style="min-height:100px"><div class="spinner"></div></div></td></tr>`;
  try {
    const res = await api.logs(currentQuery);
    renderTable(res.results, res.total);
  } catch (err: any) {
    (window as any).showToast(err.message || 'Failed to search', 'error');
  }
}

function renderTable(logs: LogEntry[], total: number) {
  if (!mainContainer) return;

  const countEl = mainContainer.querySelector('#search-count');
  if (countEl) countEl.textContent = `${total} result${total !== 1 ? 's' : ''}`;

  const tbody     = mainContainer.querySelector('#logs-tbody');
  const empty     = mainContainer.querySelector('#logs-empty') as HTMLElement;
  const tableWrap = mainContainer.querySelector('.table-wrap') as HTMLElement;
  if (!tbody || !empty || !tableWrap) return;

  if (logs.length === 0) {
    tableWrap.style.display = 'none';
    empty.style.display = 'block';
    empty.innerHTML = `<div class="empty">${iconClipboard()}<p>No results found.</p></div>`;
    return;
  }

  tableWrap.style.display = 'block';
  empty.style.display = 'none';

  tbody.innerHTML = logs.map(l => {
    let dateStr = l.uploaded_at;
    if (!isNaN(Number(l.uploaded_at))) {
      dateStr = fmtDate(Number(l.uploaded_at));
    } else {
      try { dateStr = new Date(l.uploaded_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); } catch {}
    }

    return `
      <tr data-id="${l.msg_id}" data-has-custom="${l.has_custom_thumbnail ? '1' : '0'}">
        <td>
          <div class="cell-name filename-display">
            <span class="log-name-link cell-name-link">${l.file_name}</span>
            ${l.has_custom_thumbnail
              ? `<span class="custom-thumb-dot" title="Has sample image"></span>`
              : ''}
            ${l.link
              ? `<a href="${l.link}" target="_blank" class="log-tg-link" title="Open in Telegram" style="color:var(--fg-3);margin-left:6px;vertical-align:middle;display:inline-flex;opacity:.6" tabindex="-1">${iconTelegram()}</a>`
              : ''}
          </div>
          <div class="filename-edit" style="display:none;align-items:center;gap:6px">
            <input type="text" class="inline-rename" value="${l.file_name}">
            <button class="btn-icon btn-rename-save" style="color:var(--success)">${iconCheck()}</button>
            <button class="btn-icon btn-rename-cancel">${iconX()}</button>
          </div>
        </td>
        <td class="cell-mono">${dateStr}</td>
        <td>
          <div class="cell-actions action-buttons">
            <button class="btn-icon btn-grab" title="Grab to MagicNZB">${iconDownload()}</button>
            <button class="btn-icon btn-rename" title="Rename">${iconEdit()}</button>
            <button class="btn-icon btn-ai-rename" title="AI Smart Rename">${iconSparkle()}</button>
            <button class="btn-icon btn-backfill" title="Set Sample Image" style="${l.has_custom_thumbnail ? 'color:var(--success)' : ''}">${iconImage()}</button>
            <button class="btn-icon btn-delete" title="Delete">${iconTrash()}</button>
          </div>
          <div class="action-loading" style="display:none;justify-content:flex-end;padding-right:12px">
            <div class="spinner spinner-sm"></div>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ─── Dual thumbnail modal (slideshow) ───────────────────────────
function showThumbModal(msgId: number, fileName: string, telegramLink: string, hasCustom: boolean) {
  // slides: [ { label, url, type } ]
  const slides = [
    { label: 'ThePornDB', url: api.logThumbnailUrl(msgId), preload: true },
    ...(hasCustom ? [{ label: 'Sample', url: api.logCustomThumbnailUrl(msgId), preload: false }] : []),
  ];
  let current = 0;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal log-thumb-modal">
      <div class="modal-header">
        <div class="modal-title" style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:calc(100% - 40px)">${fileName}</div>
        <button class="modal-close" id="close-thumb-modal">${iconX()}</button>
      </div>
      <div class="log-thumb-body">
        <div class="log-thumb-viewer" id="thumb-viewer">
          <div class="spinner"></div>
          ${slides.length > 1 ? `
            <button class="log-thumb-arrow prev" id="thumb-prev">&#8249;</button>
            <button class="log-thumb-arrow next" id="thumb-next">&#8250;</button>
          ` : ''}
        </div>
        <div class="log-thumb-bar">
          <span class="log-thumb-label" id="thumb-label">${slides[0].label}</span>
          <div class="log-thumb-dots" id="thumb-dots">
            ${slides.map((_, i) => `<button class="log-thumb-dot-btn ${i === 0 ? 'active' : ''}" data-idx="${i}"></button>`).join('')}
          </div>
        </div>
        <div class="log-thumb-actions">
          <button class="btn btn-ghost" id="btn-set-custom" style="font-size:12px">${iconImage()} Set Sample Image</button>
          ${telegramLink ? `<a href="${telegramLink}" target="_blank" class="btn btn-ghost" style="font-size:12px">Open in Telegram</a>` : ''}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const viewer   = modal.querySelector('#thumb-viewer') as HTMLElement;
  const labelEl  = modal.querySelector('#thumb-label') as HTMLElement;
  const dotsEl   = modal.querySelector('#thumb-dots') as HTMLElement;

  function goTo(idx: number) {
    current = (idx + slides.length) % slides.length;
    const slide = slides[current];

    // update label + dots
    labelEl.textContent = slide.label;
    dotsEl.querySelectorAll('.log-thumb-dot-btn').forEach((d, i) =>
      d.classList.toggle('active', i === current)
    );

    // show spinner while loading
    // keep arrows in DOM
    const arrows = viewer.querySelectorAll('.log-thumb-arrow');
    viewer.innerHTML = '';
    arrows.forEach(a => viewer.appendChild(a));

    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    viewer.appendChild(spinner);

    const img = new Image();
    img.className = 'log-thumb-img';
    img.onload = () => {
      spinner.remove();
      viewer.appendChild(img);
    };
    img.onerror = () => {
      spinner.remove();
      const empty = document.createElement('div');
      empty.className = 'log-thumb-empty';
      empty.textContent = slide.label === 'Sample' ? 'No sample image' : 'No match on ThePornDB';
      viewer.appendChild(empty);
    };
    img.src = slide.url;
  }

  // initial load
  goTo(0);

  // arrow buttons
  modal.querySelector('#thumb-prev')?.addEventListener('click', () => goTo(current - 1));
  modal.querySelector('#thumb-next')?.addEventListener('click', () => goTo(current + 1));

  // dot buttons
  dotsEl?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.log-thumb-dot-btn') as HTMLElement | null;
    if (btn) goTo(parseInt(btn.getAttribute('data-idx') || '0', 10));
  });

  // close
  const close = () => {
    modal.remove();
    document.removeEventListener('keydown', keyHandler, true);
  };
  modal.querySelector('#close-thumb-modal')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  // arrow keys — use capture so they don't fire tab switching
  // only active while modal is open
  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { close(); return; }
    if (slides.length < 2) return;
    if (e.key === 'ArrowLeft')  { goTo(current - 1); }
    if (e.key === 'ArrowRight') { goTo(current + 1); }
  };
  document.addEventListener('keydown', keyHandler, true);

  // Set Sample Image
  modal.querySelector('#btn-set-custom')?.addEventListener('click', () => {
    close();
    showSetCustomModal(msgId, fileName);
  });
}

// ─── Set Sample Image modal ──────────────────────────────────
function showSetCustomModal(msgId: number, fileName: string) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-header">
        <div class="modal-title">Set Sample Image</div>
        <button class="modal-close" id="sc-close">${iconX()}</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
        <div style="font-size:12px;color:var(--fg-2);word-break:break-all">${fileName}</div>
        <div>
          <label style="font-size:11px;color:var(--fg-3);display:block;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">Image URL</label>
          <input id="sc-url" type="text" class="search-input" style="width:100%" placeholder="https://example.com/poster.jpg">
          <div style="font-size:11px;color:var(--fg-3);margin-top:4px">Downloaded once and stored permanently in the database — survives redeploys.</div>
        </div>
        <div id="sc-status" style="font-size:12px;display:none"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost" id="sc-cancel">Cancel</button>
          <button class="btn btn-primary" id="sc-save">Download &amp; Save</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const urlInput = modal.querySelector('#sc-url') as HTMLInputElement;
  const saveBtn  = modal.querySelector('#sc-save') as HTMLButtonElement;
  const statusEl = modal.querySelector('#sc-status') as HTMLElement;

  const close = () => modal.remove();
  modal.querySelector('#sc-close')?.addEventListener('click', close);
  modal.querySelector('#sc-cancel')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  // Auto-detect URL in clipboard and pre-fill, then focus
  navigator.clipboard.readText().then(text => {
    const trimmed = text.trim();
    if (/^https?:\/\/.+/i.test(trimmed)) {
      urlInput.value = trimmed;
    }
  }).catch(() => { /* clipboard access denied — silently ignore */ });
  urlInput.focus();

  // Shared save logic used by both Enter key and button click
  async function doSave() {
    const url = urlInput.value.trim();
    if (!url || saveBtn.disabled) return;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Downloading…';
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--fg-3)';
    statusEl.textContent = 'Downloading and storing image…';

    try {
      const res = await api.setCustomThumbnail(msgId, url);
      statusEl.style.color = 'var(--success)';
      statusEl.textContent = `✓ Saved (${(res.size / 1024).toFixed(1)} KB, ${res.mime})`;
      saveBtn.textContent = 'Saved!';
      setTimeout(() => {
        close();
        // Update green dot in-place on the row — no full reload
        const row = mainContainer?.querySelector(`tr[data-id="${msgId}"]`);
        if (row) {
          row.setAttribute('data-has-custom', '1');
          if (!row.querySelector('.custom-thumb-dot')) {
            const nameDiv = row.querySelector('.filename-display');
            if (nameDiv) {
              const dot = document.createElement('span');
              dot.className = 'custom-thumb-dot';
              dot.title = 'Has sample image';
              nameDiv.appendChild(dot);
            }
          }
          const backfillBtn = row.querySelector('.btn-backfill') as HTMLElement | null;
          if (backfillBtn) backfillBtn.style.color = 'var(--success)';
        }
      }, 800);
    } catch (err: any) {
      statusEl.style.color = 'var(--error)';
      statusEl.textContent = `✗ ${err.message}`;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Download & Save';
    }
  }

  // Capture-phase keydown on the modal overlay — catches Enter/Escape
  // before any other handler on document can see them
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopImmediatePropagation();
      doSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  }, true);  // ← capture phase

  saveBtn.addEventListener('click', doSave);
}

function attachEvents() {
  if (!mainContainer) return;

  const searchInput = mainContainer.querySelector('#search-input') as HTMLInputElement;
  searchInput?.addEventListener('input', () => {
    currentQuery = searchInput.value;
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadData(), 300);
  });

  mainContainer.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const tr = target.closest('tr') as HTMLElement | null;
    if (!tr) return;
    const idStr = tr.getAttribute('data-id');
    if (!idStr) return;
    const id = parseInt(idStr, 10);

    // Filename → open dual thumbnail modal
    if (target.closest('.log-name-link')) {
      const nameEl = tr.querySelector('.log-name-link') as HTMLElement;
      const fileName = nameEl?.textContent?.trim() || '';
      const link = tr.querySelector('a')?.getAttribute('href') || '';
      const hasCustom = tr.getAttribute('data-has-custom') === '1';
      showThumbModal(id, fileName, link, hasCustom);
      return;
    }

    // Backfill button → open set Custom modal directly
    if (target.closest('.btn-backfill')) {
      const nameEl = tr.querySelector('.log-name-link') as HTMLElement;
      showSetCustomModal(id, nameEl?.textContent?.trim() || '');
      return;
    }

    if (target.closest('.btn-grab')) {
      await performAction(tr, async () => {
        await api.grabNzb(id);
        (window as any).showToast('Sent to MagicNZB successfully', 'success');
      });
      return;
    }

    if (target.closest('.btn-ai-rename')) {
      await performAction(tr, async () => {
        const res = await api.aiRenameLog(id);
        (window as any).showToast(`Renamed to: ${res.new_name}`, 'success');
        loadData();
      });
      return;
    }

    if (target.closest('.btn-delete')) {
      if (confirm('Delete this entry from database and Telegram?')) {
        await performAction(tr, async () => {
          const link = tr.querySelector('.log-tg-link')?.getAttribute('href') || '';
          const res = await api.deleteLog(id);
          if (!res.telegram_deleted) {
            // Show modal with direct link so user can delete manually
            const m = document.createElement('div');
            m.className = 'modal-overlay';
            m.innerHTML = `
              <div class="modal" style="max-width:420px">
                <div class="modal-header">
                  <div class="modal-title" style="color:var(--error)">⚠ Telegram message not deleted</div>
                  <button class="modal-close" id="tg-warn-close">${iconX()}</button>
                </div>
                <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
                  <p style="font-size:13px;color:var(--fg-2)">The entry was removed from the database, but the Telegram message could not be deleted (bot may lack permission or the message is too old).</p>
                  ${link ? `
                    <div style="font-size:12px;color:var(--fg-3)">Delete it manually:</div>
                    <a href="${link}" target="_blank" class="btn btn-ghost" style="word-break:break-all;font-size:12px;text-align:left">${link}</a>
                  ` : ''}
                  <div style="display:flex;justify-content:flex-end">
                    <button class="btn btn-primary" id="tg-warn-close-btn">OK</button>
                  </div>
                </div>
              </div>
            `;
            document.body.appendChild(m);
            const close = () => m.remove();
            m.querySelector('#tg-warn-close')?.addEventListener('click', close);
            m.querySelector('#tg-warn-close-btn')?.addEventListener('click', close);
            m.addEventListener('click', (e) => { if (e.target === m) close(); });
          } else {
            (window as any).showToast('Entry deleted', 'success');
          }
          loadData();
          loadStats();
        });
      }
      return;
    }

    if (target.closest('.btn-rename')) {
      (tr.querySelector('.filename-display') as HTMLElement)!.style.display = 'none';
      const editDiv = tr.querySelector('.filename-edit') as HTMLElement;
      editDiv.style.display = 'flex';
      const input = editDiv.querySelector('input')!;
      input.focus();
      const dotIdx = input.value.lastIndexOf('.');
      if (dotIdx > 0) input.setSelectionRange(0, dotIdx);
      else input.select();
      return;
    }

    if (target.closest('.btn-rename-cancel')) {
      (tr.querySelector('.filename-display') as HTMLElement)!.style.display = 'block';
      (tr.querySelector('.filename-edit') as HTMLElement)!.style.display = 'none';
      return;
    }

    if (target.closest('.btn-rename-save')) {
      await saveRename(tr, id);
      return;
    }
  });

  mainContainer.addEventListener('keydown', async (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('inline-rename')) {
      const tr = target.closest('tr');
      if (!tr) return;
      if (e.key === 'Enter') {
        await saveRename(tr, parseInt(tr.getAttribute('data-id')!, 10));
      } else if (e.key === 'Escape') {
        tr.querySelector('.btn-rename-cancel')!.dispatchEvent(new Event('click', { bubbles: true }));
      }
    }
  });
}

async function performAction(tr: HTMLElement, actionFn: () => Promise<void>) {
  const actionsEl = tr.querySelector('.action-buttons') as HTMLElement;
  const loadingEl = tr.querySelector('.action-loading') as HTMLElement;
  actionsEl.style.display = 'none';
  loadingEl.style.display = 'flex';
  try {
    await actionFn();
  } catch (err: any) {
    (window as any).showToast(err.message, 'error');
  } finally {
    actionsEl.style.display = 'flex';
    loadingEl.style.display = 'none';
  }
}

async function saveRename(tr: HTMLElement, id: number) {
  const input = tr.querySelector('.inline-rename') as HTMLInputElement;
  const newName = input.value.trim();
  const nameSpan = tr.querySelector('.log-name-link') as HTMLElement;
  const oldName = nameSpan?.textContent?.trim() || '';

  if (!newName || newName === oldName) {
    tr.querySelector('.btn-rename-cancel')!.dispatchEvent(new Event('click', { bubbles: true }));
    return;
  }

  await performAction(tr, async () => {
    await api.renameLog(id, newName);

    // Update name span in-place
    if (nameSpan) nameSpan.textContent = newName;
    input.value = newName;

    // Collapse edit UI back to display
    (tr.querySelector('.filename-display') as HTMLElement).style.display = 'block';
    (tr.querySelector('.filename-edit') as HTMLElement).style.display = 'none';

    (window as any).showToast(`Renamed to: ${newName}`, 'success');
  });
}
