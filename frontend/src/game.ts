import '../styles/game.scss';

const params: URLSearchParams = new URLSearchParams(window.location.search);
  const gameId = params.get('gameId') || sessionStorage.getItem('activeGameId');
  const loggedInUser = params.get('player') || sessionStorage.getItem('currentUsername') || '';
  if (!gameId || !loggedInUser) {
    window.location.href = `/pages/dashboard.html?user=${encodeURIComponent(loggedInUser)}`;
    throw new Error('Game-ID oder Spieler fehlt.');
  }
  sessionStorage.setItem('currentUsername', loggedInUser);
  sessionStorage.setItem('activeGameId', gameId);
  history.replaceState({}, '', `/pages/game.html?gameId=${encodeURIComponent(gameId)}&player=${encodeURIComponent(loggedInUser)}`);

  let state: any = null;
  let selectedColor: string | null = null;
  let currentSelection: string[] = ['', '', '', ''];
  let pollTimer = null;
  let timerTimer = null;
  let redirecting = false;

  const gameIdLabel = document.createElement('div');
  gameIdLabel.id = 'game-id-label';
  gameIdLabel.style.cssText = 'font-size:.78rem;color:#6c757d;margin:0 0 12px 0;';
  gameIdLabel.textContent = `Game ID: ${gameId}`;
  document.querySelector('.left-panel')?.prepend(gameIdLabel);

  function showModal(title, text, autoClose = false, callback = null) {
    const modal = document.getElementById('game-modal');
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-text').innerText = text;
    const btn = document.getElementById('modal-ok-btn');
    btn.style.display = autoClose ? 'none' : 'inline-block';
    modal.style.display = 'flex';
    if (autoClose) setTimeout(() => { modal.style.display = 'none'; if (callback) callback(); }, 900);
  }
  function closeModal() { document.getElementById('game-modal').style.display = 'none'; }

  function getColorHex(color: string | null): string {
    return ({red:'#dc3545', blue:'#0d6efd', green:'#198754', yellow:'#ffc107'})[color] || '#ccc';
  }

  function selectColor(color) {
    selectedColor = color;
    document.getElementById('selected-color-text').innerText = color;
    document.getElementById('selected-color-text').style.color = getColorHex(color);
  }

  function setSlot(index) {
    if (!state || state.currentPlayer !== loggedInUser) { showModal('Warten', 'Du bist nicht am Zug.'); return; }
    if (!selectedColor) { showModal('Hinweis', 'Bitte zuerst eine Farbe auswählen.'); return; }
    currentSelection[index] = selectedColor;
    const slot = document.getElementById(`slot-${index}`);
    slot.className = `slot ${selectedColor}`;
    slot.style.background = getColorHex(selectedColor);
    slot.style.color = '#fff';
    slot.innerText = index + 1;
  }

  function resetSelection() {
    currentSelection = ['', '', '', ''];
    selectedColor = null;
    document.getElementById('selected-color-text').innerText = 'Keine';
    document.getElementById('selected-color-text').style.color = '#0d6efd';
    for (let i = 0; i < 4; i++) {
      const slot = document.getElementById(`slot-${i}`);
      slot.className = 'slot'; slot.style.background = '#fff'; slot.style.color = '#aaa'; slot.innerText = String(i + 1);
    }
  }

  function renderHistory() {
    const list = document.getElementById('history-list');
    if (!list || !state) return;
    // Each player sees only their own code history. The server keeps the shared
    // game state, but the UI must not expose the opponent's attempts.
    const entries = ((state.history || {})[loggedInUser] || []).slice();
    entries.sort((a,b) => Number(a.time) - Number(b.time));
    list.innerHTML = entries.map(e => {
      const balls = (e.guess || []).map(c => `<span class="history-ball" style="background:${getColorHex(c)}"></span>`).join('');
      const dots = '<div class="feedback-dots">' + '●'.repeat(Number(e.blackPins)||0).split('').map(() => '<span class="dot-black" title="Richtig"></span>').join('') + '○'.repeat(Number(e.whitePins)||0).split('').map(() => '<span class="dot-white" title="Falsche Position"></span>').join('') + '</div>';
      return `<div class="history-card"><strong>${escapeHtml(e.player)} (Runde ${e.round})</strong><div class="history-balls">${balls}</div>${dots}</div>`;
    }).join('');
  }

  function escapeHtml(v) { return String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

  function renderState() {
    if (!state) return;
    document.getElementById('round-title').innerText = `Runde ${state.round} von 10`;
    const mine = state.currentPlayer === loggedInUser;
    document.getElementById('player-turn').innerHTML = `Du bist: <strong>${escapeHtml(loggedInUser)}</strong> | Am Zug: <strong>${escapeHtml(state.currentPlayer)}</strong> ${mine ? '<span class="turn-own">(Du bist dran!)</span>' : '<span class="turn-wait">(Warte auf Gegner)</span>'}`;
    document.querySelectorAll<HTMLElement>('.color-ball, .slot, .btn-primary').forEach(el => (el as HTMLButtonElement).disabled = !mine);
    (document.querySelector('.btn-primary') as HTMLButtonElement | null)?.toggleAttribute('disabled', !mine);
    renderHistory();
    updateTimer();

    if (state.finished && !redirecting) {
      redirecting = true;
      clearInterval(pollTimer); clearInterval(timerTimer);
      // Any finished game, including an abort, goes through the result page.
      // Both players get the same result, but the Continue button sends each
      // player to their own dashboard.
      const destination = `/pages/result.html?gameId=${encodeURIComponent(gameId)}&player=${encodeURIComponent(loggedInUser)}`;
      setTimeout(() => window.location.href = destination, 250);
    }
  }

  function updateTimer() {
    if (!state) return;
    const left = Math.max(0, Math.ceil((Number(state.roundStartTime) + Number(state.roundDurationMs) - Date.now()) / 1000));
    document.getElementById('time').innerText = String(left);
    if (left <= 0) document.getElementById('player-turn').innerHTML += ' <span class="turn-wait">(Zeit abgelaufen – Server synchronisiert...)</span>';
  }

  async function syncGame() {
    try {
      const res = await fetch(`/api/game/${encodeURIComponent(gameId)}`, {cache:'no-store'});
      if (res.status === 404) { showModal('Spiel beendet', 'Diese Game-ID existiert nicht mehr.', true, () => window.location.href = `/pages/dashboard.html?user=${encodeURIComponent(loggedInUser)}`); return; }
      if (!res.ok) return;
      state = await res.json();
      renderState();
    } catch (err) { console.warn('[Game sync]', err); }
  }

  async function submitCode() {
    if (!state || state.finished) return;
    if (state.currentPlayer !== loggedInUser) { showModal('Warten', 'Du bist nicht am Zug.'); return; }
    if (currentSelection.some(c => !c)) { showModal('Achtung', 'Bitte wähle für alle 4 Positionen eine Farbe aus!'); return; }

    try {
      const res = await fetch(`/api/game/${encodeURIComponent(gameId)}/guess`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({player: loggedInUser, guess: currentSelection})
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.message) showModal('Hinweis', data.message);
        await syncGame();
        return;
      }
      state = data;
      resetSelection();
      renderState();
      if (!state.finished && data.blackPins === 4) showModal('✅ Runde gewonnen', 'Du hast deinen Versuch richtig gelöst. Jetzt ist dein Gegner dran.', true);
    } catch (err) { showModal('Fehler', 'Der Server ist momentan nicht erreichbar.'); }
  }

  function abortGame() {
    document.getElementById('abort-modal').style.display = 'flex';
  }

  function closeAbortModal() {
    document.getElementById('abort-modal').style.display = 'none';
  }

  async function confirmAbortGame() {
    const confirmBtn = document.getElementById('confirm-abort-btn') as HTMLButtonElement | null;
    if (confirmBtn && confirmBtn.disabled) return;
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Wird abgebrochen...'; }
    try {
      const res = await fetch(`/api/game/${encodeURIComponent(gameId)}/abort?player=${encodeURIComponent(loggedInUser)}`, {method:'POST'});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Spiel abbrechen'; }
        showModal('Abbruch nicht möglich', data.error || 'Das Spiel konnte nicht abgebrochen werden.');
        return;
      }
      // Beide Spieler gehen über die Ergebnis-Seite. Dort sehen sie Gewinner,
      // Verlierer und Punkte und können anschließend in ihre eigene Lobby zurück.
      window.location.href = `/pages/result.html?gameId=${encodeURIComponent(gameId)}&player=${encodeURIComponent(loggedInUser)}`;
    } catch (_) {
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Spiel abbrechen'; }
      showModal('Verbindung fehlgeschlagen', 'Der Server ist momentan nicht erreichbar. Bitte versuche es erneut.');
    }
  }

  // Sync every 500ms: both browsers see the same Game-ID, turn, timer, history and finish state.
  syncGame();
  pollTimer = setInterval(syncGame, 500);
  timerTimer = setInterval(updateTimer, 250);


// Page event wiring
document.addEventListener('click', (event) => {
  const target = (event.target as Element | null)?.closest('[data-action]') as HTMLElement | null;
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'close-modal') closeModal();
  else if (action === 'close-abort-modal') closeAbortModal();
  else if (action === 'confirm-abort') confirmAbortGame();
  else if (action === 'select-color') selectColor(target.dataset.color || '');
  else if (action === 'set-slot') setSlot(Number(target.dataset.slot));
  else if (action === 'submit-code') submitCode();
  else if (action === 'abort-game') abortGame();
});

