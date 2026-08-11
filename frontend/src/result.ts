import '../styles/result.scss';

const params: URLSearchParams = new URLSearchParams(window.location.search);
  const gameId = params.get('gameId') || sessionStorage.getItem('activeGameId');
  const currentUser = params.get('player') || sessionStorage.getItem('currentUsername') || '';
  if (!gameId || !currentUser) {
    window.location.href = `/pages/dashboard.html?user=${encodeURIComponent(currentUser)}`;
    throw new Error('Game-ID oder Spieler fehlt.');
  }
  sessionStorage.setItem('currentUsername', currentUser);
  sessionStorage.setItem('activeGameId', gameId);
  history.replaceState({}, '', `/pages/result.html?gameId=${encodeURIComponent(gameId)}&player=${encodeURIComponent(currentUser)}`);

  let poll: ReturnType<typeof setInterval> | null = null;
  let shown = false;
  const errorBox = document.getElementById('error-container');
  const spinner = document.getElementById('loading-spinner');

  function escapeHtml(v) { return String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

  async function loadResult() {
    try {
      const res = await fetch(`/api/game/${encodeURIComponent(gameId)}`, {cache:'no-store'});
      if (res.status === 404) throw new Error('Dieses Spiel wurde auf dem Server nicht gefunden.');
      if (!res.ok) throw new Error('Ergebnis konnte nicht geladen werden.');
      const game = await res.json();
      if (!game.finished) {
        document.getElementById('winner-text').innerText = 'Spiel läuft noch – Ergebnis wird automatisch aktualisiert...';
        return;
      }

      shown = true;
      if (poll !== null) clearInterval(poll);
      spinner.style.display = 'none';
      errorBox.style.display = 'none';

      const p1 = game.player1, p2 = game.player2, winner = game.winner;
      const p1Score = Number(game.scores?.[p1] ?? 0);
      const p2Score = Number(game.scores?.[p2] ?? 0);
      const tbody = document.getElementById('result-table-body');
      const icon = document.getElementById('icon-box');

      let title = 'Spiel beendet';
      let p1Result = 'Verloren', p2Result = 'Verloren';
      let p1Delta = -1, p2Delta = -1;
      if (winner === 'ALL_LOST') {
        title = 'Spiel beendet – beide Spieler verlieren';
      } else if (winner === 'DRAW') {
        title = 'Unentschieden'; p1Result = p2Result = 'Unentschieden'; p1Delta = p2Delta = 1; icon.className = 'success-icon draw-icon'; icon.textContent = '🤝';
      } else {
        title = `🏆 ${winner} hat gewonnen!`;
        if (winner === p1) { p1Result = '🏆 Gewonnen'; p1Delta = 3; } else { p2Result = '🏆 Gewonnen'; p2Delta = 3; }
        icon.className = 'success-icon'; icon.textContent = '🏆';
      }

      document.getElementById('winner-text').innerText = title;

      // Save a personal summary for this player. The key contains the username,
      // so each player's lobby keeps only their own latest result.
      let myDelta = -1;
      if (winner === currentUser) myDelta = 3;
      else if (winner === 'DRAW') myDelta = 1;
      const myScore = currentUser === p1 ? p1Score : p2Score;
      localStorage.setItem(`lastGameResult_${currentUser}`, JSON.stringify({
        gameId,
        winner,
        abortedBy: game.abortedBy || null,
        myDelta,
        myScore,
        opponent: currentUser === p1 ? p2 : p1,
        savedAt: Date.now()
      }));

      tbody.innerHTML = `
        <tr><td><strong>${escapeHtml(p1)}</strong></td><td>${p1Result}</td><td class="result-points">${p1Delta > 0 ? '+' : ''}${p1Delta}</td><td><strong>${p1Score}</strong></td></tr>
        <tr><td><strong>${escapeHtml(p2)}</strong></td><td>${p2Result}</td><td class="result-points">${p2Delta > 0 ? '+' : ''}${p2Delta}</td><td><strong>${p2Score}</strong></td></tr>`;
    } catch (err) {
      spinner.style.display = 'none';
      errorBox.style.display = 'block';
      errorBox.innerHTML = `<strong>❌ ${escapeHtml(err.message)}</strong><br><small>Die Seite versucht es weiter.</small>`;
    }
  }

  function exitToDestination() {
    if (poll !== null) clearInterval(poll);
    sessionStorage.removeItem('activeGameId');
    window.location.href = `/pages/dashboard.html?user=${encodeURIComponent(currentUser)}`;
  }

  loadResult();
  poll = setInterval(loadResult, 700);


document.addEventListener('click', (event) => {
  const target = (event.target as Element | null)?.closest('[data-action]') as HTMLElement | null;
  if (target?.dataset.action === 'exit-destination') exitToDestination();
});
