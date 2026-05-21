// === Views: Active Transfers, Transfer History, Log Search ===

let _listInterval = null;
let _transfersData = null;

const VICONS = {
  refresh: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  eye: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  trash: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  grab: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  link: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  check: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  spin: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>',
  edit: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  save: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
  wand: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8L19 13"/><path d="M15 9h.01"/><path d="M17.8 6.2L19 5"/><path d="M11 6.2L9.7 5"/><path d="M11 11.8l-1.3 1.2"/><path d="M3 21l9-9"/></svg>'
};

function fmtSize(b) {
  if (!b) return '?';
  const n = parseInt(b, 10);
  if (isNaN(n)) return '?';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Transfers (single flat list) ─────────────────────────────────────────────

function startTransfersPolling() {
  _listInterval = setInterval(() => {
    const cb = document.getElementById('auto-refresh-checkbox');
    if (cb && cb.checked) loadTransfersPage();
  }, 5000);
}

function stopTransfersPolling() {
  if (_listInterval) { clearInterval(_listInterval); _listInterval = null; }
}

async function loadTransfersPage() {
  const grid = document.getElementById('transfers-grid');
  const subtitle = document.getElementById('transfers-subtitle');

  try {
    const res = await fetch('/api/transfers');
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || res.statusText); }
    const data = await res.json();
    _transfersData = data;

    const input = document.getElementById('transfers-search-input');
    const query = input ? input.value.trim() : '';
    renderTransfers(data, grid, query);

    // Update subtitle counts
    const running = (data.running || []).length;
    const queued = (data.queued || []).length;
    const finished = (data.finished || []).length;
    const errors = (data.error || data.failed || []).length;
    if (subtitle) subtitle.textContent = `${running + queued} active · ${finished} completed · ${errors} failed`;
  } catch (e) {
    if (grid) grid.innerHTML = `<div class="transfers-empty"><p style="color:#f87171">Error: ${escHtml(e.message)}</p></div>`;
  }
}

let _transfersSearchDebounce = null;
function initTransferHistorySearch() {
  const input = document.getElementById('transfers-search-input');
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(_transfersSearchDebounce);
    _transfersSearchDebounce = setTimeout(() => {
      if (_transfersData) {
        renderTransfers(_transfersData, document.getElementById('transfers-grid'), input.value.trim());
      }
    }, 300);
  });
}

function renderTransfers(data, grid, query = '') {
  const running = (data.running || []).map(t => ({...t, _s: 'running'}));
  const queued  = (data.queued  || []).map(t => ({...t, _s: 'queued'}));
  const errors  = (data.error || data.failed || []).map(t => ({...t, _s: 'error'}));
  const finished = (data.finished || []).map(t => ({...t, _s: 'finished'}));

  // Running first, then queued, errors, finished
  let all = [...running, ...queued, ...errors, ...finished];

  // Filter by search query
  if (query) {
    const q = query.toLowerCase().replace(/[._\-]/g, " ");
    all = all.filter(item => (item.name || "").toLowerCase().replace(/[._\-]/g, " ").includes(q));
    const stats = document.getElementById('transfers-search-stats');
    if (stats) stats.textContent = `${all.length} results`;
  } else {
    const stats = document.getElementById('transfers-search-stats');
    if (stats) stats.textContent = '';
  }

  if (!all.length) {
    grid.innerHTML = '<div class="transfers-empty"><p>No transfers</p></div>';
    return;
  }

  grid.innerHTML = all.map(t => {
    // Progress bar for running transfers
    let progHtml = '';
    if (t._s === 'running') {
      let prog = 0;
      try {
        const raw = parseFloat(String(t.progress || 0).replace('%', ''));
        prog = raw <= 1 && raw > 0 ? raw * 100 : raw;
      } catch(_){}
      const msg = t.message || '';
      if (prog === 0 && msg) { const m = msg.match(/(\d+(?:\.\d+)?)%/); if (m) prog = parseFloat(m[1]); }
      progHtml = `<div class="tc-progress"><div class="tc-progress-bar"><div class="tc-progress-fill" style="width:${prog}%"></div></div></div><div class="tc-meta"><span>${prog.toFixed(1)}%</span></div>`;
    }

    // View button for finished transfers
    const folderId = t.folder_id || t.id || '';
    const viewBtn = t._s === 'finished' && folderId
      ? `<button class="sm-btn primary" onclick="viewContents('${folderId}')">${VICONS.eye} View</button>` : '';

    // Error message
    const msgHtml = (t._s === 'error' || t._s === 'running') && t.message
      ? `<div class="tc-message">${escHtml(t.message)}</div>` : '';

    return `<div class="transfer-card ${t._s}">
      <div class="tc-top">
        <div class="tc-name">${escHtml(t.name || 'Unknown')}</div>
        <span class="tc-badge ${t._s}">${t._s}</span>
      </div>
      ${progHtml}
      ${msgHtml}
      <div class="tc-meta" style="margin-top:8px">
        ${viewBtn}
        <button class="sm-btn danger" onclick="deleteTransfer('${t.id}')">${VICONS.trash} Delete</button>
      </div>
    </div>`;
  }).join('');
}

