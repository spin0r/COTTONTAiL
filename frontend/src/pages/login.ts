import { api } from '../api.ts';

export function renderLogin(container: HTMLElement) {
  let showChangePassword = false;

  function render() {
    container.innerHTML = `
      <div class="login-page">
        <div class="login-box">
          <div class="login-logo">
            <h1>COTTON<span>TAiL</span></h1>
            <p>Music Index Dashboard</p>
          </div>
          ${showChangePassword ? renderChangeForm() : renderLoginForm()}
        </div>
      </div>
    `;
    attachEvents();
  }

  function renderLoginForm(): string {
    return `
      <form id="login-form">
        <div class="form-field">
          <label class="form-label" for="login-password">Password</label>
          <input class="input" type="password" id="login-password" placeholder="Enter password" autocomplete="current-password" autofocus>
        </div>
        <div class="error-text" id="login-error"></div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px">Sign In</button>
      </form>
    `;
  }

  function renderChangeForm(): string {
    return `
      <form id="change-form">
        <p style="font-size:12px;color:var(--fg-3);margin-bottom:16px;text-align:center">
          Please change your default password
        </p>
        <div class="form-field">
          <label class="form-label" for="current-pw">Current Password</label>
          <input class="input" type="password" id="current-pw" placeholder="Current password" autocomplete="current-password">
        </div>
        <div class="form-field">
          <label class="form-label" for="new-pw">New Password</label>
          <input class="input" type="password" id="new-pw" placeholder="New password" autocomplete="new-password">
        </div>
        <div class="form-field">
          <label class="form-label" for="confirm-pw">Confirm Password</label>
          <input class="input" type="password" id="confirm-pw" placeholder="Confirm password" autocomplete="new-password">
        </div>
        <div class="error-text" id="change-error"></div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px">Change Password</button>
      </form>
    `;
  }

  function attachEvents() {
    const loginForm = document.getElementById('login-form') as HTMLFormElement | null;
    const changeForm = document.getElementById('change-form') as HTMLFormElement | null;

    loginForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = (document.getElementById('login-password') as HTMLInputElement).value;
      const errEl = document.getElementById('login-error')!;
      const btn = loginForm.querySelector('button')!;

      if (!pw) { errEl.textContent = 'Password required'; return; }
      errEl.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Signing in...';

      try {
        const res = await api.login(pw);
        if (res.mustChange) {
          showChangePassword = true;
          render();
        } else {
          location.reload();
        }
      } catch (err: any) {
        errEl.textContent = err.message || 'Login failed';
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    });

    changeForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const current = (document.getElementById('current-pw') as HTMLInputElement).value;
      const newPw = (document.getElementById('new-pw') as HTMLInputElement).value;
      const confirm = (document.getElementById('confirm-pw') as HTMLInputElement).value;
      const errEl = document.getElementById('change-error')!;
      const btn = changeForm.querySelector('button')!;

      if (!current || !newPw) { errEl.textContent = 'All fields required'; return; }
      if (newPw !== confirm) { errEl.textContent = 'Passwords do not match'; return; }
      if (newPw.length < 4) { errEl.textContent = 'Password too short'; return; }

      errEl.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Changing...';

      try {
        await api.changePassword(current, newPw);
        location.reload();
      } catch (err: any) {
        errEl.textContent = err.message || 'Change failed';
        btn.disabled = false;
        btn.textContent = 'Change Password';
      }
    });
  }

  render();
}
