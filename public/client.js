(function () {
  'use strict';

  // ============================================================
  // Mobile viewport height fix (requirement #7)
  // 100vh is unreliable on phones because of the address bar.
  // We measure the real height in JS and expose it as --vh.
  // ============================================================
  function setRealVH() {
    document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
  }
  setRealVH();
  window.addEventListener('resize', setRealVH);
  window.addEventListener('orientationchange', setRealVH);

  // ============================================================
  // WebSocket connection to our own server
  // ============================================================
  let ws;
  let wsReady = false;
  const pendingQueue = [];

  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.onopen = () => {
      wsReady = true;
      while (pendingQueue.length) ws.send(JSON.stringify(pendingQueue.shift()));
    };
    ws.onclose = () => {
      wsReady = false;
      toast('Lost connection to the game server. Reconnecting…');
      setTimeout(connectWS, 2000);
    };
    ws.onerror = () => {};
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error('bad message from server', e);
      }
    };
  }
  function send(obj) {
    if (wsReady) ws.send(JSON.stringify(obj));
    else pendingQueue.push(obj);
  }
  connectWS();

  // ============================================================
  // DOM references
  // ============================================================
  const el = (id) => document.getElementById(id);

  const diagBtn = el('diagBtn');
  const diagPanel = el('diagPanel');
  const connDot = el('connDot');
  const connLabel = el('connLabel');
  const diagStatus = el('diagStatus');
  const diagCount = el('diagCount');
  const diagLast = el('diagLast');
  const diagRaw = el('diagRaw');

  const heroSub = el('heroSub');
  const lengthChip = el('lengthChip');
  const winBanner = el('winBanner');
  const winnerName = el('winnerName');
  const winWord = el('winWord');

  const guessList = el('guessList');
  const guessCount = el('guessCount');
  const closestList = el('closestList');
  const leaderboardList = el('leaderboardList');
  const hintsRemaining = el('hintsRemaining');
  const hintList = el('hintList');
  const hostFeed = el('hostFeed');
  const hostMessages = el('hostMessages');

  const tabSetup = el('tabSetup');
  const tabPlaying = el('tabPlaying');
  const tiktokUsername = el('tiktokUsername');
  const connectBtn = el('connectBtn');
  const startLiveBtn = el('startLiveBtn');
  const startTestBtn = el('startTestBtn');
  const hostInput = el('hostInput');
  const hostCommentBtn = el('hostCommentBtn');
  const hostGuessBtn = el('hostGuessBtn');
  const hintBtn = el('hintBtn');
  const autoplayBtn = el('autoplayBtn');
  const newRoundBtn = el('newRoundBtn');
  const disconnectBtn = el('disconnectBtn');

  // ============================================================
  // Diagnostics drawer toggle
  // ============================================================
  diagBtn.addEventListener('click', () => {
    const open = diagPanel.classList.toggle('hidden') === false;
    diagBtn.setAttribute('aria-expanded', String(open));
  });

  // ============================================================
  // Toasts (plain-language surfacing of server_error, requirement:
  // surface problems via diagnostics not raw errors)
  // ============================================================
  function toast(text) {
    const host = el('toastHost');
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    host.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  // ============================================================
  // Server -> client message handling
  // ============================================================
  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'state': renderState(msg.state); break;
      case 'raw_event': renderDiagnostics(msg); break;
      case 'guess': addGuessRow(msg.entry); break;
      case 'game_started':
        winBanner.classList.add('hidden');
        heroSub.textContent = msg.mode === 'test'
          ? 'Test mode round started — try typing a guess below.'
          : 'Round started! Guesses from TikTok LIVE chat will show up below.';
        lengthChip.textContent = `${msg.targetLength} letters`;
        lengthChip.classList.remove('hidden');
        guessList.innerHTML = '';
        hintList.innerHTML = '';
        tabPlaying.classList.remove('hidden');
        tabSetup.classList.add('hidden');
        autoplayBtn.classList.toggle('hidden', msg.mode !== 'test');
        disconnectBtn.classList.toggle('hidden', msg.mode !== 'live');
        break;
      case 'hint_reveal': addHintChip(msg.word); break;
      case 'win':
        winnerName.textContent = msg.user;
        winWord.textContent = msg.word;
        winBanner.classList.remove('hidden');
        heroSub.textContent = 'Round finished — start a new round when ready.';
        break;
      case 'host_message': addHostMessage(msg.text); break;
      case 'server_error': toast(msg.message); break;
    }
  }

  function renderState(state) {
    // connection status
    diagStatus.textContent = state.connection.status;
    connLabel.textContent = state.connection.message;
    connDot.className = 'dot dot-' + state.connection.status;

    // diagnostics
    diagCount.textContent = state.diagnostics.rawEventCount;
    diagLast.textContent = state.diagnostics.lastReceived
      ? `${state.diagnostics.lastReceived.user}: ${state.diagnostics.lastReceived.text}`
      : '—';
    if (state.diagnostics.rawSamples && state.diagnostics.rawSamples.length) {
      diagRaw.textContent = state.diagnostics.rawSamples.join('\n\n---\n\n');
    }

    // game
    if (state.game.active || state.game.winner) {
      tabPlaying.classList.remove('hidden');
      tabSetup.classList.add('hidden');
    }
    if (state.game.targetLength) {
      lengthChip.textContent = `${state.game.targetLength} letters`;
      lengthChip.classList.remove('hidden');
    }
    guessCount.textContent = `${state.game.guesses.length} guesses`;
    hintsRemaining.textContent = `${state.game.hintsRemaining} left`;

    guessList.innerHTML = '';
    if (!state.game.guesses.length) {
      guessList.innerHTML = '<p class="empty-hint">Guesses will appear here as soon as a round starts.</p>';
    } else {
      state.game.guesses.forEach(addGuessRow);
    }

    renderClosest(state.game.closest);
    renderLeaderboard(state.leaderboard);

    hintList.innerHTML = '';
    (state.game.hintsGiven || []).forEach(addHintChip);
  }

  function renderDiagnostics(msg) {
    diagCount.textContent = msg.rawEventCount;
    diagLast.textContent = `${msg.lastReceived.user}: ${msg.lastReceived.text}`;
    if (msg.rawSamples && msg.rawSamples.length) {
      diagRaw.textContent = msg.rawSamples.join('\n\n---\n\n');
    }
  }

  function rankClass(rank) {
    if (rank == null) return '';
    if (rank <= 20) return 'rank-close';
    if (rank <= 300) return 'rank-mid';
    return '';
  }
  function rankLabel(rank) {
    if (rank == null) return 'not found';
    if (rank === 1) return '🎯 EXACT';
    return '#' + rank;
  }
  function heatWidth(rank) {
    if (rank == null) return '4%';
    const pct = Math.max(4, 100 - Math.min(100, (rank / 1500) * 100));
    return pct + '%';
  }

  function addGuessRow(entry) {
    if (guessList.querySelector('.empty-hint')) guessList.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'guess-row' + (entry.isWin ? ' win' : '') + (entry.isHost ? ' host' : '');
    row.innerHTML = `
      <div class="guess-heat" style="width:${heatWidth(entry.rank)}"></div>
      <span class="guess-user">${escapeHtml(entry.user)}</span>
      <span class="guess-word">${escapeHtml(entry.word)}</span>
      <span class="guess-rank ${rankClass(entry.rank)}">${rankLabel(entry.rank)}</span>
    `;
    guessList.prepend(row);
    while (guessList.children.length > 40) guessList.removeChild(guessList.lastChild);
  }

  function renderClosest(closest) {
    closestList.innerHTML = '';
    if (!closest || !closest.length) {
      closestList.innerHTML = '<li class="muted">No guesses yet</li>';
      return;
    }
    closest.forEach((c) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${escapeHtml(c.user)}: ${escapeHtml(c.word)}</span><span class="val">#${c.rank}</span>`;
      closestList.appendChild(li);
    });
  }

  function renderLeaderboard(lb) {
    leaderboardList.innerHTML = '';
    const entries = Array.isArray(lb) ? lb : Object.entries(lb || {}).map(([user, score]) => ({ user, score }));
    if (!entries.length) {
      leaderboardList.innerHTML = '<li class="muted">No scores yet</li>';
      return;
    }
    entries.slice(0, 10).forEach((e) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${escapeHtml(e.user)}</span><span class="val">${e.score}</span>`;
      leaderboardList.appendChild(li);
    });
  }

  function addHintChip(word) {
    const chip = document.createElement('span');
    chip.className = 'hint-chip';
    chip.textContent = word;
    hintList.appendChild(chip);
  }

  function addHostMessage(text) {
    hostFeed.classList.remove('hidden');
    const div = document.createElement('div');
    div.className = 'host-msg';
    div.textContent = text;
    hostMessages.prepend(div);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ============================================================
  // Control dock actions
  // ============================================================
  connectBtn.addEventListener('click', () => {
    const name = tiktokUsername.value.trim();
    if (!name) return toast('Enter a TikTok username first.');
    send({ type: 'connect_tiktok', username: name });
  });

  startLiveBtn.addEventListener('click', () => send({ type: 'start_game', mode: 'live' }));
  startTestBtn.addEventListener('click', () => send({ type: 'start_game', mode: 'test' }));

  hostCommentBtn.addEventListener('click', () => {
    const text = hostInput.value.trim();
    if (!text) return;
    send({ type: 'host_comment', text });
    hostInput.value = '';
  });
  hostGuessBtn.addEventListener('click', () => {
    const text = hostInput.value.trim();
    if (!text) return;
    send({ type: 'host_guess', text });
    hostInput.value = '';
  });
  hostInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hostGuessBtn.click();
  });

  hintBtn.addEventListener('click', () => send({ type: 'hint' }));

  let autoplayOn = false;
  autoplayBtn.addEventListener('click', () => {
    autoplayOn = !autoplayOn;
    autoplayBtn.textContent = autoplayOn ? '⏸ Stop autoplay' : '▶ Autoplay demo';
    send({ type: 'test_autoplay', on: autoplayOn });
  });

  newRoundBtn.addEventListener('click', () => {
    tabSetup.classList.remove('hidden');
    tabPlaying.classList.add('hidden');
    winBanner.classList.add('hidden');
    heroSub.textContent = 'Pick Live or Test mode to start a new round.';
  });

  disconnectBtn.addEventListener('click', () => send({ type: 'disconnect_tiktok' }));
})();
