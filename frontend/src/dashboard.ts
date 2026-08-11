import '../styles/dashboard.scss';

// The URL is the identity of this tab. No shared localStorage identity is used.
  const params: URLSearchParams = new URLSearchParams(window.location.search);
  let currentUsername = params.get('user') || sessionStorage.getItem('currentUsername') || localStorage.getItem('username') || 'Spieler';
  sessionStorage.setItem('currentUsername', currentUsername);
  const loginStatus = String(sessionStorage.getItem('loginStatus') || '').toLowerCase();
  let firstDashboardLoad = true;
  history.replaceState({}, '', `/pages/dashboard.html?user=${encodeURIComponent(currentUsername)}`);

  document.getElementById('lobby-main-title').innerText = `Spieler Lobby von ${currentUsername}`;
  document.getElementById('lobby-card-heading').innerText = `Lobby von ${currentUsername}`;

  let latestPlayers: any[] = [];
  let refreshBusy = false;
  let lastLobbySnapshot = '';

  function renderLastGameResult() {
    const container = document.getElementById('last-game-result-container');
    if (!container) return;

    const raw = localStorage.getItem(`lastGameResult_${currentUsername}`);
    if (!raw) {
      container.innerHTML = '';
      return;
    }

    try {
      const result = JSON.parse(raw);
      const deltaText = Number(result.myDelta) > 0 ? `+${result.myDelta}` : `${result.myDelta}`;
      const isWinner = result.winner === currentUsername;
      const isDraw = result.winner === 'DRAW';
      const title = isDraw ? '🤝 Unentschieden' : isWinner ? '🏆 Du hast gewonnen!' : '❌ Du hast verloren';
      const detail = result.abortedBy
        ? `${escapeHtml(result.abortedBy)} hat das Spiel abgebrochen.`
        : `Gewinner: <strong>${escapeHtml(result.winner || 'Unbekannt')}</strong>`;

      container.innerHTML = `
        <div class="last-result-card">
          <div class="last-result-title">${title}</div>
          <div class="last-result-detail">${detail}</div>
          <div>Deine Punkte aus diesem Spiel: <strong>${deltaText}</strong> · Gesamt: <strong>${Number(result.myScore) || 0}</strong></div>
          <small class="last-result-meta">Game-ID: ${escapeHtml(result.gameId || '')}</small>
        </div>`;
    } catch (_) {
      localStorage.removeItem(`lastGameResult_${currentUsername}`);
      container.innerHTML = '';
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }


  let spielEinladungOpen = false;
  let invitationBusy = false;
  let invitationSnapshot = '';
  let invitationSelectionRendered = false;
  let invitationSelectionSignature = '';

  function toggleSpielEinladung() {
    spielEinladungOpen = !spielEinladungOpen;
    const panel = document.getElementById('spiel-einladung-panel');
    const arrow = document.getElementById('spiel-einladung-arrow');
    panel.classList.toggle('open', spielEinladungOpen);
    arrow.textContent = spielEinladungOpen ? '▲' : '▼';
    if (spielEinladungOpen) {
      renderInvitationSelection(true);
      loadInvitations();
    }
  }

  function renderInvitationSelection(force = false) {
    const content = document.getElementById('invitation-selection-content');
    if (!content) return;

    // Only players who are currently BEREIT may receive an invitation.
    // AUSSTEHEND players are intentionally excluded. The list is refreshed
    // automatically from latestPlayers, but existing checkbox selections are
    // preserved for players who are still eligible.
    const selectable = latestPlayers.filter(p =>
      p.username !== currentUsername &&
      String(p.status || '').toLowerCase() === 'bereit'
    );
    const signature = JSON.stringify(selectable.map(p => p.username));
    if (!force && invitationSelectionRendered && signature === invitationSelectionSignature) return;

    const selectedBeforeRefresh = new Set(
      Array.from(content.querySelectorAll<HTMLInputElement>('.invite-recipient:checked')).map(el => el.value)
    );

    let html = `<div class="selection-heading">Spieler auswählen</div><div class="selection-help">Nur bereite Spieler werden angezeigt. Nur ausgewählte Spieler erhalten eine Einladung.</div>`;
    if (!selectable.length) {
      html += `<div class="selection-empty">Keine bereiten Spieler verfügbar.</div>`;
    } else {
      selectable.forEach(p => {
        const checked = selectedBeforeRefresh.has(p.username) ? ' checked' : '';
        html += `<label class="invite-player">
          <span><strong>${escapeHtml(p.username)}</strong> <small class="ready-label">bereit</small></span>
          <input type="checkbox" class="invite-recipient" value="${escapeHtml(p.username)}"${checked}>
        </label>`;
      });
      html += `<button class="btn btn-bereit invite-send-btn" data-action="send-invitations">✉️ Einladung senden</button>`;
    }
    content.innerHTML = html;
    invitationSelectionRendered = true;
    invitationSelectionSignature = signature;
  }

  function renderIncomingInvitations(incoming) {
    const container = document.getElementById('incoming-invitations-container');
    if (!container) return;
    if (!incoming.length) {
      container.innerHTML = '';
      return;
    }
    let html = `<div class="incoming-wrapper">
      <div class="incoming-title">🔔 Spieleinladung</div>`;
    for (const inv of incoming) {
      const seconds = Math.ceil(Number(inv.remainingMs || 0) / 1000);
      html += `<div class="invite-card incoming" class="incoming-card">
        <div><strong>${escapeHtml(inv.from)}</strong> möchte mit dir spielen.</div>
        <div class="invite-time">Noch <strong>${seconds}s</strong> Zeit.</div>
        <div class="invite-actions">
          <button class="invite-accept" data-action="accept-invitation" data-invitation-id="${encodeURIComponent(inv.invitationId)}">✓ Annehmen</button>
          <button class="invite-reject" data-action="reject-invitation" data-invitation-id="${encodeURIComponent(inv.invitationId)}">Ablehnen</button>
        </div>
      </div>`;
    }
    html += `</div>`;
    container.innerHTML = html;
  }

  function renderOutgoingInvitations(outgoing) {
    const content = document.getElementById('outgoing-invitations-content');
    if (!content) return;
    if (!outgoing.length) {
      content.innerHTML = `<div class="muted-small">Keine gesendeten Einladungen.</div>`;
      return;
    }
    const groups: Record<string, any[]> = {};
    outgoing.forEach(inv => { (groups[inv.groupId] ||= []).push(inv); });
    let html = `<div class="outgoing-title">📤 Meine Einladungen</div>`;
    Object.values(groups).forEach(group => {
      const first = group[0];
      const seconds = Math.ceil(Number(first.remainingMs || 0) / 1000);
      const accepted = group.find(x => x.status === 'ACCEPTED');
      const resolved = group.some(x => x.status === 'ACCEPTED') || first.resolution === 'ALL_REJECTED' || first.resolution === 'EXPIRED';
      const title = accepted
        ? `🎮 ${escapeHtml(accepted.to)} hat angenommen`
        : first.resolution === 'ALL_REJECTED'
          ? '❌ Alle Einladungen wurden abgelehnt'
          : first.resolution === 'EXPIRED'
            ? '⌛ Einladung abgelaufen'
            : `⏳ Warte auf Antworten · ${seconds}s`;
      html += `<div class="invite-card ${resolved ? 'resolved' : ''}">
        <div><strong>${title}</strong></div>
        <div class="outgoing-group">${group.map(inv => {
          const label = inv.status === 'ACCEPTED' ? '✓ angenommen' :
            inv.status === 'REJECTED' ? '✕ abgelehnt' :
            inv.status === 'CANCELLED' ? '– nicht mehr benötigt' :
            inv.status === 'EXPIRED' ? '⌛ abgelaufen' : '⏳ wartet';
          return `<div class="outgoing-line"><strong>${escapeHtml(inv.to)}</strong>: ${label}</div>`;
        }).join('')}</div>
      </div>`;
    });
    content.innerHTML = html;
  }

  async function loadInvitations() {
    if (invitationBusy) return;
    invitationBusy = true;
    try {
      const res = await fetch(`/api/game/invitations?user=${encodeURIComponent(currentUsername)}&_=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
      });
      if (!res.ok) throw new Error('Einladungen konnten nicht geladen werden.');
      const data = await res.json();
      const incoming = Array.isArray(data.incoming) ? data.incoming : [];
      const outgoing = Array.isArray(data.outgoing) ? data.outgoing : [];
      invitationSnapshot = JSON.stringify(data);

      // Incoming invitations are always visible directly in the lobby.
      renderIncomingInvitations(incoming);
      // Sender-side invitations are shown inside the collapsible Spiel Einladung panel.
      renderOutgoingInvitations(outgoing);
      // The recipient selection UI is rendered separately, so polling never
      // clears checked players while the sender is selecting several recipients.
      if (spielEinladungOpen) renderInvitationSelection();
    } catch (err) {
      const incomingContainer = document.getElementById('incoming-invitations-container');
      if (incomingContainer) incomingContainer.innerHTML = `<div class="error-message error-message-spaced">${escapeHtml(err.message || 'Fehler bei Einladungen.')}</div>`;
      const outgoingContent = document.getElementById('outgoing-invitations-content');
      if (outgoingContent) outgoingContent.innerHTML = `<div class="error-message">${escapeHtml(err.message || 'Fehler bei Einladungen.')}</div>`;
    } finally {
      invitationBusy = false;
    }
  }

  async function sendInvitations() {
    const selected = [...document.querySelectorAll<HTMLInputElement>('.invite-recipient:checked')].map(x => x.value);
    if (!selected.length) {
      alert('Wähle mindestens einen Spieler aus.');
      return;
    }
    try {
      const res = await fetch('/api/game/invitations', {
        method: 'POST',
        headers: {'Content-Type':'application/json','Cache-Control':'no-cache'},
        body: JSON.stringify({ from: currentUsername, recipients: selected })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Einladung konnte nicht gesendet werden.');
      await loadInvitations();
    } catch (err) {
      alert(err.message || 'Fehler beim Senden der Einladung.');
    }
  }

  async function respondInvitation(encodedId, action) {
    const invitationId = decodeURIComponent(encodedId);
    try {
      const res = await fetch(`/api/game/invitations/${encodeURIComponent(invitationId)}/respond`, {
        method:'POST',
        headers:{'Content-Type':'application/json','Cache-Control':'no-cache'},
        body:JSON.stringify({username:currentUsername, action})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Einladung konnte nicht verarbeitet werden.');
      if (action === 'ACCEPT' && data.gameId) {
        sessionStorage.setItem('activeGameId', data.gameId);
        window.location.href = `/pages/game.html?gameId=${encodeURIComponent(data.gameId)}&player=${encodeURIComponent(currentUsername)}`;
        return;
      }
      await loadInvitations();
      await loadLobby();
    } catch (err) {
      alert(err.message || 'Fehler bei der Einladung.');
    }
  }

  async function getActiveGames() {
    try {
      const res = await fetch('/api/game/active?_=' + Date.now(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!res.ok) return [];
      const games = await res.json();
      return Array.isArray(games) ? games.filter(g => g && !g.finished) : [];
    } catch (_) {
      return [];
    }
  }

  async function checkActiveGame() {
    const container = document.getElementById('active-games-container');
    const games = await getActiveGames();

    if (!games.length) {
      container.innerHTML = '';
      sessionStorage.removeItem('activeGameId');
      return [];
    }

    let participantGame = null;
    const html = games.map(game => {
      const isParticipant = Array.isArray(game.players) && game.players.includes(currentUsername);
      if (isParticipant) participantGame = game;

      const remaining = Math.max(0, Math.ceil((Number(game.roundStartTime) + Number(game.roundDurationMs) - Date.now()) / 1000));
      const title = isParticipant ? '🎮 Dein aktuelles Spiel' : '🎮 Aktuelles Spiel';
      const text = isParticipant
        ? 'Du nimmst an diesem Spiel teil.'
        : 'Diese beiden Spieler spielen gerade gegeneinander.';

      return `
        <div class="active-game-banner" class="active-game-banner ${isParticipant ? 'participant' : 'spectator'}">
          <h3 class="active-game-title">${title}</h3>
          <p class="active-game-players">${escapeHtml(game.player1)} vs ${escapeHtml(game.player2)}</p>
          <p class="active-game-info">${text}</p>
          <p class="active-game-info">Runde ${game.round} · ${remaining}s · Am Zug: ${escapeHtml(game.currentPlayer)}</p>
          ${isParticipant ? `<button class="btn btn-bereit join-game-btn" data-action="join-game" data-game-id="${encodeURIComponent(game.gameId)}">Zum Spiel wechseln</button>` : ''}
        </div>`;
    }).join('');

    container.innerHTML = html;
    if (participantGame) {
      sessionStorage.setItem('activeGameId', participantGame.gameId);
    } else {
      sessionStorage.removeItem('activeGameId');
    }
    return games;
  }

  function joinGame(encodedGameId) {
    const gameId = decodeURIComponent(encodedGameId);
    sessionStorage.setItem('activeGameId', gameId);
    window.location.href = `/pages/game.html?gameId=${encodeURIComponent(gameId)}&player=${encodeURIComponent(currentUsername)}`;
  }

  async function loadLobby() {
    if (refreshBusy) return;
    refreshBusy = true;
    try {
      async function fetchPlayersSnapshot() {
        const res = await fetch('/api/admin/users?_=' + Date.now(), {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        });
        if (!res.ok) throw new Error('Benutzer konnten nicht geladen werden.');
        return res.json();
      }

      let users = await fetchPlayersSnapshot();

      // Right after login the backend has already confirmed the player as ready.
      // If the first dashboard request happens to return the previous DB snapshot,
      // immediately re-read it once instead of requiring the user to press F5.
      if (firstDashboardLoad && loginStatus === 'bereit') {
        const meFirst = users.find(u => u.username === currentUsername && u.role === 'PLAYER');
        const firstStatus = String(meFirst?.status || '').toLowerCase();
        if (firstStatus !== 'bereit' && firstStatus !== 'spielend') {
          await new Promise(resolve => setTimeout(resolve, 150));
          users = await fetchPlayersSnapshot();
        }
      }
      firstDashboardLoad = false;
      sessionStorage.removeItem('loginStatus');
      latestPlayers = users.filter(u => u.role === 'PLAYER');

      // Always render the latest server state immediately. Do not let the active-game
      // request block the lobby refresh, so a newly logged-in player sees Bereit/Ausstehend
      // automatically without pressing F5.
      const snapshot = JSON.stringify(latestPlayers.map(p => ({ id: p.id, username: p.username, status: p.status, score: p.score })));
      if (snapshot !== lastLobbySnapshot) {
        lastLobbySnapshot = snapshot;

        // Keep the invitation picker synchronized with the latest player status.
        // A player who becomes AUSSTEHEND disappears automatically; a player who
        // becomes BEREIT appears automatically, without F5 and without clearing
        // selections that are still valid.
        if (spielEinladungOpen) renderInvitationSelection();

        const lobbyList = document.getElementById('lobby-users-list');
        lobbyList.innerHTML = '';
        let ready = 0, pending = 0;

        latestPlayers.forEach(p => {
          const status = String(p.status || 'ausstehend').toLowerCase();
          if (status === 'bereit') ready++; else if (status !== 'spielend') pending++;
          const label = status === 'bereit' ? 'bereit' : status === 'spielend' ? 'spielend' : 'ausstehend';
          const cls = status === 'bereit' ? 'badge-bereit' : 'badge-ausstehend';
          lobbyList.innerHTML += `
            <div class="user-row">
              <span><strong>${escapeHtml(p.username)}</strong>${p.username === currentUsername ? ' 👤 (Du)' : ''}</span>
              <span class="badge ${cls}">${label}</span>
            </div>`;
        });

        document.getElementById('lobby-counter').innerHTML =
          `Gesamt: ${latestPlayers.length} | Bereit: <span class="counter-ready">${ready}</span> | Ausstehend: <span class="counter-pending">${pending}</span>`;

        const me = latestPlayers.find(p => p.username === currentUsername);
        const myStatus = String(me?.status || 'ausstehend').toLowerCase();
        const readyBtn = document.getElementById('main-bereit-btn') as HTMLButtonElement | null;
        if (readyBtn) {
          readyBtn.textContent = myStatus === 'bereit' ? '✅ Bereit gemeldet (Aktiv)' : myStatus === 'spielend' ? '🎮 Im Spiel' : 'Bereit melden';
          readyBtn.style.backgroundColor = myStatus === 'bereit' ? '#157347' : '#198754';
          readyBtn.disabled = myStatus === 'spielend';
        }

        const sorted = [...latestPlayers].sort((a,b) => (Number(b.score)||0) - (Number(a.score)||0));
        const table = document.getElementById('highscore-table');
        table.innerHTML = sorted.map((p,i) => `
          <tr><td>${i+1}</td><td>${escapeHtml(p.username)}${p.username === currentUsername ? ' 👤' : ''}</td><td class="text-right score-cell">${Number(p.score)||0}</td></tr>`).join('');
      }

      // Refresh the game banner separately. A slow/stuck game request can never block
      // the player list/status refresh above.
      checkActiveGame();
    } catch (err) {
      console.error('[Lobby]', err);
    } finally {
      refreshBusy = false;
    }
  }

async function updateMyStatus(status) {
    const me = latestPlayers.find(p => p.username === currentUsername);
    if (!me?.id) { alert('Spieler nicht gefunden.'); return; }

    try {
      const res = await fetch(`/api/admin/users/${me.id}/status?_=${Date.now()}`, {
        method: 'PUT',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        body: JSON.stringify({ status })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Status konnte nicht geändert werden.');

      // Wichtig: Kein localStorage-Status mehr. Die Datenbank ist die einzige Wahrheit.
      await loadLobby();
    } catch (err) {
      alert(err.message || 'Fehler beim Ändern des Status.');
    }
  }

  async function logout() {
    // A normal player leaving the lobby becomes ausstehend in the database.
    // This keeps the Admin dashboard in sync instead of leaving the player as bereit.
    try {
      const me = latestPlayers.find(p => p.username === currentUsername);
      if (me?.id) {
        await fetch(`/api/admin/users/${me.id}/status?_=${Date.now()}`, {
          method: 'PUT',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
          body: JSON.stringify({ status: 'ausstehend' })
        });
      }
    } catch (err) {
      console.warn('[Logout] Status konnte nicht aktualisiert werden:', err);
    } finally {
      sessionStorage.removeItem('currentUsername');
      sessionStorage.removeItem('activeGameId');
      localStorage.removeItem('username');
      window.location.href = '/pages/login.html';
    }
  }

  renderLastGameResult();
  loadLobby();
  // Invitations must be polled even while the collapsible sender panel is closed,
  // because incoming invitations are displayed directly in the lobby. The server
  // owns their 30-second lifetime, so refreshes never erase them.
  loadInvitations();
  setInterval(() => {
    loadLobby();
    loadInvitations();
  }, 1000);


// Page event wiring
document.addEventListener('click', (event) => {
  const target = (event.target as Element | null)?.closest('[data-action]') as HTMLElement | null;
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'logout') logout();
  else if (action === 'toggle-invitations') toggleSpielEinladung();
  else if (action === 'status-ready') updateMyStatus('bereit');
  else if (action === 'status-pending') updateMyStatus('ausstehend');
  else if (action === 'send-invitations') sendInvitations();
  else if (action === 'accept-invitation') respondInvitation(target.dataset.invitationId || '', 'ACCEPT');
  else if (action === 'reject-invitation') respondInvitation(target.dataset.invitationId || '', 'REJECT');
  else if (action === 'join-game') joinGame(target.dataset.gameId || '');
});