// ─── Shared: Delete Transfer ──────────────────────────────────────────────────

async function deleteTransfer(id) {
  if (!id) return;
  try {
    const res = await fetch(`/api/transfers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      loadTransfersPage();
    } else {
      const d = await res.json();
      alert(d.error || 'Delete failed');
    }
  } catch (e) { alert('Error: ' + e.message); }
}

async function deleteAllTransfers() {
  if (!confirm('Delete ALL transfers? This cannot be undone.')) return;
  try {
    const res = await fetch('/api/transfers');
    if (!res.ok) return;
    const data = await res.json();
    const ids = [];
    for (const k of ['running','queued','finished','error']) {
      for (const t of (data[k] || [])) { if (t.id) ids.push(t.id); }
    }
    let ok = 0;
    for (const id of ids) {
      try {
        const r = await fetch(`/api/transfers/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (r.ok) ok++;
      } catch(_){}
    }
    alert(`Deleted ${ok}/${ids.length}`);
    loadTransfersPage();
  } catch (e) { alert('Error: ' + e.message); }
}

// ─── View Contents Modal ──────────────────────────────────────────────────────

const IMAGE_EXTS = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;

async function viewContents(folderId) {
  const modal = document.getElementById('contents-modal');
  const list = document.getElementById('contents-list');
  const title = document.getElementById('contents-modal-title');

  title.textContent = 'Loading...';
  list.innerHTML = '<div class="transfers-empty" style="height:200px"><p>Fetching files...</p></div>';
  modal.classList.add('visible');

  try {
    const res = await fetch(`/api/transfers/${encodeURIComponent(folderId)}/contents`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed');

    title.textContent = `Files (${data.total})`;

    if (!data.files.length) {
      list.innerHTML = '<div class="transfers-empty" style="height:200px"><p>No files found</p></div>';
      return;
    }

    list.innerHTML = data.files.map(f => {
      const isImage = IMAGE_EXTS.test(f.name);
      let previewHtml = '';
      if (isImage && f.link) {
        previewHtml = `<div class="cf-preview">
          <img src="${escHtml(f.link)}" alt="${escHtml(f.name)}" loading="lazy"
               onclick="openImageLightbox('${escHtml(f.link).replace(/'/g, "\\'")}')" />
        </div>`;
      }
      return `<div class="content-file${isImage ? ' has-preview' : ''}">
        ${previewHtml}
        <div class="cf-info">
          <div class="cf-name">${escHtml(f.name)}</div>
          <div class="cf-size">${fmtSize(f.size)}</div>
        </div>
        ${f.link ? `<button class="cf-link" onclick="copyLink(this, '${escHtml(f.link).replace(/'/g, "\\'")}')">${VICONS.link} Copy Link</button>` : ''}
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div class="transfers-empty" style="height:200px"><p style="color:#f87171">${escHtml(e.message)}</p></div>`;
  }
}

function closeContentsModal() {
  document.getElementById('contents-modal').classList.remove('visible');
}

// Close modal on ESC key (lightbox takes priority)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const lightbox = document.getElementById('image-lightbox');
    if (lightbox && lightbox.classList.contains('visible')) {
      closeImageLightbox();
      return;
    }
    const modal = document.getElementById('contents-modal');
    if (modal && modal.classList.contains('visible')) {
      closeContentsModal();
    }
  }
});

// Close modal on clicking the overlay (outside the modal content)
document.addEventListener('click', (e) => {
  const modal = document.getElementById('contents-modal');
  if (modal && modal.classList.contains('visible') && e.target === modal) {
    closeContentsModal();
  }
});

// ─── Image Lightbox ───────────────────────────────────────────────────────────

function openImageLightbox(url) {
  let lightbox = document.getElementById('image-lightbox');
  if (!lightbox) {
    lightbox = document.createElement('div');
    lightbox.id = 'image-lightbox';
    lightbox.className = 'lightbox-overlay';
    lightbox.innerHTML = `<img class="lightbox-img" />`;
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeImageLightbox();
    });
    document.body.appendChild(lightbox);
  }
  const img = lightbox.querySelector('.lightbox-img');
  img.src = url;
  lightbox.classList.add('visible');
}

function closeImageLightbox() {
  const lightbox = document.getElementById('image-lightbox');
  if (lightbox) lightbox.classList.remove('visible');
}

function copyLink(btn, url) {
  navigator.clipboard.writeText(url).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = VICONS.check + ' Copied!';
    btn.style.color = '#4ade80';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 1500);
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    const orig = btn.innerHTML;
    btn.innerHTML = VICONS.check + ' Copied!';
    btn.style.color = '#4ade80';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 1500);
  });
}

// ─── Log Search (/log) ────────────────────────────────────────────────────────

let _logDebounce = null;

function initLogSearch() {
  const input = document.getElementById('log-search-input');
  if (!input) return;
  const kbd = document.getElementById('log-search-kbd');
  input.addEventListener('input', () => {
    clearTimeout(_logDebounce);
    _logDebounce = setTimeout(() => doLogSearch(input.value.trim()), 400);
    if (kbd) kbd.style.display = 'none';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(_logDebounce); doLogSearch(input.value.trim()); }
  });
  input.addEventListener('focus', () => { if (kbd) kbd.style.display = 'none'; });
  input.addEventListener('blur', () => {
    if (kbd && !input.value) {
      const stats = document.getElementById('log-search-stats');
      if (!stats || !stats.textContent) kbd.style.display = '';
    }
  });
  // Load stats
  fetch('/api/logs/stats').then(r => r.json()).then(d => {
    document.getElementById('log-subtitle').textContent = `${(d.total || 0).toLocaleString()} files indexed`;
  }).catch(() => {});

  // Load recent logs initially
  doLogSearch('');
}

async function doLogSearch(query) {
  const results = document.getElementById('log-results');
  const stats = document.getElementById('log-search-stats');
  const isRecent = !query || query.length < 2;

  stats.textContent = isRecent ? 'Loading recent...' : 'Searching...';

  try {
    const res = await fetch(`/api/logs?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Search failed');

    stats.textContent = `${data.total} results`;

    if (!data.results.length) {
      if (isRecent) {
        results.innerHTML = `<div class="log-empty"><p>No indexed files yet</p></div>`;
      } else {
        results.innerHTML = `<div class="log-empty"><p>No results for "${escHtml(query)}"</p></div>`;
      }
      return;
    }

    results.innerHTML = data.results.map(r => {
      const name = r.caption?.trim() || r.file_name || 'untitled';
      const date = r.uploaded_at ? new Date(r.uploaded_at).toLocaleDateString() : '';
      return `<div class="log-item">
        <div class="li-info">
          <div class="li-name">${escHtml(name)}</div>
          <div class="li-meta">
            ${date ? `<span>${date}</span>` : ''}
            <a href="${escHtml(r.link)}" target="_blank" style="color:#ff5b04;text-decoration:none">TG Link</a>
          </div>
        </div>
        <div class="li-actions">
          <button class="sm-btn" title="AI Rename" onclick="aiRenameLog(${r.msg_id}, this)"
            style="background:transparent;color:#a78bfa;padding:6px;min-width:auto">
            ${VICONS.wand}
          </button>
          <button class="sm-btn" title="Rename" onclick="startLogEdit(this, ${r.msg_id}, '${escHtml(name).replace(/'/g, "\\'")}')"
            style="background:transparent;color:var(--muted);padding:6px;min-width:auto">
            ${VICONS.edit}
          </button>
          <button class="sm-btn" title="Delete" onclick="deleteLogEntry(${r.msg_id}, this)"
            style="background:transparent;color:var(--muted);padding:6px;min-width:auto">
            ${VICONS.trash}
          </button>
          <button class="sm-btn primary" id="grab-${r.msg_id}" onclick="grabNzb(${r.msg_id}, this)">
            ${VICONS.grab} Grab
          </button>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    stats.textContent = '';
    results.innerHTML = `<div class="log-empty"><p style="color:#f87171">${escHtml(e.message)}</p></div>`;
  }
}

function startLogEdit(btn, msgId, currentName) {
  const item = btn.closest('.log-item');
  const nameEl = item.querySelector('.li-name');
  const baseName = currentName.replace(/\.nzb$/i, '');

  nameEl.outerHTML = `<input type="text" class="edit-input" value="${baseName}" />`;
  const input = item.querySelector('.edit-input');
  input.focus();
  input.select();

  // Replace the edit button with a save button
  btn.outerHTML = `<button class="sm-btn" title="Save" onclick="saveLogEdit(this, ${msgId})"
    style="background:transparent;color:#4ade80;padding:6px;min-width:auto">
    ${VICONS.save}
  </button>`;

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') item.querySelector('[title=Save]').click();
    if (e.key === 'Escape') {
      const searchInput = document.getElementById('log-search-input');
      doLogSearch(searchInput ? searchInput.value.trim() : '');
    }
  });
}

async function saveLogEdit(btn, msgId) {
  const item = btn.closest('.log-item');
  const input = item.querySelector('.edit-input');
  let newName = (input?.value || '').trim();

  if (!newName) {
    const searchInput = document.getElementById('log-search-input');
    doLogSearch(searchInput ? searchInput.value.trim() : '');
    return;
  }

  btn.innerHTML = VICONS.spin;

  try {
    const res = await fetch(`/api/logs/${msgId}/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_name: newName }),
    });
    const data = await res.json();

    if (res.ok && data.success) {
      // Refresh results
      const searchInput = document.getElementById('log-search-input');
      doLogSearch(searchInput ? searchInput.value.trim() : '');
    } else {
      alert(data.error || 'Rename failed');
      const searchInput = document.getElementById('log-search-input');
      doLogSearch(searchInput ? searchInput.value.trim() : '');
    }
  } catch (e) {
    alert('Network error: ' + e.message);
    const searchInput = document.getElementById('log-search-input');
    doLogSearch(searchInput ? searchInput.value.trim() : '');
  }
}

