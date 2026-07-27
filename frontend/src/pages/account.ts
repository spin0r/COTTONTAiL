import { api } from '../api.ts';
import type { AccountInfo, HealthInfo } from '../api.ts';
import { iconUser, iconSettings, iconRefresh, iconCheck, iconX } from '../icons.ts';

let mainContainer: HTMLElement | null = null;
let healthInfo: HealthInfo | null = null;
let accountInfo: AccountInfo | null = null;
let profilesData: { profiles: string[], active: string } | null = null;

export async function renderAccount(container: HTMLElement) {
  mainContainer = container;
  
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Account & Settings</h1>
        <p class="page-subtitle">Manage MagicNZB account and system config</p>
      </div>
    </div>
    
    <div id="account-content" class="card-grid" style="display:none">
      <!-- Cards rendered via JS -->
    </div>
    <div id="account-loading" class="loading-page"><div class="spinner"></div></div>
  `;

  if (!container.dataset.eventsAttached) {
    attachEvents();
    container.dataset.eventsAttached = '1';
  }
  await loadData();
}

async function loadData() {
  if (!mainContainer) return;
  
  try {
    const [health, acc, prof] = await Promise.all([
      api.health(),
      api.account(),
      api.profiles()
    ]);
    
    healthInfo = health;
    accountInfo = acc;
    profilesData = prof;
    
    renderCards();
  } catch (err: any) {
    (window as any).showToast(err.message || 'Failed to load account data', 'error');
  }
}

function renderCards() {
  if (!mainContainer) return;
  
  const content = mainContainer.querySelector('#account-content') as HTMLElement;
  const loading = mainContainer.querySelector('#account-loading') as HTMLElement;
  
  if (!content || !loading) return;

  loading.style.display = 'none';
  content.style.display = 'grid';

  const profileOptions = profilesData?.profiles.map(p => 
    `<option value="${p}" ${p === profilesData?.active ? 'selected' : ''}>${p}</option>`
  ).join('') || '<option value="">No profiles found</option>';

  content.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title" style="display:flex;align-items:center;gap:6px">${iconUser()} MagicNZB Account</div>
        </div>
      </div>
      <div class="card-row">
        <div class="card-row-label">Email / Username</div>
        <div class="card-row-value">${accountInfo?.username || 'Unknown'}</div>
      </div>
      <div class="card-row">
        <div class="card-row-label">Time Remaining</div>
        <div class="card-row-value">${accountInfo?.days_left || 'Unknown'}</div>
      </div>
      <div class="card-row">
        <div class="card-row-label">Status</div>
        <div class="card-row-value">
          <span class="badge ${accountInfo?.status?.toLowerCase().includes('premium') ? 'badge-running' : 'badge-finished'}">${accountInfo?.status || 'Unknown'}</span>
        </div>
      </div>
      <div style="margin-top:20px">
        <button class="btn" id="btn-renew" style="width:100%;justify-content:center">${iconRefresh()} Renew Trial Account</button>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title" style="display:flex;align-items:center;gap:6px">${iconSettings()} Active Profile</div>
          <div class="card-subtitle">Switch active browser cookie profile</div>
        </div>
      </div>
      <div style="margin-top:16px">
        <label class="form-label" style="display:block;margin-bottom:6px">Select Profile</label>
        <div style="display:flex;gap:8px">
          <select class="input" id="profile-select" style="flex:1">
            ${profileOptions}
          </select>
          <button class="btn btn-primary" id="btn-switch-profile">Switch</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title" style="display:flex;align-items:center;gap:6px">${iconSettings()} System Health</div>
        </div>
      </div>
      <div class="card-row">
        <div class="card-row-label">Bot Username</div>
        <div class="card-row-value">@${healthInfo?.bot || '...'}</div>
      </div>
      <div class="card-row">
        <div class="card-row-label">API Connection</div>
        <div class="card-row-value">
          <span class="badge ${healthInfo?.connected ? 'badge-running' : 'badge-error'}">${healthInfo?.connected ? 'Online' : 'Offline'}</span>
        </div>
      </div>
      <div class="card-row">
        <div class="card-row-label">Uptime</div>
        <div class="card-row-value">${healthInfo?.uptime || '...'}</div>
      </div>
      <div style="margin-top:20px">
        <button class="btn" id="btn-change-password" style="width:100%;justify-content:center">Change Web Password</button>
      </div>
    </div>
  `;
}

function attachEvents() {
  if (!mainContainer) return;

  mainContainer.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;

    // Renew Account
    if (target.closest('#btn-renew')) {
      const btn = target.closest('#btn-renew') as HTMLButtonElement;
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner spinner-sm"></div> Renewing...';
      try {
        await api.renewAccount();
        (window as any).showToast('Account renewed successfully', 'success');
        await loadData();
      } catch (err: any) {
        (window as any).showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = `${iconRefresh()} Renew Trial Account`;
      }
      return;
    }

    // Switch Profile
    if (target.closest('#btn-switch-profile')) {
      const select = mainContainer!.querySelector('#profile-select') as HTMLSelectElement;
      const profile = select.value;
      if (!profile) return;
      
      const btn = target.closest('#btn-switch-profile') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = '...';
      
      try {
        await api.switchProfile(profile);
        (window as any).showToast(`Switched to profile: ${profile}`, 'success');
        await loadData(); // reload all data since connection state might change
      } catch (err: any) {
        (window as any).showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Switch';
      }
      return;
    }

    // Change Password Modal
    if (target.closest('#btn-change-password')) {
      showChangePasswordModal();
      return;
    }
  });
}

function showChangePasswordModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">Change Password</div>
        <button class="modal-close" id="close-modal">${iconX()}</button>
      </div>
      <div class="modal-body">
        <form id="change-pw-form">
          <div class="form-field">
            <label class="form-label">Current Password</label>
            <input type="password" class="input" id="curr-pw" required>
          </div>
          <div class="form-field">
            <label class="form-label">New Password</label>
            <input type="password" class="input" id="new-pw" required minlength="1">
          </div>
          <div class="form-field">
            <label class="form-label">Confirm Password</label>
            <input type="password" class="input" id="conf-pw" required>
          </div>
          <div class="error-text" id="pw-error"></div>
          <div class="modal-actions">
            <button type="button" class="btn" id="btn-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary" id="btn-submit">Save Password</button>
          </div>
        </form>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector('#close-modal')?.addEventListener('click', closeModal);
  modal.querySelector('#btn-cancel')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  modal.querySelector('#change-pw-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const current = (modal.querySelector('#curr-pw') as HTMLInputElement).value;
    const newPw = (modal.querySelector('#new-pw') as HTMLInputElement).value;
    const confPw = (modal.querySelector('#conf-pw') as HTMLInputElement).value;
    const errEl = modal.querySelector('#pw-error') as HTMLElement;
    const btn = modal.querySelector('#btn-submit') as HTMLButtonElement;

    if (newPw !== confPw) {
      errEl.textContent = 'New passwords do not match';
      return;
    }

    errEl.textContent = '';
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner spinner-sm"></div>';

    try {
      await api.changePassword(current, newPw);
      (window as any).showToast('Password changed successfully', 'success');
      closeModal();
    } catch (err: any) {
      errEl.textContent = err.message || 'Failed to change password';
      btn.disabled = false;
      btn.textContent = 'Save Password';
    }
  });
}
