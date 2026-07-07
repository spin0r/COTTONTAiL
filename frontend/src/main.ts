import './index.css';
import { api } from './api.ts';
import type { HealthInfo } from './api.ts';
import { iconRefresh, iconLogout, iconActivity, iconFile, iconFolder, iconClipboard, iconUser } from './icons.ts';
import { renderLogin } from './pages/login.ts';
import { renderTransfers, cleanupTransfers } from './pages/transfers.ts';
import { renderFiles, cleanupFiles } from './pages/files.ts';
import { renderLogs } from './pages/logs.ts';
import { renderAccount } from './pages/account.ts';

// ─── Toast system ────────────────────────────────────────────────
export function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(8px)';
    el.style.transition = '200ms ease';
    setTimeout(() => el.remove(), 200);
  }, 3000);
}

// Make globally accessible for page modules
(window as any).showToast = showToast;

// ─── Router ──────────────────────────────────────────────────────
type Route = 'transfers' | 'files' | 'logs' | 'account';

function getRoute(): Route {
  const hash = location.hash.replace('#/', '').split('?')[0];
  if (['transfers', 'files', 'logs', 'account'].includes(hash)) return hash as Route;
  return 'files';
}

function navigate(route: Route) {
  location.hash = `#/${route}`;
}

// ─── App shell ───────────────────────────────────────────────────
let healthInfo: HealthInfo | null = null;
let statusInterval: ReturnType<typeof setInterval> | undefined;

function renderNav(currentRoute: Route): string {
  const links: { route: Route; label: string; icon: () => string }[] = [
    { route: 'files', label: 'Files', icon: iconFolder },
    { route: 'transfers', label: 'Transfers', icon: iconActivity },
    { route: 'logs', label: 'Logs', icon: iconClipboard },
    { route: 'account', label: 'Account', icon: iconUser },
  ];

  const navLinks = links.map(l =>
    `<a class="nav-link ${l.route === currentRoute ? 'active' : ''}" data-route="${l.route}">${l.icon()}${l.label}</a>`
  ).join('');

  const statusDot = healthInfo?.connected ? 'online' : '';
  const botName = healthInfo?.bot || '...';

  return `
    <nav class="nav">
      <div class="nav-brand">COTTON<span>TAiL</span></div>
      <div class="nav-links">${navLinks}</div>
      <div class="nav-right">
        <div class="status-pill">
          <span class="status-dot ${statusDot}"></span>
          <span>${botName}</span>
        </div>
        <button class="nav-btn" id="nav-logout">${iconLogout()} Logout</button>
      </div>
    </nav>
    <nav class="mobile-nav">
      <div class="mobile-nav-links">
        ${links.map(l => `<a class="mobile-nav-link ${l.route === currentRoute ? 'active' : ''}" data-route="${l.route}">${l.icon()}<span>${l.label}</span></a>`).join('')}
      </div>
    </nav>
  `;
}

async function refreshStatus() {
  try {
    healthInfo = await api.health();
    // Update status pill without full re-render
    const dot = document.querySelector('.status-dot');
    const name = document.querySelector('.status-pill span:last-child');
    if (dot) dot.className = `status-dot ${healthInfo.connected ? 'online' : ''}`;
    if (name) name.textContent = healthInfo.bot || '...';
  } catch {
    // silently fail
  }
}

function cleanupCurrentPage() {
  cleanupTransfers();
  cleanupFiles();
}

async function renderPage(route: Route) {
  const content = document.getElementById('page-content');
  if (!content) return;

  // Create persistent per-page containers so switching tabs never destroys DOM
  const pageIds: Route[] = ['transfers', 'files', 'logs', 'account'];
  for (const id of pageIds) {
    if (!document.getElementById(`page-${id}`)) {
      const div = document.createElement('div');
      div.id = `page-${id}`;
      div.style.display = 'none';
      content.appendChild(div);
    }
    const el = document.getElementById(`page-${id}`)!;
    el.style.display = id === route ? 'block' : 'none';
  }

  const target = document.getElementById(`page-${route}`)!;

  switch (route) {
    case 'transfers':
      await renderTransfers(target);
      break;
    case 'files':
      await renderFiles(target);
      break;
    case 'logs':
      await renderLogs(target);
      break;
    case 'account':
      await renderAccount(target);
      break;
  }
}

function bootApp() {
  const app = document.getElementById('app')!;
  const route = getRoute();

  app.innerHTML = `
    ${renderNav(route)}
    <div class="page">
      <div class="content" id="page-content">
      </div>
    </div>
  `;

  // Nav link clicks
  app.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement).closest('[data-route]');
    if (link) {
      e.preventDefault();
      navigate(link.getAttribute('data-route') as Route);
    }
  });

  // Logout
  document.getElementById('nav-logout')?.addEventListener('click', async () => {
    try {
      await api.logout();
    } catch { /* ignore */ }
    location.reload();
  });

  // Arrow key tab switching
  const routes: Route[] = ['files', 'transfers', 'logs', 'account'];
  document.addEventListener('keydown', (e) => {
    // Don't intercept when typing in an input/textarea
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    // Don't switch tabs when a modal is open
    if (document.querySelector('.modal-overlay')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const current = getRoute();
      const idx = routes.indexOf(current);
      if (e.key === 'ArrowRight') navigate(routes[(idx + 1) % routes.length]);
      else navigate(routes[(idx - 1 + routes.length) % routes.length]);
    }
  });

  // Listen to hash changes
  window.addEventListener('hashchange', () => {
    const newRoute = getRoute();
    // Re-render nav to update active state
    const navEl = app.querySelector('.nav');
    const mobileNav = app.querySelector('.mobile-nav');
    if (navEl) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = renderNav(newRoute);
      navEl.replaceWith(tempDiv.querySelector('.nav')!);
      mobileNav?.replaceWith(tempDiv.querySelector('.mobile-nav')!);
      // Re-attach logout
      document.getElementById('nav-logout')?.addEventListener('click', async () => {
        try { await api.logout(); } catch { /* ignore */ }
        location.reload();
      });
      // Re-attach nav clicks
      document.querySelectorAll('[data-route]').forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          navigate(link.getAttribute('data-route') as Route);
        });
      });
    }
    renderPage(newRoute);
  });

  // Initial page render
  renderPage(route);

  // Status polling
  refreshStatus();
  statusInterval = setInterval(refreshStatus, 30000);
}

// ─── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const app = document.getElementById('app')!;

  // Show loading
  app.innerHTML = '<div class="loading-page"><div class="spinner"></div></div>';

  // Check auth first — /health is public and always succeeds, so we must
  // call an authenticated endpoint to know if we have a valid session.
  const isAuthed = await api.authCheck().then(() => true).catch(() => false);

  if (!isAuthed) {
    renderLogin(app);
    return;
  }

  try {
    healthInfo = await api.health();
  } catch { /* non-fatal, bot info just won't show */ }

  bootApp();
});
