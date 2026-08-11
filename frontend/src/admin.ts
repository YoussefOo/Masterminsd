import '../styles/admin.scss';

let allUsers: any[] = [];

    async function loadUsers() {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/admin/users?_=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-cache' }
        });
        if (res.ok) {
          const nextUsers = await res.json();
          const changed = JSON.stringify(nextUsers) !== JSON.stringify(allUsers);
          allUsers = nextUsers;
          if (changed || document.getElementById('user-table-body').children.length === 0) {
            filterUsers();
          }
        }
      } catch (e) {
        console.error('Fehler:', e);
      }
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\'':'&#39;','"':'&quot;'}[ch]));
    }

    function updateSearchStatus(total, shown) {
      const box = document.getElementById('search-status');
      const query = (document.getElementById('search-input') as HTMLInputElement).value.trim();
      if (!query) {
        box.className = 'search-status';
        box.textContent = `${total} Benutzer insgesamt`;
      } else if (shown === 0) {
        box.className = 'search-status not-found';
        box.textContent = `Kein Benutzer mit „${query}“ in der Datenbank gefunden.`;
      } else {
        box.className = 'search-status';
        box.textContent = `${shown} Treffer für „${query}“`;
      }
    }

    function displayUsers(users) {
      const tbody = document.getElementById('user-table-body');
      tbody.innerHTML = '';
      if (users.length === 0) {
        const query = (document.getElementById('search-input') as HTMLInputElement).value.trim();
        tbody.innerHTML = `<tr><td colspan="5" class="text-center padded-empty">${query ? `Kein Benutzer mit „${escapeHtml(query)}“ gefunden.` : 'Keine Benutzer gefunden.'}</td></tr>`;
        return;
      }
      users.forEach(user => {
        // Status kommt ausschließlich vom Server / der Datenbank.
        // Kein localStorage-Override mehr, damit Lobby und Admin immer
        // denselben Status anzeigen.
        let currentStatus = String(user.status || 'ausstehend').toLowerCase();
        let statusClass = currentStatus === 'bereit' ? 'badge-bereit' : currentStatus === 'spielend' ? 'badge-spielend' : 'badge-ausstehend';
        let statusText = currentStatus === 'bereit' ? 'bereit' : currentStatus === 'spielend' ? 'spielend' : 'ausstehend';

        let statusBadge = `<span class="badge ${statusClass}">${statusText}</span>`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${user.username}</td>
          <td>${user.role}</td>
          <td>${statusBadge}</td>
          <td><strong>${user.score !== undefined ? user.score : 0}</strong></td>
          <td class="text-right">
            <button class="btn-edit" data-action="edit-user" data-user-id="${user.id}" data-username="${escapeHtml(user.username)}" data-role="${escapeHtml(user.role)}">Bearbeiten</button>
            <button class="btn-delete" data-action="delete-user" data-user-id="${user.id}">Löschen</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }


    function filterUsers() {
      const query = (document.getElementById('search-input') as HTMLInputElement).value.trim().toLowerCase();
      const filtered = query
        ? allUsers.filter(u => String(u.username || '').toLowerCase().includes(query))
        : allUsers;
      displayUsers(filtered);
      updateSearchStatus(allUsers.length, filtered.length);
    }

    document.getElementById('search-input').addEventListener('input', filterUsers);

    async function deleteUser(id) {
      if (confirm('Möchtest du diesen Benutzer wirklich löschen?')) {
        const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
        if (res.ok) loadUsers();
      }
    }

    function editUser(id, currentUsername, currentRole) {
      const newName = prompt('Neuen Benutzernamen eingeben:', currentUsername);
      if (newName === null) return;
      const newRole = prompt('Rolle eingeben (ADMIN oder PLAYER):', currentRole);
      if (newRole === null) return;

      if (newName.trim() !== '' && (newRole.toUpperCase() === 'ADMIN' || newRole.toUpperCase() === 'PLAYER')) {
        updateUser(id, newName.trim(), newRole.toUpperCase());
      }
    }

    async function updateUser(id, username, role) {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, role: role })
      });
      if (res.ok) loadUsers();
    }


    function renderAdminGameStatus(data) {
      const box = document.getElementById('admin-game-status');
      if (!box) return;

      const activeGames = Array.isArray(data?.activeGames) ? data.activeGames : [];
      let html = '';

      if (activeGames.length > 0) {
        html += activeGames.map((game, index) => {
          const remaining = Math.max(0, Math.ceil((Number(game.roundStartTime) + Number(game.roundDurationMs) - Date.now()) / 1000));
          const code = Array.isArray(game.secretCode) ? game.secretCode.join(', ') : String(game.secretCodeText || '');
          const scores = game.scores || {};
          const submitted = Number(game.roundSubmittedCount || 0);
          return `
            <div class="admin-active-game">
              <div class="admin-game-title">🟢 Spiel ${index + 1} läuft</div>
              <div class="admin-game-grid">
                <div><strong>Spieler:</strong> ${escapeHtml(game.player1)} vs ${escapeHtml(game.player2)}</div>
                <div><strong>Runde:</strong> ${Number(game.round) || 1}</div>
                <div><strong>Am Zug:</strong> ${escapeHtml(game.currentPlayer || '-')}</div>
                <div><strong>Zeit:</strong> ${remaining}s</div>
                <div><strong>Score:</strong> ${escapeHtml(game.player1)} ${Number(scores[game.player1] || 0)} — ${Number(scores[game.player2] || 0)} ${escapeHtml(game.player2)}</div>
                <div><strong>Versuche dieser Runde:</strong> ${submitted}/2</div>
              </div>
              <div class="admin-secret-code">
                <strong>🔐 Geheimcode (Server):</strong>
                <span class="secret-code">${escapeHtml(code)}</span>
              </div>
              <small class="admin-meta">Game-ID: ${escapeHtml(game.gameId || '')}</small>
            </div>`;
        }).join('');
      }

      const result = data?.lastResult || (data?.hasLastResult ? data : null);
      if (result) {
        const winner = result.winner === 'ALL_LOST' ? 'Keiner (alle verloren)' : result.winner;
        const resultText = result.aborted
          ? `${escapeHtml(result.abortedBy || 'Unbekannt')} hat das Spiel abgebrochen.`
          : (result.winner ? `Gewinner: <strong>${escapeHtml(winner)}</strong>` : `🤝 Unentschieden: ${escapeHtml(result.player1 || '')} und ${escapeHtml(result.player2 || '')}.`);
        html += `
          <div class="admin-last-game">
            <div class="admin-last-game-title">🏁 Letztes Spiel beendet</div>
            <div><strong>${escapeHtml(result.player1 || '')}</strong> vs <strong>${escapeHtml(result.player2 || '')}</strong></div>
            <div class="admin-result-text">${resultText}</div>
            <small class="admin-meta">Der vorige Geheimcode wird nicht angezeigt.</small>
          </div>`;
      }

      if (!html) {
        html = `
          <div class="admin-empty-state">
            Kein aktives Spiel. Spieler können über ihr Lobby-Matchmaking ein neues Spiel starten.
          </div>`;
      }
      box.innerHTML = html;
    }

    async function loadAdminGameStatus() {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/admin/game/status?_=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        });
        if (!res.ok) return;
        renderAdminGameStatus(await res.json());
      } catch (e) {
        console.error('Spielstand konnte nicht geladen werden:', e);
      }
    }

    function logout() {
      localStorage.clear();
      window.location.href = '/pages/login.html';
    }

    // Admin-Anzeige regelmäßig mit dem Server synchronisieren.
    // Status wird ausschließlich aus der Datenbank gelesen.
    loadUsers();
    loadAdminGameStatus();
    setInterval(loadUsers, 2000);
    setInterval(loadAdminGameStatus, 1000);


// Page event wiring
document.addEventListener('click', (event) => {
  const target = (event.target as Element | null)?.closest('[data-action]') as HTMLElement | null;
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'logout') logout();
  if (action === 'filter-users') filterUsers();
  if (action === 'edit-user') editUser(Number(target.dataset.userId), target.dataset.username || '', target.dataset.role || 'PLAYER');
  if (action === 'delete-user') deleteUser(Number(target.dataset.userId));
});
