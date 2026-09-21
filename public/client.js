(function () {
  'use strict';

  // ============================================================
  // Mobile viewport height fix — 100vh is unreliable on phones
  // because of the address bar, so we measure the real height.
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
      try { handleServerMessage(JSON.parse(evt.data)); }
      catch (e) { console.error('bad message from server', e); }
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
  const modeBadge = el('modeBadge');
  const viewerChip = el('viewerChip');
  const viewerCountEl = el('viewerCount');
  const diagStatus = el('diagStatus');
  const diagCount = el('diagCount');
  const diagLast = el('diagLast');
  const diagRaw = el('diagRaw');

  const heroSub = el('heroSub');
  const statsRow = el('statsRow');
  const statGuesses = el('statGuesses');
  const statPlayers = el('statPlayers');
  const statDiff = el('statDiff');

  const winBanner = el('winBanner');
  const winnerName = el('winnerName');
  const winWord = el('winWord');
  const winMeta = el('winMeta');
  const winConfetti = el('winConfetti');
  const giveUpBanner = el('giveUpBanner');
  const giveUpWord = el('giveUpWord');

  const guessList = el('guessList');
  const guessCount = el('guessCount');
  const closestList = el('closestList');
  const leaderboardList = el('leaderboardList');
  const hintsUsed = el('hintsUsed');
  const hintList = el('hintList');
  const hintEmpty = el('hintEmpty');
  const historyPanel = el('historyPanel');
  const historyList = el('historyList');
  const hostFeed = el('hostFeed');
  const hostMessages = el('hostMessages');

  const tabSetup = el('tabSetup');
  const tabPlaying = el('tabPlaying');
  const tiktokUsername = el('tiktokUsername');
  const connectBtn = el('connectBtn');
  const difficultySelect = el('difficultySelect');
  const startLiveBtn = el('startLiveBtn');
  const startTestBtn = el('startTestBtn');
  const hostInput = el('hostInput');
  const hostCommentBtn = el('hostCommentBtn');
  const hostGuessBtn = el('hostGuessBtn');
  const hintBtn = el('hintBtn');
  const giveUpBtn = el('giveUpBtn');
  const autoplayBtn = el('autoplayBtn');
  const shareBtn = el('shareBtn');
  const newRoundBtn = el('newRoundBtn');
  const disconnectBtn = el('disconnectBtn');

  let currentDifficulty = null;

  // ============================================================
  // Diagnostics drawer toggle
  // ============================================================
  diagBtn.addEventListener('click', () => {
    const nowHidden = diagPanel.classList.toggle('hidden');
    diagBtn.setAttribute('aria-expanded', String(!nowHidden));
  });

  // ============================================================
  // Toasts — plain-language surfacing of problems, no stack traces
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
      case 'game_started': onGameStarted(msg); break;
      case 'hint_reveal': addHintChip(msg.word); break;
      case 'win': onWin(msg); break;
      case 'give_up': onGiveUp(msg); break;
      case 'host_message': addHostMessage(msg.text); break;
      case 'server_error': toast(msg.message); break;
    }
  }

  function onGameStarted(msg) {
    winBanner.classList.add('hidden');
    giveUpBanner.classList.add('hidden');
    lastRoundRecap = null;
    currentDifficulty = msg.difficulty || null;
    heroSub.textContent = msg.mode === 'test'
      ? 'Test mode round started — try typing a guess below.'
      : 'Round started! Guesses from TikTok LIVE chat will show up below.';
    statsRow.classList.remove('hidden');
    setDiffChip(msg.difficulty, msg.mode);
    guessList.innerHTML = '<p class="empty-hint">Guesses will appear here as soon as someone types one.</p>';
    hintList.innerHTML = '';
    hintEmpty.classList.remove('hidden');
    tabPlaying.classList.remove('hidden');
    tabSetup.classList.add('hidden');
    autoplayBtn.classList.toggle('hidden', msg.mode !== 'test');
    disconnectBtn.classList.toggle('hidden', msg.mode !== 'live');
  }

  let lastRoundRecap = null; // { word, guessesUsed, hintsUsed, players, tierHistory, winner }

  function onWin(msg) {
    winnerName.textContent = msg.user;
    winWord.textContent = msg.word.toUpperCase();
    winMeta.textContent = `Solved in ${msg.guessesUsed} guess${msg.guessesUsed === 1 ? '' : 'es'}`;
    winBanner.classList.remove('hidden');
    launchConfetti();
    heroSub.textContent = 'Round finished — start a new round when ready.';
    lastRoundRecap = { word: msg.word, guessesUsed: msg.guessesUsed, hintsUsed: msg.hintsUsed, players: msg.players, tierHistory: msg.tierHistory, winner: msg.user };
  }

  function onGiveUp(msg) {
    giveUpWord.textContent = msg.word.toUpperCase();
    giveUpBanner.classList.remove('hidden');
    heroSub.textContent = 'Round ended — start a new round when ready.';
    lastRoundRecap = { word: msg.word, guessesUsed: msg.guessesUsed, hintsUsed: msg.hintsUsed, players: msg.players, tierHistory: msg.tierHistory, winner: null };
  }

  function launchConfetti() {
    winConfetti.innerHTML = '';
    const colors = ['#ffc24b', '#fe2c55', '#25f4ee', '#4ade80'];
    for (let i = 0; i < 24; i++) {
      const s = document.createElement('span');
      s.style.left = Math.random() * 100 + '%';
      s.style.background = colors[i % colors.length];
      s.style.animationDelay = (Math.random() * 0.3) + 's';
      winConfetti.appendChild(s);
    }
  }

  function setDiffChip(difficulty, mode) {
    if (!difficulty) { statDiff.classList.add('hidden'); return; }
    statDiff.textContent = mode === 'test' ? 'Test' : difficulty;
    statDiff.className = 'diff-chip diff-' + (mode === 'test' ? 'medium' : difficulty);
    statDiff.classList.remove('hidden');
  }

  function renderState(state) {
    diagStatus.textContent = state.connection.status;
    connLabel.textContent = state.connection.message;
    connDot.className = 'dot dot-' + state.connection.status;

    if (state.mode) {
      modeBadge.textContent = state.mode;
      modeBadge.className = 'mode-badge mode-' + state.mode;
      modeBadge.classList.remove('hidden');
    } else {
      modeBadge.classList.add('hidden');
    }

    if (state.viewerCount != null) {
      viewerCountEl.textContent = state.viewerCount;
      viewerChip.classList.remove('hidden');
    } else {
      viewerChip.classList.add('hidden');
    }

    diagCount.textContent = state.diagnostics.rawEventCount;
    diagLast.textContent = state.diagnostics.lastReceived
      ? `${state.diagnostics.lastReceived.user}: ${state.diagnostics.lastReceived.text}`
      : '—';
    if (state.diagnostics.rawSamples && state.diagnostics.rawSamples.length) {
      diagRaw.textContent = state.diagnostics.rawSamples.join('\n\n---\n\n');
    }

    if (state.game.active || state.game.winner) {
      tabPlaying.classList.remove('hidden');
      tabSetup.classList.add('hidden');
    }
    if (state.game.difficulty) {
      statsRow.classList.remove('hidden');
      setDiffChip(state.game.difficulty, state.mode);
    }
    statGuesses.textContent = `${state.game.totalGuesses} guesses`;
    statPlayers.textContent = `${state.game.uniquePlayers} players`;

    guessCount.textContent = `${state.game.totalGuesses} guesses`;
    hintsUsed.textContent = `${state.game.hintsUsed} used`;
    hintEmpty.classList.toggle('hidden', (state.game.hintsGiven || []).length > 0);

    guessList.innerHTML = '';
    if (!state.game.guesses.length) {
      guessList.innerHTML = '<p class="empty-hint">Guesses will appear here as soon as a round starts.</p>';
    } else {
      state.game.guesses.forEach(addGuessRow);
    }

    renderClosest(state.game.closest);
    renderLeaderboard(state.leaderboard);
    renderHistory(state.roundHistory);

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

  // ============================================================
  // Rank -> authentic Contexto color tiers
  // (1 exact / 1-50 dark green / 51-300 green / 301-1500 orange / 1501+ red)
  // ============================================================
  function tierClass(rank) {
    if (rank == null) return 'rank-red';
    if (rank === 1) return 'rank-exact';
    if (rank <= 50) return 'rank-dark-green';
    if (rank <= 300) return 'rank-green';
    if (rank <= 1500) return 'rank-orange';
    return 'rank-red';
  }
  function tierColor(rank) {
    if (rank == null) return 'var(--tier-red)';
    if (rank === 1) return 'var(--tier-exact)';
    if (rank <= 50) return 'var(--tier-dark-green)';
    if (rank <= 300) return 'var(--tier-green)';
    if (rank <= 1500) return 'var(--tier-orange)';
    return 'var(--tier-red)';
  }
  function rankLabel(rank) {
    if (rank == null) return 'not a word';
    if (rank === 1) return '🎯 EXACT';
    return '#' + rank;
  }
  // Log-scaled bar width so mid-range ranks stay visually distinguishable
  // instead of everything under ~1500 looking equally "full".
  function heatWidth(rank) {
    if (rank == null) return '4%';
    const MAX = 3000;
    const pct = 100 * (1 - Math.log(rank) / Math.log(MAX));
    return Math.max(4, Math.min(100, pct)) + '%';
  }

  function addGuessRow(entry) {
    if (guessList.querySelector('.empty-hint')) guessList.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'guess-row' + (entry.isWin ? ' win' : '') + (entry.isHost ? ' host' : '');
    const pct = entry.percent != null ? entry.percent : null;
    const repeatTag = entry.isRepeat ? `<span class="repeat-tag" title="Already guessed by ${escapeHtml(entry.repeatOf)}">↺ also ${escapeHtml(entry.repeatOf)}</span>` : '';
    row.innerHTML = `
      <div class="guess-heat" style="width:${heatWidth(entry.rank)};background:${tierColor(entry.rank)}"></div>
      <span class="guess-user">${escapeHtml(entry.user)}</span>
      <span class="guess-word">${escapeHtml(entry.word)}${repeatTag}</span>
      ${pct != null ? `<span class="guess-pct">${pct}%</span>` : ''}
      <span class="guess-rank ${tierClass(entry.rank)}">${rankLabel(entry.rank)}</span>
    `;
    guessList.prepend(row);
    while (guessList.children.length > 50) guessList.removeChild(guessList.lastChild);
  }

  function renderClosest(closest) {
    closestList.innerHTML = '';
    if (!closest || !closest.length) {
      closestList.innerHTML = '<li class="muted">No guesses yet</li>';
      return;
    }
    closest.forEach((c) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="rank-user">${escapeHtml(c.user)}: ${escapeHtml(c.word)}</span><span class="val ${tierClass(c.rank)}">#${c.rank}</span>`;
      closestList.appendChild(li);
    });
  }

  function renderLeaderboard(lb) {
    leaderboardList.innerHTML = '';
    const entries = Array.isArray(lb) ? lb : [];
    if (!entries.length) {
      leaderboardList.innerHTML = '<li class="muted">No scores yet</li>';
      return;
    }
    entries.slice(0, 10).forEach((e) => {
      const li = document.createElement('li');
      const wins = e.wins ? ` 🏆${e.wins}` : '';
      li.innerHTML = `<span class="rank-user">${escapeHtml(e.user)}${wins}</span><span class="val rank-exact">${e.score}</span>`;
      leaderboardList.appendChild(li);
    });
  }

  function renderHistory(history) {
    if (!history || !history.length) { historyPanel.classList.add('hidden'); return; }
    historyPanel.classList.remove('hidden');
    historyList.innerHTML = '';
    history.slice().reverse().forEach((h) => {
      const row = document.createElement('div');
      row.className = 'history-row';
      const outcome = h.gaveUp
        ? 'revealed'
        : `won by <strong>${escapeHtml(h.winner || '—')}</strong>`;
      row.innerHTML = `<span><strong>${escapeHtml(h.word)}</strong> — ${outcome}</span><span>${h.guessesUsed} guesses · ${h.players} players</span>`;
      historyList.appendChild(row);
    });
  }

  function addHintChip(word) {
    const chip = document.createElement('span');
    chip.className = 'hint-chip';
    chip.textContent = word;
    hintList.appendChild(chip);
    hintEmpty.classList.add('hidden');
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

  startLiveBtn.addEventListener('click', () => {
    send({ type: 'start_game', mode: 'live', difficulty: difficultySelect.value });
  });
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
  hostInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') hostGuessBtn.click(); });

  hintBtn.addEventListener('click', () => send({ type: 'hint' }));
  giveUpBtn.addEventListener('click', () => send({ type: 'give_up' }));

  let autoplayOn = false;
  autoplayBtn.addEventListener('click', () => {
    autoplayOn = !autoplayOn;
    autoplayBtn.textContent = autoplayOn ? '⏸ Stop' : '▶ Autoplay';
    send({ type: 'test_autoplay', on: autoplayOn });
  });

  const TIER_EMOJI = { exact: '🟨', 'dark-green': '🟩', green: '🟩', orange: '🟧', red: '🟥' };

  shareBtn.addEventListener('click', () => {
    if (!lastRoundRecap) {
      // Round still in progress — share a quick live snapshot instead.
      const text = `Contexto LIVE — round in progress\n${statGuesses.textContent} · ${statPlayers.textContent}`;
      copyToClipboard(text);
      return;
    }
    const r = lastRoundRecap;
    const grid = (r.tierHistory || []).map((t) => TIER_EMOJI[t] || '⬜').join('');
    const lines = [
      `Contexto LIVE — "${r.word.toUpperCase()}"`,
      r.winner ? `Solved by ${r.winner} in ${r.guessesUsed} guesses` : `Revealed after ${r.guessesUsed} guesses`,
      `${r.players} player${r.players === 1 ? '' : 's'} · ${r.hintsUsed} hint${r.hintsUsed === 1 ? '' : 's'} used`,
      grid,
    ];
    copyToClipboard(lines.join('\n'));
  });

  function copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => toast('Recap copied — paste it wherever you like.'),
        () => toast('Could not copy — try selecting the text manually.')
      );
    } else {
      toast('Clipboard not available in this browser.');
    }
  }

  newRoundBtn.addEventListener('click', () => {
    tabSetup.classList.remove('hidden');
    tabPlaying.classList.add('hidden');
    winBanner.classList.add('hidden');
    giveUpBanner.classList.add('hidden');
    heroSub.textContent = 'Pick a difficulty, then Live or Test, to start a new round.';
  });

  disconnectBtn.addEventListener('click', () => send({ type: 'disconnect_tiktok' }));
})();