async function grabNzb(msgId, btn) {
  if (btn.classList.contains('loading') || btn.classList.contains('success')) return;
  btn.classList.add('loading');
  btn.innerHTML = VICONS.spin + ' Grabbing...';

  try {
    const res = await fetch(`/api/grab/${msgId}`, { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      btn.classList.remove('loading');
      btn.classList.add('success');
      btn.innerHTML = VICONS.check + ' Done';
    } else {
      throw new Error(data.error || 'Failed');
    }
  } catch (e) {
    btn.classList.remove('loading');
    btn.innerHTML = VICONS.grab + ' Retry';
    btn.title = e.message;
  }
}

async function deleteLogEntry(msgId, btn) {
  if (!confirm('Delete this entry from the log group and database?')) return;

  const item = btn.closest('.log-item');
  btn.innerHTML = VICONS.spin;
  btn.style.color = '#f87171';

  try {
    const res = await fetch(`/api/logs/${msgId}`, { method: 'DELETE' });
    const data = await res.json();

    if (res.ok && data.success) {
      // Animate removal
      item.style.transition = 'opacity 0.3s, transform 0.3s';
      item.style.opacity = '0';
      item.style.transform = 'translateX(20px)';
      setTimeout(() => {
        item.remove();
        // Update stats count
        const stats = document.getElementById('log-search-stats');
        if (stats) {
          const match = stats.textContent.match(/(\d+)/);
          if (match) stats.textContent = `${Math.max(0, parseInt(match[1]) - 1)} results`;
        }
      }, 300);
    } else {
      alert(data.error || 'Delete failed');
      btn.innerHTML = VICONS.trash;
      btn.style.color = 'var(--muted)';
    }
  } catch (e) {
    alert('Network error: ' + e.message);
    btn.innerHTML = VICONS.trash;
    btn.style.color = 'var(--muted)';
  }
}

async function aiRenameLog(msgId, btn) {
  const item = btn.closest('.log-item');
  const nameEl = item.querySelector('.li-name');
  const origIcon = btn.innerHTML;

  btn.innerHTML = VICONS.spin;
  btn.style.color = '#a78bfa';
  btn.disabled = true;

  try {
    const res = await fetch(`/api/logs/${msgId}/ai-rename`, { method: 'POST' });
    const data = await res.json();

    if (res.ok && data.success) {
      // Show success with the new name
      btn.innerHTML = VICONS.check;
      btn.style.color = '#4ade80';
      if (nameEl) nameEl.textContent = data.new_name;

      // Update the edit button's onclick so it uses the new name
      const editBtn = item.querySelector('[title="Rename"]');
      if (editBtn) {
        const safeName = data.new_name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        editBtn.setAttribute('onclick', `startLogEdit(this, ${msgId}, '${safeName}')`);
      }

      // Reset icon after a moment
      setTimeout(() => {
        btn.innerHTML = origIcon;
        btn.style.color = '#a78bfa';
        btn.disabled = false;
      }, 2000);
    } else {
      throw new Error(data.error || 'AI rename failed');
    }
  } catch (e) {
    btn.innerHTML = origIcon;
    btn.style.color = '#f87171';
    btn.title = 'Failed: ' + e.message;
    btn.disabled = false;
    setTimeout(() => { btn.style.color = '#a78bfa'; btn.title = 'AI Rename'; }, 3000);
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

function initRouter() {
  const views = ['upload', 'transfers', 'log', 'account'];
  const navLinks = document.querySelectorAll('.nav-link');

  function showView(name) {
    views.forEach(v => {
      const el = document.getElementById('view-' + v);
      if (el) el.classList.toggle('hidden', v !== name);
    });
    navLinks.forEach(l => l.classList.toggle('active', l.dataset.view === name));

    // Re-trigger fade animation on the active view
    const activeEl = document.getElementById('view-' + name);
    if (activeEl) {
      activeEl.style.animation = 'none';
      activeEl.offsetHeight; // force reflow
      activeEl.style.animation = '';
    }

    stopTransfersPolling();

    if (name === 'transfers') { loadTransfersPage(); startTransfersPolling(); }
    else if (name === 'log') initLogSearch();
    else if (name === 'account') loadAccountPage();
  }

  // Determine initial view from URL path
  const path = window.location.pathname;
  let initial = 'upload';
  if (path === '/list' || path === '/transfers') initial = 'transfers';
  else if (path === '/log') initial = 'log';
  else if (path === '/account') initial = 'account';

  // Nav link click handler
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const view = link.dataset.view;
      const href = link.getAttribute('href');
      history.pushState({ view }, '', href);
      showView(view);
    });
  });

  // Handle browser back/forward
  window.addEventListener('popstate', (e) => {
    const view = e.state?.view || 'upload';
    showView(view);
  });

  // Set initial state
  history.replaceState({ view: initial }, '', window.location.pathname);
  showView(initial);

  // Press "/" — jump to Log Search from any tab (like GitHub/YouTube)
  document.addEventListener('keydown', (e) => {
    // Ignore if typing in an input or textarea
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === '/') {
      e.preventDefault();
      history.pushState({ view: 'log' }, '', '/log');
      showView('log');
      setTimeout(() => {
        const input = document.getElementById('log-search-input');
        if (input) { input.focus(); input.select(); }
      }, 50);
    }
  });
}

