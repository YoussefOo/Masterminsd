import '../styles/main.scss';

// دالة إظهار المودال الأنيق بدلاً من alert المتصفح
function showModal(message: string, isError: boolean = false, callback?: () => void) {
  if (!document.getElementById('custom-modal-style')) {
    const style = document.createElement('style');
    style.id = 'custom-modal-style';
    style.innerHTML = `
      .custom-modal-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.5); display: flex; justify-content: center; align-items: center; z-index: 1000;
      }
      .custom-modal-box {
        background: white; padding: 30px; border-radius: 10px; text-align: center; max-width: 400px; width: 90%; box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      }
      .custom-modal-box h3 { margin-top: 0; color: ${isError ? '#dc3545' : '#198754'}; }
      .custom-modal-box p { color: #555; margin-bottom: 20px; font-size: 0.95rem; }
      .custom-modal-btn {
        background: #0d6efd; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-weight: bold; font-size: 1rem; width: 100%;
      }
      .custom-modal-btn:hover { background: #0b5ed7; }
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.className = 'custom-modal-overlay';
  
  overlay.innerHTML = `
    <div class="custom-modal-box">
      <h3>${isError ? 'Achtung!' : 'Erfolgreich!'}</h3>
      <p>${message}</p>
      <button class="custom-modal-btn" id="modalOkBtn">OK</button>
    </div>
  `;
  
  document.body.appendChild(overlay);

  const btn = document.getElementById('modalOkBtn');
  btn?.addEventListener('click', () => {
    overlay.remove();
    if (callback) callback();
  });
}

const form = document.getElementById('login-form') as HTMLFormElement;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = (document.getElementById('username') as HTMLInputElement).value;
  const password = (document.getElementById('password') as HTMLInputElement).value;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('token', data.token || 'Bearer-Codecracker-Token-2026');
      localStorage.setItem('role', data.role);
      localStorage.setItem('username', username);
      sessionStorage.setItem('currentUsername', username);
      // The backend sets players/admins to 'bereit' on successful login.
      // Keep that confirmed login state for the first dashboard paint so the
      // user never briefly sees a stale 'ausstehend' value before the server snapshot arrives.
      sessionStorage.setItem('loginStatus', data.playerStatus || 'bereit');

      // Force a fresh dashboard document after login. This prevents the browser
      // from reusing a cached pre-login dashboard, so the first view already
      // contains the latest player statuses without pressing F5.
      const fresh = Date.now();
      if (data.role === 'ADMIN') {
        window.location.replace(`/pages/admin.html?_=${fresh}`);
      } else {
        window.location.replace(`/pages/dashboard.html?user=${encodeURIComponent(username)}&_=${fresh}`);
      }
    } else {
      const errorData = await res.json().catch(() => ({}));
      const errorMessage = errorData.message || 'Benutzer nicht gefunden oder falsches Passwort!';
      
      // استبدال alert بـ Modal أنيق للأخطاء
      showModal(errorMessage, true);
    }
  } catch (err) {
    console.error(err);
    showModal('Verbindungsfehler zum Server.', true);
  }
});