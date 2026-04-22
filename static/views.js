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
  spin: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>'
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

// ─── Active Transfers (/list) ─────────────────────────────────────────────────

async function loadActiveTransfers() {
  const grid = document.getElementById('active-transfers-grid');
  try {
    const res = await fetch('/api/transfers');
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || res.statusText); }
    const data = await res.json();
    _transfersData = data;
    renderActiveTransfers(data, grid);
  } catch (e) {
    grid.innerHTML = `<div class="transfers-empty"><p style="color:#f87171">Error: ${escHtml(e.message)}</p></div>`;
  }
}

function renderActiveTransfers(data, grid) {
  const running = data.running || [];
  const queued = data.queued || [];
  const errors = data.error || data.failed || [];
  const all = [...running.map(t => ({...t, _s: 'running'})), ...queued.map(t => ({...t, _s: 'queued'})), ...errors.map(t => ({...t, _s: 'error'}))];

  if (!all.length) {
    grid.innerHTML = '<div class="transfers-empty"><p>No active transfers</p></div>';
    document.getElementById('list-subtitle').textContent = 'No running or queued transfers';
    return;
  }
  document.getElementById('list-subtitle').textContent = `${running.length} running · ${queued.length} queued · ${errors.length} errors`;

  grid.innerHTML = all.map(t => {
    let prog = 0;
    try {
      const raw = parseFloat(String(t.progress || 0).replace('%', ''));
      prog = raw <= 1 && raw > 0 ? raw * 100 : raw;
    } catch(_){}
    const msg = t.message || '';
    if (prog === 0 && msg) { const m = msg.match(/(\d+(?:\.\d+)?)%/); if (m) prog = parseFloat(m[1]); }

    return `<div class="transfer-card ${t._s}">
      <div class="tc-top">
        <div class="tc-name">${escHtml(t.name || 'Unknown')}</div>
        <span class="tc-badge ${t._s}">${t._s}</span>
      </div>
      ${t._s === 'running' ? `<div class="tc-progress"><div class="tc-progress-bar"><div class="tc-progress-fill" style="width:${prog}%"></div></div></div><div class="tc-meta"><span>${prog.toFixed(1)}%</span></div>` : ''}
      ${msg ? `<div class="tc-message">${escHtml(msg)}</div>` : ''}
      <div class="tc-meta" style="margin-top:8px">
        <button class="sm-btn danger" onclick="deleteTransfer('${t.id}')">
          ${VICONS.trash} Delete
        </button>
      </div>
    </div>`;
  }).join('');
}

function startListPolling() {
  loadActiveTransfers();
  _listInterval = setInterval(() => {
    const cb = document.getElementById('auto-refresh-checkbox');
    if (cb && cb.checked) loadActiveTransfers();
  }, 5000);
}

function stopListPolling() {
  if (_listInterval) { clearInterval(_listInterval); _listInterval = null; }
}

// ─── Transfer History (/transfers) ────────────────────────────────────────────

async function loadTransferHistory() {
  const grid = document.getElementById('history-transfers-grid');
  try {
    const res = await fetch('/api/transfers');
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || res.statusText); }
    const data = await res.json();
    _transfersData = data;
    const input = document.getElementById('transfers-search-input');
    const query = input ? input.value.trim() : '';
    renderTransferHistory(data, grid, query);
  } catch (e) {
    grid.innerHTML = `<div class="transfers-empty"><p style="color:#f87171">Error: ${escHtml(e.message)}</p></div>`;
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
        const query = input.value.trim();
        renderTransferHistory(_transfersData, document.getElementById('history-transfers-grid'), query);
      }
    }, 300);
  });
}

function renderTransferHistory(data, grid, query = '') {
  const finished = data.finished || [];
  const errors = data.error || data.failed || [];
  let all = [...errors.map(t => ({...t, _s: 'error'})), ...finished.map(t => ({...t, _s: 'finished'}))];

  if (query) {
    const q = query.toLowerCase().replace(/[._\-]/g, " ");
    all = all.filter(item => (item.name || "").toLowerCase().replace(/[._\-]/g, " ").includes(q));
    const stats = document.getElementById('transfers-search-stats');
    if (stats) stats.textContent = `${all.length} results`;
  } else {
    const stats = document.getElementById('transfers-search-stats');
    if (stats) stats.textContent = '';
  }

  document.getElementById('transfers-subtitle').textContent = `${finished.length} completed · ${errors.length} failed`;

  if (!all.length) {
    grid.innerHTML = '<div class="transfers-empty"><p>No completed or failed transfers</p></div>';
    return;
  }

  grid.innerHTML = all.map(t => {
    const folderId = t.folder_id || t.id || '';
    const viewBtn = t._s === 'finished' && folderId
      ? `<button class="sm-btn primary" onclick="viewContents('${folderId}')">${VICONS.eye} View</button>` : '';
    return `<div class="transfer-card ${t._s}">
      <div class="tc-top">
        <div class="tc-name">${escHtml(t.name || 'Unknown')}</div>
        <span class="tc-badge ${t._s}">${t._s}</span>
      </div>
      ${t._s === 'error' && t.message ? `<div class="tc-message">${escHtml(t.message)}</div>` : ''}
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
      // Refresh whichever view is active
      const currentView = document.querySelector('.nav-link.active')?.dataset?.view;
      if (currentView === 'list') loadActiveTransfers();
      else if (currentView === 'transfers') loadTransferHistory();
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
    loadTransferHistory();
  } catch (e) { alert('Error: ' + e.message); }
}

// ─── View Contents Modal ──────────────────────────────────────────────────────

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
      list.innerHTML = '<div class="transfers-empty" style="height:200px"><p>No video files found</p></div>';
      return;
    }

    list.innerHTML = data.files.map(f => `
      <div class="content-file">
        <div class="cf-name">${escHtml(f.name)}</div>
        <div class="cf-size">${fmtSize(f.size)}</div>
        ${f.link ? `<button class="cf-link" onclick="copyLink(this, '${escHtml(f.link).replace(/'/g, "\\'")}')">${VICONS.link} Copy Link</button>` : ''}
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = `<div class="transfers-empty" style="height:200px"><p style="color:#f87171">${escHtml(e.message)}</p></div>`;
  }
}

function closeContentsModal() {
  document.getElementById('contents-modal').classList.remove('visible');
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
  input.addEventListener('input', () => {
    clearTimeout(_logDebounce);
    _logDebounce = setTimeout(() => doLogSearch(input.value.trim()), 400);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(_logDebounce); doLogSearch(input.value.trim()); }
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

// ─── Router ───────────────────────────────────────────────────────────────────

function initRouter() {
  const views = ['upload', 'list', 'transfers', 'log'];
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

    stopListPolling();

    if (name === 'list') startListPolling();
    else if (name === 'transfers') loadTransferHistory();
    else if (name === 'log') initLogSearch();
  }

  // Determine initial view from URL path
  const path = window.location.pathname;
  let initial = 'upload';
  if (path === '/list') initial = 'list';
  else if (path === '/transfers') initial = 'transfers';
  else if (path === '/log') initial = 'log';

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