// ─── Nav Status ───────────────────────────────────────────────────────────────

let _lastNavData = null;
let _navUptimeSec = 0;

function formatUptime(totalSecs) {
  const d = Math.floor(totalSecs / 86400);
  const h = Math.floor((totalSecs % 86400) / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

function renderNavStatusText() {
  const txt = document.getElementById('nav-status-text');
  if (!_lastNavData) return;
  const d = _lastNavData;
  const formattedUptime = formatUptime(_navUptimeSec);
  
  let profileHtml = '';
  if (d.profile && d.profile !== 'none') {
    let label = d.profile;
    if (d.email) label += ` (${d.email})`;
    profileHtml = ` · <span class="profile-name" id="profile-name-btn">${escHtml(label)}</span>`;
  }
  
  txt.innerHTML = `@${escHtml(d.bot)}${profileHtml} · ${formattedUptime}`;
  
  // Re-bind click handler for profile name
  const profileBtn = document.getElementById('profile-name-btn');
  if (profileBtn) {
    profileBtn.onclick = (e) => {
      e.stopPropagation();
      toggleProfileDropdown();
    };
  }
  
  const sidebarUptime = document.getElementById('sidebar-uptime');
  if (sidebarUptime) sidebarUptime.textContent = formattedUptime;
}

async function toggleProfileDropdown() {
  const dropdown = document.getElementById('profile-dropdown');
  if (!dropdown) return;
  
  if (!dropdown.classList.contains('hidden')) {
    dropdown.classList.add('hidden');
    return;
  }
  
  dropdown.classList.remove('hidden');
  const list = document.getElementById('profile-list');
  list.innerHTML = '<div style="padding:10px 14px;color:var(--muted);font-size:0.85rem">Loading profiles...</div>';
  
  try {
    const res = await fetch('/api/profiles');
    const data = await res.json();
    if (!data.profiles || !data.profiles.length) {
      list.innerHTML = '<div style="padding:10px 14px;color:var(--muted);font-size:0.85rem">No profiles found</div>';
      return;
    }
    list.innerHTML = data.profiles.map(p => {
      const name = typeof p === 'string' ? p : p.name;
      const isActive = name === data.active;
      return `<div class="profile-option${isActive ? ' active' : ''}" data-profile="${escHtml(name)}">${escHtml(name)}</div>`;
    }).join('');
    
    list.querySelectorAll('.profile-option').forEach(opt => {
      opt.addEventListener('click', async () => {
        const name = opt.dataset.profile;
        if (opt.classList.contains('active') || opt.classList.contains('switching')) return;
        opt.classList.add('switching');
        opt.textContent = name + ' — switching...';
        try {
          const r = await fetch('/api/profiles/switch', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name })
          });
          const d = await r.json();
          if (r.ok && d.success) {
            await updateNavStatus();
            dropdown.classList.add('hidden');
          } else {
            opt.textContent = name + ' — error!';
            opt.classList.remove('switching');
          }
        } catch (e) {
          opt.textContent = name + ' — failed';
          opt.classList.remove('switching');
        }
      });
    });
  } catch (e) {
    list.innerHTML = '<div style="padding:10px 14px;color:var(--error);font-size:0.85rem">Error loading profiles</div>';
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('profile-dropdown');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    const navStatus = document.getElementById('nav-status');
    if (!navStatus.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  }
});

