import { api } from '../api.ts';
import type { LogEntry } from '../api.ts';
import { iconSearch, iconDownload, iconEdit, iconSparkle, iconTrash, iconCheck, iconX, iconClipboard } from '../icons.ts';
import { fmtDate } from '../api.ts';

let mainContainer: HTMLElement | null = null;
let currentQuery = '';
let searchTimeout: ReturnType<typeof setTimeout> | undefined;

export function cleanupLogs() {
  // Don't null mainContainer — preserve DOM to avoid flicker on revisit
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
                <th style="width:140px">Actions</th>
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
  } catch {
    // ignore
  }
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

  const tbody = mainContainer.querySelector('#logs-tbody');
  const empty = mainContainer.querySelector('#logs-empty') as HTMLElement;
  const tableWrap = mainContainer.querySelector('.table-wrap') as HTMLElement;

  if (!tbody || !empty || !tableWrap) return;

  if (logs.length === 0) {
    tableWrap.style.display = 'none';
    empty.style.display = 'block';
    empty.innerHTML = `
      <div class="empty">
        ${iconClipboard()}
        <p>No results found.</p>
      </div>
    `;
    return;
  }

  tableWrap.style.display = 'block';
  empty.style.display = 'none';

  tbody.innerHTML = logs.map(l => {
    // uploaded_at is typically a timestamp or string, try to parse robustly
    let dateStr = l.uploaded_at;
    if (!isNaN(Number(l.uploaded_at))) {
      dateStr = fmtDate(Number(l.uploaded_at));
    } else {
      try { dateStr = new Date(l.uploaded_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); } catch {}
    }

    return `
      <tr data-id="${l.msg_id}">
        <td>
          <div class="cell-name filename-display">
            ${l.link ? `<a href="${l.link}" target="_blank" style="text-decoration:underline;color:var(--fg)">${l.file_name}</a>` : l.file_name}
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

function attachEvents() {
  if (!mainContainer) return;

  const searchInput = mainContainer.querySelector('#search-input') as HTMLInputElement;
  
  searchInput?.addEventListener('input', () => {
    currentQuery = searchInput.value;
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      loadData();
    }, 300);
  });

  mainContainer.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const tr = target.closest('tr');
    if (!tr) return;
    const idStr = tr.getAttribute('data-id');
    if (!idStr) return;
    const id = parseInt(idStr, 10);

    // Grab
    if (target.closest('.btn-grab')) {
      await performAction(tr, async () => {
        await api.grabNzb(id);
        (window as any).showToast('Sent to MagicNZB successfully', 'success');
      });
      return;
    }

    // AI Rename
    if (target.closest('.btn-ai-rename')) {
      await performAction(tr, async () => {
        const res = await api.aiRenameLog(id);
        (window as any).showToast(`Renamed to: ${res.new_name}`, 'success');
        loadData();
      });
      return;
    }

    // Delete
    if (target.closest('.btn-delete')) {
      if (confirm('Delete this entry from database and Telegram?')) {
        await performAction(tr, async () => {
          await api.deleteLog(id);
          (window as any).showToast('Entry deleted', 'success');
          loadData();
          loadStats();
        });
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
      await saveRename(tr, id);
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
  const oldName = tr.querySelector('.filename-display')?.textContent?.trim() || '';
  
  if (!newName || newName === oldName) {
    tr.querySelector('.btn-rename-cancel')!.dispatchEvent(new Event('click', { bubbles: true }));
    return;
  }

  await performAction(tr, async () => {
    await api.renameLog(id, newName);
    loadData();
  });
}
