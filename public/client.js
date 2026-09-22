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
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Status header / diagnostics
  const diagnosticsEl = el('diagnostics');
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
  const diagDict = el('diagDict');
  const collapseBtn = el('collapseBtn');
  const expandTab = el('expandTab');
  const expandDot = el('expandDot');

  // Hero + banners
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

  // Action bar
  const settingsToggle = el('settingsToggle');
  const settingsSheet = el('settingsSheet');
  const settingsCloseBtn = el('settingsCloseBtn');
  const modePip = el('modePip');
  const hintBtn = el('hintBtn');
  const dockToggle = el('dockToggle');
  const hostSheet = el('hostSheet');
  const hostCloseBtn = el('hostCloseBtn');
  const roundBtn = el('roundBtn');

  // Settings
  const settingsEl = el('settingsSheetBody');
  const modeHint = el('modeHint');
  const segBtns = $$('.seg-btn');
  const panes = $$('.mode-pane');
  const tiktokUsername = el('tiktokUsername');
  const connectBtn = el('connectBtn');
  const connNote = el('connNote');
  const lengthSelect = el('lengthSelect');
  const liveWord = el('liveWord');
  const testWord = el('testWord');
  const autoplayToggle = el('autoplayToggle');
  const autoplayText = el('autoplayText');
  const speedSelect = el('speedSelect');
  const offlineWord = el('offlineWord');

  // Board
  const latestRow = el('latestRow');
  const guessList = el('guessList');
  const guessEmpty = el('guessEmpty');
  const guessCount = el('guessCount');

  // Host word entry
  const playerName = el('playerName');
  const hostInput = el('hostInput');
  const hostGuessBtn = el('hostGuessBtn');

  // Points popups + overlays
  const pointsPopupHost = el('pointsPopupHost');
  const roundEndOverlay = el('roundEndOverlay');
  const overlayAnswerWord = el('overlayAnswerWord');
  const overlayRoundMeta = el('overlayRoundMeta');
  const overlayScorersWrap = el('overlayScorersWrap');
  const overlayScorers = el('overlayScorers');
  const leaderboardOverlay = el('leaderboardOverlay');
  const overlayLeaderboardList = el('overlayLeaderboardList');
  const leaderboardCloseBtn = el('leaderboardCloseBtn');
  const viewLeaderboardBtn = el('viewLeaderboardBtn');
  const resetLeaderboardBtn = el('resetLeaderboardBtn');

  // ============================================================
  // Small helpers
  // ============================================================
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

  // A stable, pleasant color for a username, used for its fallback avatar.
  const AVATAR_COLORS = ['#fe2c55', '#25f4ee', '#ffc24b', '#4ade80', '#a78bfa', '#fb923c', '#38bdf8', '#f472b6'];
  function colorFor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  function fallbackAvatarHtml(user) {
    return `<span class="pp-avatar" style="background:${colorFor(user || '?')}">${escapeHtml((user || '?').charAt(0).toUpperCase())}</span>`;
  }
  function avatarHtml(user, avatarUrl) {
    if (!avatarUrl) return fallbackAvatarHtml(user);
    // If the image fails to load (private/expired CDN URL), swap in the
    // colored-initial fallback instead of leaving a broken image icon.
    return `<img class="pp-avatar" src="${escapeHtml(avatarUrl)}" alt="" referrerpolicy="no-referrer" data-fallback-user="${escapeHtml(user || '?')}" />`;
  }
  pointsPopupHost.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.classList.contains('pp-avatar')) return;
    const span = document.createElement('span');
    span.className = 'pp-avatar';
    const user = img.dataset.fallbackUser || '?';
    span.style.background = colorFor(user);
    span.textContent = user.charAt(0).toUpperCase();
    img.replaceWith(span);
  }, true);

  function toast(text) {
    const host = el('toastHost');
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    host.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  // Bottom sheets (Settings, Enter-a-word). Each opens on demand and
  // closes itself — nothing sits permanently expanded in the layout,
  // which is what keeps the game screen clean on a small phone.
  function openSheet(sheet, toggleBtn) {
    sheet.classList.remove('hidden');
    // Force a reflow so the transform transition actually plays instead
    // of jumping straight to the open state.
    void sheet.offsetHeight;
    sheet.classList.add('open');
    toggleBtn.setAttribute('aria-expanded', 'true');
  }
  function closeSheet(sheet, toggleBtn) {
    if (sheet.classList.contains('hidden')) return;
    sheet.classList.remove('open');
    toggleBtn.setAttribute('aria-expanded', 'false');
    setTimeout(() => sheet.classList.add('hidden'), 240);
  }
  function isSheetOpen(sheet) { return sheet.classList.contains('open'); }

  // Opening one sheet closes the other, so only one ever fights for
  // the screen at a time.
  settingsToggle.addEventListener('click', () => {
    if (isSheetOpen(settingsSheet)) { closeSheet(settingsSheet, settingsToggle); return; }
    closeSheet(hostSheet, dockToggle);
    openSheet(settingsSheet, settingsToggle);
  });
  settingsCloseBtn.addEventListener('click', () => closeSheet(settingsSheet, settingsToggle));
  settingsSheet.addEventListener('click', (e) => { if (e.target === settingsSheet) closeSheet(settingsSheet, settingsToggle); });

  dockToggle.addEventListener('click', () => {
    if (isSheetOpen(hostSheet)) { closeSheet(hostSheet, dockToggle); return; }
    closeSheet(settingsSheet, settingsToggle);
    openSheet(hostSheet, dockToggle);
    setTimeout(() => { if (!hostInput.disabled) hostInput.focus(); }, 260);
  });
  hostCloseBtn.addEventListener('click', () => closeSheet(hostSheet, dockToggle));
  hostSheet.addEventListener('click', (e) => { if (e.target === hostSheet) closeSheet(hostSheet, dockToggle); });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (isSheetOpen(settingsSheet)) closeSheet(settingsSheet, settingsToggle);
    if (isSheetOpen(hostSheet)) closeSheet(hostSheet, dockToggle);
  });

  diagBtn.addEventListener('click', () => {
    const nowHidden = diagPanel.classList.toggle('hidden');
    diagBtn.setAttribute('aria-expanded', String(!nowHidden));
  });

  // ============================================================
  // Collapsible top status bar (item 4) — hide it entirely for a
  // cleaner screen, with a slim pull-tab to bring it back any time.
  // Remembered between visits, same as the other settings.
  // ============================================================
  function syncTopOffset() {
    if (diagnosticsEl.classList.contains('collapsed')) {
      document.documentElement.style.setProperty('--topbar-h', expandTab.offsetHeight + 'px');
    } else {
      document.documentElement.style.removeProperty('--topbar-h');
    }
  }
  function setTopCollapsed(collapsed) {
    diagnosticsEl.classList.toggle('collapsed', collapsed);
    expandTab.classList.toggle('hidden', !collapsed);
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    requestAnimationFrame(syncTopOffset);
  }
  collapseBtn.addEventListener('click', () => {
    settings.topCollapsed = true;
    saveSettings();
    setTopCollapsed(true);
  });
  expandTab.addEventListener('click', () => {
    settings.topCollapsed = false;
    saveSettings();
    setTopCollapsed(false);
  });
  window.addEventListener('resize', syncTopOffset);

  // ============================================================
  // Fullscreen. The layout keeps its fixed maximum width and stays
  // centered, so going fullscreen never stretches the game.
  // ============================================================
  const fsBtn = el('fsBtn');
  const fsIconEnter = el('fsIconEnter');
  const fsIconExit = el('fsIconExit');
  const fsRoot = document.documentElement;

  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function fsSupported() { return !!(fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen); }

  function syncFsButton() {
    const on = !!fsElement();
    fsBtn.setAttribute('aria-pressed', String(on));
    fsBtn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
    fsBtn.title = on ? 'Exit fullscreen' : 'Enter fullscreen';
    fsIconEnter.classList.toggle('hidden', on);
    fsIconExit.classList.toggle('hidden', !on);
    setRealVH();
  }
  fsBtn.addEventListener('click', async () => {
    if (!fsSupported()) {
      toast('Fullscreen isn’t available in this browser. On iPhone, tap Share, then Add to Home Screen, and open the game from your home screen.');
      return;
    }
    try {
      if (fsElement()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else await (fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen).call(fsRoot);
    } catch (e) {
      toast('Could not switch fullscreen mode.');
    }
  });
  document.addEventListener('fullscreenchange', syncFsButton);
  document.addEventListener('webkitfullscreenchange', syncFsButton);

  // ============================================================
  // Settings (remembered between visits on this device)
  // ============================================================
  const MODE_META = {
    live:    { label: 'Live',    hint: 'Reads your TikTok LIVE chat. Needs internet.' },
    test:    { label: 'Test',    hint: 'Rehearse with simulated viewers. No TikTok needed.' },
    offline: { label: 'Offline', hint: 'No TikTok, no internet. You type each guess yourself.' },
  };
  const STORE_KEY = 'contextoLive.settings.v3';
  const DEFAULTS = {
    mode: 'live', username: '', length: 'any',
    autoplay: true, speed: 'normal', playerName: '',
    topCollapsed: false,
  };
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* private mode etc. */ }
  }
  const settings = Object.assign({}, DEFAULTS, loadSettings());
  if (!MODE_META[settings.mode]) settings.mode = 'live';

  function setSelect(select, value) {
    select.value = value;
    if (select.value !== value) select.selectedIndex = 0;
  }
  tiktokUsername.value = settings.username;
  setSelect(lengthSelect, settings.length);
  setSelect(speedSelect, settings.speed);
  autoplayToggle.checked = !!settings.autoplay;
  playerName.value = settings.playerName;

  // Live state mirrors
  let lastState = null;
  let conn = { status: 'idle', message: '', username: null };
  let starting = false;   // waiting for the server to build a round
  let armed = false;      // "End round" needs a second tap
  let armTimer = null;

  function isActive() { return !!(lastState && lastState.game.active); }
  function connActive() { return ['connecting', 'retrying', 'connected'].includes(conn.status); }

  function selectMode(mode) {
    settings.mode = mode;
    saveSettings();
    segBtns.forEach((b) => {
      const on = b.dataset.mode === mode;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    panes.forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== mode));
    modeHint.textContent = MODE_META[mode].hint;
    settingsEl.dataset.mode = mode;
    updateSummary();
    updateDock();
    updateHero();
  }
  segBtns.forEach((b, i) => {
    b.addEventListener('click', () => selectMode(b.dataset.mode));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const step = e.key === 'ArrowRight' ? 1 : segBtns.length - 1;
      const next = segBtns[(i + step) % segBtns.length];
      next.focus();
      selectMode(next.dataset.mode);
      e.preventDefault();
    });
  });

  // A small colored dot on the Settings icon is the only always-visible
  // trace of the current mode — enough to glance at, never enough to
  // clutter the action bar.
  function updateSummary() {
    modePip.className = 'mode-pip mode-' + settings.mode;
    let title = MODE_META[settings.mode].label;
    if (settings.mode === 'live') {
      title += conn.status === 'connected' ? ' · @' + (conn.username || settings.username) : ' · Not connected';
    } else if (settings.mode === 'test') {
      title += settings.autoplay ? ' · Simulated chat' : ' · Manual guesses';
    } else {
      title += ' · Manual guesses';
    }
    settingsToggle.title = 'Settings (' + title + ')';
  }

  tiktokUsername.addEventListener('input', () => {
    settings.username = tiktokUsername.value.trim().replace(/^@/, '');
    saveSettings();
  });
  tiktokUsername.addEventListener('keydown', (e) => { if (e.key === 'Enter') connectBtn.click(); });
  lengthSelect.addEventListener('change', () => { settings.length = lengthSelect.value; saveSettings(); });

  function syncAutoplayUi() {
    autoplayText.textContent = autoplayToggle.checked ? 'On' : 'Off';
    speedSelect.disabled = !autoplayToggle.checked;
  }
  function pushAutoplay() {
    // Changing the simulator mid-round takes effect immediately.
    if (isActive() && lastState.mode === 'test') {
      send({ type: 'test_autoplay', on: settings.autoplay, speed: settings.speed });
    }
  }
  autoplayToggle.addEventListener('change', () => {
    settings.autoplay = autoplayToggle.checked;
    saveSettings(); syncAutoplayUi(); updateSummary(); pushAutoplay();
  });
  speedSelect.addEventListener('change', () => {
    settings.speed = speedSelect.value;
    saveSettings(); updateSummary(); pushAutoplay();
  });
  syncAutoplayUi();

  playerName.addEventListener('input', () => { settings.playerName = playerName.value.trim(); saveSettings(); });

  connectBtn.addEventListener('click', () => {
    if (connActive()) { send({ type: 'disconnect_tiktok' }); return; }
    const name = tiktokUsername.value.trim().replace(/^@/, '');
    if (!name) return toast('Enter a TikTok username first.');
    settings.username = name;
    saveSettings();
    send({ type: 'connect_tiktok', username: name });
  });

  // Test / Offline word menus are filled from the server's built-in list.
  function fillWordChoices(list) {
    [testWord, offlineWord].forEach((sel) => {
      if (sel.dataset.filled === String(list.length)) return;
      const current = sel.value;
      sel.innerHTML = '<option value="">Random</option>' +
        list.map((w) => `<option value="${escapeHtml(w)}">${escapeHtml(cap(w))}</option>`).join('');
      sel.value = current;
      sel.dataset.filled = String(list.length);
    });
  }

  // ============================================================
  // Hint button
  // ============================================================
  function updateHintButton() {
    const active = isActive();
    const remaining = lastState && lastState.game ? (lastState.game.hintsAvailable || 0) : 0;
    hintBtn.disabled = !active || remaining <= 0;
    hintBtn.title = !active
      ? 'Start a round to use hints'
      : (remaining > 0 ? `Reveal the next-best word (${remaining} left to reveal)` : 'Every ranked word has already been found');
  }
  hintBtn.addEventListener('click', () => {
    if (hintBtn.disabled) return;
    send({ type: 'request_hint' });
  });

  // ============================================================
  // Start / end round (one button, always visible)
  // ============================================================
  function updateRoundButton() {
    const active = isActive();
    const finished = !!(lastState && !lastState.game.active && lastState.game.result);
    if (!active) armed = false;
    let text;
    if (starting) text = 'Starting…';
    else if (active) text = armed ? 'Tap again to end' : 'End round';
    else text = finished ? 'New round' : 'Start round';
    roundBtn.textContent = text;
    roundBtn.disabled = starting;
    roundBtn.className = 'btn ' + (active ? 'btn-ghost' : 'btn-primary') + (armed ? ' armed' : '');
  }

  function startRound() {
    const mode = settings.mode;
    starting = true;
    updateRoundButton();
    setTimeout(() => { if (starting) { starting = false; updateRoundButton(); } }, 15000);

    if (mode === 'live') {
      if (conn.status !== 'connected') {
        toast('Not connected to TikTok yet — chat guesses will only arrive once you connect.');
      }
      send({ type: 'start_game', mode, length: settings.length, word: liveWord.value.trim() });
      liveWord.value = ''; // never leave the secret word sitting on screen
    } else if (mode === 'test') {
      send({ type: 'start_game', mode, word: testWord.value, autoplay: settings.autoplay, speed: settings.speed });
    } else {
      send({ type: 'start_game', mode, word: offlineWord.value });
    }
  }

  roundBtn.addEventListener('click', () => {
    if (isActive()) {
      if (!armed) {
        armed = true;
        updateRoundButton();
        clearTimeout(armTimer);
        armTimer = setTimeout(() => { armed = false; updateRoundButton(); }, 3000);
        return;
      }
      clearTimeout(armTimer);
      armed = false;
      send({ type: 'give_up' });
      updateRoundButton();
      return;
    }
    startRound();
  });

  // ============================================================
  // Host word entry
  // ============================================================
  function updateDock() {
    const active = isActive();
    const mode = active ? lastState.mode : settings.mode;
    playerName.classList.toggle('hidden', mode !== 'offline');
    hostInput.disabled = !active;
    hostGuessBtn.disabled = !active;
    hostInput.placeholder = !active
      ? 'Start a round to guess'
      : (mode === 'offline' ? 'Word they guessed…' : 'Type a word to guess…');
  }

  function submitGuess() {
    const text = hostInput.value.trim();
    if (!text) return;
    send({ type: 'host_guess', text, name: playerName.value.trim() });
    hostInput.value = '';
    hostInput.focus();
  }
  hostGuessBtn.addEventListener('click', submitGuess);
  hostInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitGuess(); });

  // ============================================================
  // Rank -> authentic Contexto color tiers
  // (1 exact / 2-50 dark green / 51-300 green / 301-1500 orange / 1501+ red)
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

  // A word somebody already guessed this round (real words only — a repeated
  // non-word just stays "not a word").
  function isAlreadyGuessed(entry) { return !!entry.isRepeat && entry.rank != null; }

  function rowClass(entry) {
    return 'guess-row' +
      (entry.isWin ? ' win' : '') +
      (entry.isHost ? ' host' : '') +
      (entry.isHint ? ' hint' : '') +
      (isAlreadyGuessed(entry) ? ' repeat' : '');
  }
  function rowHtml(entry) {
    let note = '';
    if (isAlreadyGuessed(entry)) {
      note = `<span class="guess-note" title="First guessed by ${escapeHtml(entry.repeatOf)}">Already guessed</span>`;
    } else if (entry.points > 0) {
      note = `<span class="guess-pts" title="Points earned">+${entry.points}</span>`;
    } else if (entry.isHint) {
      note = `<span class="guess-note" title="Revealed with a hint">Hint</span>`;
    }
    const displayUser = entry.isHint ? '💡 Hint' : entry.user;
    return `
      <div class="guess-heat" style="width:${heatWidth(entry.rank)};background:${tierColor(entry.rank)}"></div>
      <span class="guess-user">${escapeHtml(displayUser)}</span>
      <span class="guess-word">${escapeHtml(entry.word)}</span>
      ${note}
      <span class="guess-rank ${tierClass(entry.rank)}">${rankLabel(entry.rank)}</span>
    `;
  }

  // ============================================================
  // Latest guess (single line above the board)
  // ============================================================
  function renderLatest(entry) {
    if (!entry) {
      latestRow.className = 'guess-row is-empty';
      latestRow.textContent = 'Waiting for the first guess…';
      return;
    }
    latestRow.className = rowClass(entry);
    latestRow.innerHTML = rowHtml(entry);
    if (!reduceMotion && latestRow.animate) {
      latestRow.animate([{ filter: 'brightness(1.6)' }, { filter: 'none' }], { duration: 350, easing: 'ease-out' });
    }
  }

  // ============================================================
  // Live guesses — one row per word, always sorted by rank.
  // Rows glide to their new position (FLIP) whenever the order changes.
  // ============================================================
  const MAX_ROWS = 150;
  const board = new Map();   // word -> entry
  const rowEls = new Map();  // word -> element
  let renderQueued = false;

  function upsertBoard(entry) {
    if (entry.rank == null) return; // non-words only show in the "Latest" line
    const existing = board.get(entry.word);
    if (!existing || ((existing.isHost || existing.isHint) && !entry.isHost)) board.set(entry.word, entry);
  }

  function entrySig(e) { return [e.user, e.rank, e.points, e.isHost, e.isHint, e.isWin].join('|'); }

  function scheduleBoardRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; renderBoard(); });
  }

  // Always re-sorts closest-first, top to bottom, every time it runs —
  // this is what keeps the board continuously ranked as guesses arrive.
  function renderBoard() {
    const entries = Array.from(board.values()).sort((a, b) => a.rank - b.rank).slice(0, MAX_ROWS);
    const keep = new Set(entries.map((e) => e.word));

    // FIRST: where every existing row is right now.
    const before = new Map();
    rowEls.forEach((row, word) => before.set(word, row.getBoundingClientRect().top));

    rowEls.forEach((row, word) => {
      if (!keep.has(word)) { row.remove(); rowEls.delete(word); }
    });

    // Create / update rows and put each one in its sorted slot.
    entries.forEach((entry, i) => {
      let row = rowEls.get(entry.word);
      if (!row) {
        row = document.createElement('div');
        row.className = rowClass(entry) + ' is-new';
        row.innerHTML = rowHtml(entry);
        row.addEventListener('animationend', () => row.classList.remove('is-new'), { once: true });
        rowEls.set(entry.word, row);
      } else if (row._sig !== entrySig(entry)) {
        // Same word, different finder (e.g. a viewer replaced a host/hint entry).
        row.className = rowClass(entry);
        row.innerHTML = rowHtml(entry);
      }
      row._sig = entrySig(entry);
      if (guessList.children[i] !== row) guessList.insertBefore(row, guessList.children[i] || null);
    });

    // LAST + PLAY: slide rows from their old position to the new one.
    if (!reduceMotion) {
      entries.forEach((entry) => {
        const row = rowEls.get(entry.word);
        if (!before.has(entry.word) || !row.animate) return;
        const dy = before.get(entry.word) - row.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) {
          row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 300, easing: 'ease-out' });
        }
      });
    }

    guessEmpty.classList.toggle('hidden', entries.length > 0);
  }

  // ============================================================
  // Hero / stats / banners
  // ============================================================
  function setStats(total, players) {
    statGuesses.textContent = plural(total, 'guess', 'guesses');
    statPlayers.textContent = plural(players, 'player', 'players');
    guessCount.textContent = plural(total, 'guess', 'guesses');
  }

  function setDiffChip(state) {
    if (!(state.game.active || state.game.result) || !state.mode) { statDiff.classList.add('hidden'); return; }
    statDiff.textContent = MODE_META[state.mode].label;
    statDiff.className = 'diff-chip diff-' + state.mode;
    statDiff.classList.remove('hidden');
  }

  function updateHero() {
    const st = lastState;
    let text = 'Pick a mode, adjust the settings, then start a round.';
    if (st && st.game.active) {
      if (st.mode === 'live') text = 'Round live. Guesses from TikTok chat appear below.';
      else if (st.mode === 'test') text = st.autoplay && st.autoplay.running
        ? 'Test round. Simulated viewers are guessing.'
        : 'Test round. Type a guess below.';
      else text = 'Offline round. Type each player’s guess below.';
    } else if (st && st.game.result) {
      text = 'Round finished. Tap New round when you’re ready.';
    }
    heroSub.textContent = text;
  }

  function showResult(result) {
    winBanner.classList.add('hidden');
    giveUpBanner.classList.add('hidden');
    if (!result) return;
    if (result.gaveUp) {
      giveUpWord.textContent = result.word.toUpperCase();
      giveUpBanner.classList.remove('hidden');
      return;
    }
    winnerName.textContent = result.winner;
    winWord.textContent = result.word.toUpperCase();
    let meta = `Solved in ${plural(result.guesses, 'guess', 'guesses')}.`;
    if (result.points > 0) meta += ` +${result.points} points (${result.total} total).`;
    winMeta.textContent = meta;
    winBanner.classList.remove('hidden');
  }

  function launchConfetti() {
    if (reduceMotion) return;
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

  // ============================================================
  // Floating "+N points" popup — audience avatar, name, word, points.
  // ============================================================
  function showPointsPopup(entry) {
    if (!entry || entry.isHost || entry.isHint || !(entry.points > 0)) return;
    const card = document.createElement('div');
    card.className = 'points-popup';
    card.innerHTML = `
      ${avatarHtml(entry.user, entry.avatar)}
      <div class="pp-text">
        <div class="pp-name">${escapeHtml(entry.user)}</div>
        <div class="pp-word">guessed “${escapeHtml(entry.word)}”</div>
      </div>
      <div class="pp-pts">+${entry.points}</div>
    `;
    pointsPopupHost.appendChild(card);
    setTimeout(() => card.remove(), 3000);
  }

  // ============================================================
  // Round-end floating sequence: answer + this round's top scorers,
  // then (auto-advancing, no tap needed) the all-time leaderboard.
  // ============================================================
  let overlayTimer1 = null;
  let overlayTimer2 = null;

  function renderLbList(container, rows, emptyText) {
    if (!rows || !rows.length) {
      container.innerHTML = `<li class="lb-empty">${escapeHtml(emptyText)}</li>`;
      return;
    }
    container.innerHTML = rows.map((r, i) => `
      <li class="lb-row">
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${escapeHtml(r.user)}</span>
        <span class="lb-score">${r.points != null ? '+' + r.points : r.score}</span>
      </li>
    `).join('');
  }

  function runRoundEndSequence(result) {
    if (!result) return;
    clearTimeout(overlayTimer1);
    clearTimeout(overlayTimer2);
    roundEndOverlay.classList.add('hidden');
    leaderboardOverlay.classList.add('hidden');

    overlayAnswerWord.textContent = (result.word || '').toUpperCase();
    overlayRoundMeta.textContent = result.gaveUp
      ? `Round ended after ${plural(result.guesses, 'guess', 'guesses')}.`
      : `Found by ${result.winner} in ${plural(result.guesses, 'guess', 'guesses')}.`;

    const scorers = result.topScorers || [];
    overlayScorersWrap.classList.toggle('hidden', scorers.length === 0);
    if (scorers.length) renderLbList(overlayScorers, scorers, '');

    roundEndOverlay.classList.remove('hidden');
    overlayTimer1 = setTimeout(() => {
      roundEndOverlay.classList.add('hidden');
      const top = result.leaderboardTop || (lastState && lastState.leaderboardTop) || [];
      renderLbList(overlayLeaderboardList, top, 'No scores yet this session.');
      leaderboardOverlay.classList.remove('hidden');
      overlayTimer2 = setTimeout(() => leaderboardOverlay.classList.add('hidden'), 5000);
    }, 4200);
  }

  // ============================================================
  // Manual leaderboard controls (item 7) — view any time from Settings,
  // and reset the all-time session leaderboard (double-tap to confirm,
  // same pattern as "End round").
  // ============================================================
  function closeLeaderboardOverlay() {
    clearTimeout(overlayTimer2);
    leaderboardOverlay.classList.add('hidden');
  }
  viewLeaderboardBtn.addEventListener('click', () => {
    const top = (lastState && lastState.leaderboardTop) || [];
    renderLbList(overlayLeaderboardList, top, 'No scores yet this session.');
    roundEndOverlay.classList.add('hidden');
    leaderboardOverlay.classList.remove('hidden');
  });
  leaderboardCloseBtn.addEventListener('click', closeLeaderboardOverlay);
  leaderboardOverlay.addEventListener('click', (e) => { if (e.target === leaderboardOverlay) closeLeaderboardOverlay(); });

  let resetArmed = false;
  let resetArmTimer = null;
  function disarmReset() {
    resetArmed = false;
    resetLeaderboardBtn.textContent = 'Reset leaderboard';
    resetLeaderboardBtn.classList.remove('armed');
  }
  resetLeaderboardBtn.addEventListener('click', () => {
    if (!resetArmed) {
      resetArmed = true;
      resetLeaderboardBtn.textContent = 'Tap again to confirm';
      resetLeaderboardBtn.classList.add('armed');
      clearTimeout(resetArmTimer);
      resetArmTimer = setTimeout(disarmReset, 3000);
      return;
    }
    clearTimeout(resetArmTimer);
    disarmReset();
    send({ type: 'reset_leaderboard' });
    toast('Leaderboard reset.');
  });

  // ============================================================
  // Server -> client message handling
  // ============================================================
  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'state': renderState(msg.state); break;
      case 'raw_event': renderDiagnostics(msg); break;
      case 'guess': onGuess(msg); break;
      case 'hint': onHint(msg); break;
      case 'game_started': onGameStarted(); break;
      case 'win':
        showResult({ word: msg.word, winner: msg.user, gaveUp: false, guesses: msg.guessesUsed, points: msg.points, total: msg.total });
        launchConfetti();
        runRoundEndSequence(msg.result);
        break;
      case 'give_up':
        showResult({ word: msg.word, gaveUp: true });
        if (msg.entry) { upsertBoard(msg.entry); scheduleBoardRender(); }
        runRoundEndSequence(msg.result);
        break;
      case 'server_error':
        starting = false;
        updateRoundButton();
        toast(msg.message);
        break;
    }
  }

  function onGuess(msg) {
    upsertBoard(msg.entry);
    renderLatest(msg.entry);
    setStats(msg.totalGuesses, msg.players);
    scheduleBoardRender();
    showPointsPopup(msg.entry);
  }

  function onHint(msg) {
    upsertBoard(msg.entry);
    renderLatest(msg.entry);
    scheduleBoardRender();
  }

  function onGameStarted() {
    starting = false;
    board.clear();
    scheduleBoardRender();
    renderLatest(null);
    showResult(null);
    setStats(0, 0);
    statsRow.classList.remove('hidden');
    // Close both sheets once the round is live, so the board gets the space.
    closeSheet(settingsSheet, settingsToggle);
    closeSheet(hostSheet, dockToggle);
    updateRoundButton();
    updateHintButton();
  }

  function renderState(state) {
    lastState = state;
    conn = state.connection;

    // Header
    diagStatus.textContent = conn.status;
    connLabel.textContent = conn.message;
    connDot.className = 'dot dot-' + conn.status;
    expandDot.className = 'dot dot-' + conn.status;
    if (state.mode) {
      modeBadge.textContent = MODE_META[state.mode].label;
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
    if (state.dictionary) {
      const d = state.dictionary;
      const n = d.total.toLocaleString('en-US');
      diagDict.classList.remove('warn');
      if (d.status === 'loading') diagDict.textContent = `Loading… ${n} so far`;
      else if (d.total < d.target) { diagDict.textContent = `${n} words (under ${d.target.toLocaleString('en-US')})`; diagDict.classList.add('warn'); }
      else diagDict.textContent = `${n} words`;
    }
    if (state.diagnostics.rawSamples && state.diagnostics.rawSamples.length) {
      diagRaw.textContent = state.diagnostics.rawSamples.join('\n\n---\n\n');
    }

    // Settings pane
    connNote.textContent = conn.message || '';
    connectBtn.textContent = conn.status === 'connected' ? 'Disconnect' : (connActive() ? 'Cancel' : 'Connect');
    fillWordChoices(state.wordChoices || []);
    if (state.game.active && state.mode === 'test' && state.autoplay) {
      // Reflect what the server is actually running (e.g. after a page reload).
      autoplayToggle.checked = state.autoplay.running;
      settings.autoplay = state.autoplay.running;
      setSelect(speedSelect, state.autoplay.speed);
      settings.speed = speedSelect.value;
      syncAutoplayUi();
    }
    if (state.game.active) starting = false;

    // Round
    const g = state.game;
    const hasRound = g.active || !!g.result;
    statsRow.classList.toggle('hidden', !hasRound);
    setStats(g.totalGuesses, g.uniquePlayers);
    setDiffChip(state);
    showResult(g.active ? null : g.result);

    board.clear();
    (g.board || []).forEach(upsertBoard);
    renderLatest(g.latest);
    scheduleBoardRender();

    updateSummary();
    updateRoundButton();
    updateHintButton();
    updateDock();
    updateHero();
  }

  function renderDiagnostics(msg) {
    diagCount.textContent = msg.rawEventCount;
    diagLast.textContent = `${msg.lastReceived.user}: ${msg.lastReceived.text}`;
    if (msg.rawSamples && msg.rawSamples.length) {
      diagRaw.textContent = msg.rawSamples.join('\n\n---\n\n');
    }
  }

  // ============================================================
  // Initial paint
  // ============================================================
  selectMode(settings.mode);
  setTopCollapsed(!!settings.topCollapsed);
  updateRoundButton();
  updateHintButton();
  // Both sheets start closed — a clean, uncluttered first screen. Tap the
  // gear icon to open Settings whenever you need to change something.
})();