async function updateNavStatus() {
  const dot = document.querySelector('.status-dot');
  const txt = document.getElementById('nav-status-text');
  try {
    const res = await fetch('/health');
    const d = await res.json();
    if (res.ok && d.status === 'ok') {
      dot.className = 'status-dot online';
      _lastNavData = d;
      _navUptimeSec = d.uptimeSec || 0;
      renderNavStatusText();
    } else {
      dot.className = 'status-dot offline';
      txt.textContent = 'Offline';
      _lastNavData = null;
    }
  } catch (_) {
    dot.className = 'status-dot offline';
    txt.textContent = 'Disconnected';
    _lastNavData = null;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initRouter();
  updateNavStatus();
  initTransferHistorySearch();
  
  // Background sync every 30s
  setInterval(updateNavStatus, 30000);
  
  // Local live tick every 1s
  setInterval(() => {
    if (_lastNavData) {
      _navUptimeSec++;
      renderNavStatusText();
    }
  }, 1000);

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login';
      } catch (e) {
        console.error('Logout failed', e);
      }
    });
  }
});

// ─── Account Page ─────────────────────────────────────────────────────────────

async function loadAccountPage() {
  const emailVal = document.getElementById('account-email-val');
  const expiryVal = document.getElementById('account-expiry-val');
  const trafficVal = document.getElementById('account-traffic-val');
  const profileVal = document.getElementById('account-profile-val');
  const subtitle = document.getElementById('account-subtitle');

  // Set loading state
  if (emailVal) emailVal.textContent = 'Loading...';
  if (expiryVal) expiryVal.textContent = 'Loading...';
  if (trafficVal) trafficVal.textContent = 'Loading...';
  if (profileVal) profileVal.textContent = 'Loading...';

  // Fetch health for profile info
  try {
    const hRes = await fetch('/health');
    const hData = await hRes.json();
    if (hRes.ok && hData.status === 'ok') {
      if (profileVal) profileVal.textContent = hData.profile || 'none';
    }
  } catch (_) {
    if (profileVal) profileVal.textContent = 'Unavailable';
  }

  // Fetch account info
  try {
    const res = await fetch('/api/account');
    const data = await res.json();
    if (res.ok) {
      if (emailVal) emailVal.textContent = data.username || 'Unknown';
      if (expiryVal) expiryVal.textContent = data.days_left || 'Unknown';
      if (trafficVal) trafficVal.textContent = data.status || 'Unlimited';
      if (subtitle) subtitle.textContent = data.username ? `Logged in as ${data.username}` : 'MagicNZB account details';
    } else {
      const err = data.error || 'Could not fetch account info';
      if (emailVal) emailVal.textContent = 'Error';
      if (expiryVal) expiryVal.textContent = 'Error';
      if (trafficVal) trafficVal.textContent = 'Error';
      if (subtitle) subtitle.textContent = err;
    }
  } catch (e) {
    if (emailVal) emailVal.textContent = 'Offline';
    if (expiryVal) expiryVal.textContent = 'Offline';
    if (trafficVal) trafficVal.textContent = 'Offline';
    if (subtitle) subtitle.textContent = 'Could not connect';
  }
}

async function renewAccount() {
  const btn = document.getElementById('renew-btn');
  const statusEl = document.getElementById('renew-status');
  if (!btn) return;

  btn.disabled = true;
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Renewing...`;
  btn.classList.add('renewing');
  if (statusEl) { statusEl.textContent = ''; statusEl.className = 'renew-status'; }

  try {
    const res = await fetch('/api/account/renew', { method: 'POST' });
    const data = await res.json();

    if (res.ok && data.success) {
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Renewed!`;
      btn.classList.remove('renewing');
      btn.classList.add('renewed');
      if (statusEl) {
        statusEl.textContent = 'Free trial renewed successfully!';
        statusEl.className = 'renew-status success';
      }
      // Refresh account data
      setTimeout(() => loadAccountPage(), 1500);
    } else {
      throw new Error(data.error || 'Renewal failed');
    }
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = e.message;
      statusEl.className = 'renew-status error';
    }
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove('renewing', 'renewed');
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Renew Expiry`;
    }, 3000);
  }
}
