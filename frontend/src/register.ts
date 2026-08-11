// import '../styles/main.scss';

// const form = document.getElementById('register-form') as HTMLFormElement;

// form.addEventListener('submit', async (e) => {
//   e.preventDefault();
//   const username = (document.getElementById('username') as HTMLInputElement).value;
//   const password = (document.getElementById('password') as HTMLInputElement).value;
//   const role = (document.getElementById('role') as HTMLSelectElement)?.value || 'PLAYER';

//   try {
//     const res = await fetch('/api/register', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ username, password, role })
//     });

//     if (res.ok) {
//       alert('Registrierung erfolgreich! Du kannst dich jetzt einloggen.');
//       window.location.href = '/pages/login.html';
//     } else {
//       const errorData = await res.json().catch(() => ({ message: 'Registrierungsfehler!' }));
      
//       // هنا كيتشاف واش الاسم ديجا كاين ولا كاين خطأ آخر
//       if (errorData.message.includes('existiert bereits')) {
//         alert('Dieser Benutzername ist bereits vergeben. Bitte wähle einen anderen!');
//       } else if (errorData.message.includes('Administrator nicht möglich')) {
//         alert('Es gibt bereits einen Administrator. Registrierung als Admin ist nicht möglich!');
//       } else {
//         alert(errorData.message);
//       }
//     }
//   } catch (err) {
//     console.error(err);
//     alert('Verbindungsfehler zum Server.');
//   }
// });

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

const form = document.getElementById('register-form') as HTMLFormElement;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = (document.getElementById('username') as HTMLInputElement).value;
  const password = (document.getElementById('password') as HTMLInputElement).value;
  const role = (document.getElementById('role') as HTMLSelectElement)?.value || 'PLAYER';

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role })
    });

    if (res.ok) {
      showModal('Registrierung erfolgreich! Du kannst dich jetzt einloggen.', false, () => {
        window.location.href = '/pages/login.html';
      });
    } else {
      const errorData = await res.json().catch(() => ({ message: 'Registrierungsfehler!' }));
      
      if (errorData.message.includes('existiert bereits')) {
        showModal('Dieser Benutzername ist bereits vergeben. Bitte wähle einen anderen!', true);
      } else if (errorData.message.includes('Administrator nicht möglich')) {
        showModal('Es gibt bereits einen Administrator. Registrierung als Admin ist nicht möglich!', true);
      } else {
        showModal(errorData.message, true);
      }
    }
  } catch (err) {
    console.error(err);
    showModal('Verbindungsfehler zum Server.', true);
  }
});