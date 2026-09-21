/**
 * TikTok LIVE Contexto — Server
 * ------------------------------------------------------------
 * Everything the audience types in TikTok LIVE chat becomes a
 * guess in a Contexto-style semantic word game. See README.md
 * for the plain-language explanation of every part of this file.
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

// Full English dictionary (~275k words) used so that ANY real word a
// player guesses gets an actual rank, even when it has nothing to do
// with the target — it just lands far away (red). Only text that isn't
// a recognized English word at all is left unranked ("not a word").
// This mirrors how the real Contexto ranks its whole vocabulary rather
// than only a shortlist of closely related words.
const ENGLISH_WORDS = new Set(
  fs.readFileSync(
    (require('word-list').default) || require('word-list'),
    'utf8'
  )
    .split('\n')
    .map((w) => w.toLowerCase().trim())
    .filter(Boolean)
);

// ============================================================
// 0. CRASH PROTECTION (never let one bad message kill the server)
// ============================================================
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
  try { broadcast({ type: 'server_error', message: 'Background error caught (server kept running): ' + safeMsg(err) }); } catch {}
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
  try { broadcast({ type: 'server_error', message: 'Background error caught (server kept running): ' + safeMsg(reason) }); } catch {}
});
function safeMsg(e) {
  try { return (e && e.message) ? e.message : String(e); } catch { return 'unknown error'; }
}

// ============================================================
// 1. BASIC WEB SERVER + WEBSOCKET SETUP
// ============================================================
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// The three front-end files belong in the "public" folder. If a newer copy
// was uploaded to the top level by mistake, use that one instead of quietly
// serving an old copy from public/. Each file carries a UI_VERSION number;
// the higher number wins, and public/ wins a tie. The startup log shows
// exactly which copy is being served.
const UI_FILES = ['index.html', 'client.js', 'style.css'];
function uiVersion(file) {
  try {
    const m = fs.readFileSync(file, 'utf8').match(/UI_VERSION\s*[:=]\s*(\d+)/);
    return m ? Number(m[1]) : 0;
  } catch { return -1; } // file doesn't exist
}
const uiSource = {};
for (const name of UI_FILES) {
  const inPublic = path.join(__dirname, 'public', name);
  const inRoot = path.join(__dirname, name);
  uiSource[name] = uiVersion(inRoot) > uiVersion(inPublic) ? inRoot : inPublic;
  console.log(`[ui] ${name} <- ${path.relative(__dirname, uiSource[name])} (version ${uiVersion(uiSource[name])})`);
}
app.get(['/', '/index.html', '/client.js', '/style.css'], (req, res) => {
  const name = req.path === '/' ? 'index.html' : req.path.slice(1);
  res.set('Cache-Control', 'no-cache'); // always fetch the latest page after a deploy
  res.sendFile(uiSource[name]);
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  safeSend(ws, { type: 'state', state: getPublicState() });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleClientMessage(msg, ws);
    } catch (err) {
      console.error('[WS MESSAGE ERROR]', err);
      safeSend(ws, { type: 'server_error', message: 'Could not read that action: ' + safeMsg(err) });
    }
  });

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function safeSend(ws, obj) {
  try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) { console.error('ws send error', e); }
}
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const c of clients) {
    try { if (c.readyState === 1) c.send(msg); } catch (e) { console.error('ws broadcast error', e); }
  }
}

// ============================================================
// 2. GLOBAL STATE
// ============================================================
const state = {
  connection: { status: 'idle', message: 'Not connected yet.', username: null },
  mode: null, // mode of the current / last round: 'live' | 'test' | 'offline'
  viewerCount: null,
  autoplay: { running: false, speed: 'normal' }, // Test mode's simulated chat
  diagnostics: {
    rawEventCount: 0,
    lastReceived: null,
    rawSamples: [],
  },
  game: {
    active: false,
    difficulty: null,
    targetWord: null,
    board: new Map(),           // word -> best entry (one row per distinct ranked word)
    allGuessedWords: new Map(), // word -> { user } first player to find it (points + repeat tags)
    totalGuesses: 0,
    latest: null,               // the most recent guess, shown in the "Latest" line
    winner: null,
    result: null,               // { word, winner, gaveUp, guesses, players, points, total } once the round ends
    startedAt: null,
    uniquePlayers: new Set(),
    extendedRankMap: new Map(), // word -> rank, for valid English words outside the core semantic list
    nextExtendedRank: null,     // next rank to hand out to such a word
  },
  leaderboard: {}, // username -> { score, wins, guesses } — session totals, kept on the server
};

const MODES = ['live', 'test', 'offline'];
let rankMap = new Map();
let orderedWords = [];
let testAutoplayTimer = null;

function getPublicState() {
  return {
    connection: state.connection,
    mode: state.mode,
    viewerCount: state.viewerCount,
    autoplay: state.autoplay,
    diagnostics: state.diagnostics,
    wordChoices: WORD_CHOICES,
    game: {
      active: state.game.active,
      difficulty: state.game.difficulty,
      winner: state.game.winner,
      result: state.game.result,
      uniquePlayers: state.game.uniquePlayers.size,
      totalGuesses: state.game.totalGuesses,
      latest: state.game.latest,
      board: boardEntries(150),
    },
  };
}

// One row per distinct ranked word, closest first.
function boardEntries(n) {
  return Array.from(state.game.board.values())
    .sort((a, b) => a.rank - b.rank)
    .slice(0, n);
}
function pushState() { broadcast({ type: 'state', state: getPublicState() }); }

// ============================================================
// 3. WORD DATA / PUZZLE BUILDING
// ============================================================
const WORD_BANK = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'words.json'), 'utf8'));
const FALLBACK_PUZZLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'fallback-puzzles.json'), 'utf8'));
// Words the host can pick from in Test and Offline mode (built-in, no internet needed).
const WORD_CHOICES = Object.keys(FALLBACK_PUZZLES).sort();

function normalize(w) {
  return (w || '').toLowerCase().trim().replace(/[^a-z]/g, '');
}
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// The secret word's length is randomized every round (4-15 letters) so
// it's never confined to one length, and is never revealed up front —
// the UI has nothing that hints at how many letters it is.
const TARGET_LENGTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

// Host-selectable length ranges (Live mode). "any" keeps the original 4-15 spread.
const LENGTH_RANGES = { any: [4, 15], short: [4, 6], medium: [7, 9], long: [10, 15] };

function pickWordByRandomLength(difficulty, lengthKey) {
  const [lo, hi] = LENGTH_RANGES[lengthKey] || LENGTH_RANGES.any;
  const targetLen = pickRandom(TARGET_LENGTHS.filter((l) => l >= lo && l <= hi));
  const pool = WORD_BANK[difficulty] || WORD_BANK.medium;
  const allWords = [...WORD_BANK.easy, ...WORD_BANK.medium, ...WORD_BANK.hard];
  let candidates = pool.filter((w) => normalize(w).length === targetLen);
  if (!candidates.length) {
    // That difficulty tier doesn't have a word of this length — widen
    // the search across every difficulty rather than skip the length.
    candidates = allWords.filter((w) => normalize(w).length === targetLen);
  }
  if (!candidates.length) {
    // Still nothing: any word inside the chosen length range.
    candidates = allWords.filter((w) => { const l = normalize(w).length; return l >= lo && l <= hi; });
  }
  if (!candidates.length) candidates = pool; // last resort
  return pickRandom(candidates);
}

function pickFallbackWordByRandomLength() {
  const targetLen = pickRandom(TARGET_LENGTHS);
  const keys = Object.keys(FALLBACK_PUZZLES);
  let candidates = keys.filter((k) => normalize(k).length === targetLen);
  if (!candidates.length) candidates = keys.filter((k) => {
    const l = normalize(k).length;
    return l >= 4 && l <= 15;
  });
  if (!candidates.length) candidates = keys;
  return pickRandom(candidates);
}

// Real Contexto pulls its ranking from a semantic-similarity model.
// We approximate that with Datamuse, blending two signals the same
// way a richer embedding model would cover more of the neighborhood:
//   - ml=   "means like"   -> primary semantic closeness
//   - rel_trg= "triggers"  -> words strongly associated by co-occurrence,
//                             fills gaps ml alone misses (e.g. "barista"
//                             for "coffee")
// This needs internet access, which Render's servers have.
async function buildPuzzleFromDatamuse(word) {
  const target = normalize(word);
  const [meaningRes, triggerRes] = await Promise.all([
    fetch(`https://api.datamuse.com/words?ml=${encodeURIComponent(target)}&max=2500`),
    fetch(`https://api.datamuse.com/words?rel_trg=${encodeURIComponent(target)}&max=1000`).catch(() => null),
  ]);
  if (!meaningRes.ok) throw new Error('Datamuse responded with status ' + meaningRes.status);
  const meaningData = await meaningRes.json();
  if (!Array.isArray(meaningData) || meaningData.length < 20) throw new Error('Datamuse returned too few results for "' + target + '"');
  let triggerData = [];
  try { if (triggerRes && triggerRes.ok) triggerData = await triggerRes.json(); } catch {}

  const map = new Map();
  const order = [target];
  map.set(target, 1);
  let rank = 2;

  // Primary pass: semantic "means like" results, in their given order.
  for (const item of meaningData) {
    const w = normalize(item.word);
    if (w && !map.has(w) && !isTrivialVariant(target, w)) {
      map.set(w, rank++);
      order.push(w);
    }
  }
  // Secondary pass: fill in association-triggered words not already covered.
  for (const item of triggerData) {
    const w = normalize(item.word);
    if (w && !map.has(w) && !isTrivialVariant(target, w)) {
      map.set(w, rank++);
      order.push(w);
    }
  }
  return { target, map, order };
}

// Skips near-duplicate inflections of the target (plurals, -ing/-ed forms)
// so the game doesn't hand out a trivially "close" rank-2 slot to a word
// that's really just the same word with a suffix.
function isTrivialVariant(target, candidate) {
  if (candidate === target) return false; // handled separately
  const shorter = target.length <= candidate.length ? target : candidate;
  const longer = target.length <= candidate.length ? candidate : target;
  if (longer.startsWith(shorter) && longer.length - shorter.length <= 2) return true;
  return false;
}

function buildPuzzleFromFallback(word) {
  const target = normalize(word);
  const list = FALLBACK_PUZZLES[target];
  if (!list) return null;
  const map = new Map();
  const order = list.map(normalize);
  order.forEach((w, i) => map.set(w, i + 1));
  return { target, map, order };
}

// ============================================================
// 4. GAME LOGIC
// ============================================================
async function startGame(mode, opts = {}) {
  try {
    const difficulty = ['easy', 'medium', 'hard'].includes(opts.difficulty) ? opts.difficulty : 'medium';
    const custom = normalize(opts.word || '');
    let puzzle;

    if (mode === 'live') {
      if (opts.word && custom.length < 3) throw new Error('The secret word needs at least 3 letters.');
      const word = custom || pickWordByRandomLength(difficulty, opts.length);
      try {
        puzzle = await buildPuzzleFromDatamuse(word);
      } catch (err) {
        console.error('[DATAMUSE FAILED]', err);
        if (custom && !FALLBACK_PUZZLES[custom]) {
          throw new Error(`Could not build a ranking for "${custom}". Check the spelling, or leave the secret word empty for a random one.`);
        }
        broadcast({ type: 'server_error', message: 'Could not reach the word-similarity service, using a backup word instead.' });
        puzzle = buildPuzzleFromFallback(custom || pickRandom(Object.keys(FALLBACK_PUZZLES)));
      }
    } else {
      // Test and Offline both use the built-in word list, so they work with no internet.
      const word = custom && FALLBACK_PUZZLES[custom] ? custom : pickFallbackWordByRandomLength();
      puzzle = buildPuzzleFromFallback(word);
    }

    if (!puzzle) throw new Error('Could not build a puzzle for that word.');

    clearInterval(testAutoplayTimer);
    state.autoplay.running = false;

    rankMap = puzzle.map;
    orderedWords = puzzle.order;

    const g = state.game;
    state.mode = mode;
    g.active = true;
    g.difficulty = mode === 'live' ? difficulty : null;
    g.targetWord = puzzle.target;
    g.board = new Map();
    g.allGuessedWords = new Map();
    g.totalGuesses = 0;
    g.latest = null;
    g.winner = null;
    g.result = null;
    g.startedAt = Date.now();
    g.uniquePlayers = new Set();
    g.extendedRankMap = new Map();
    // Unrelated-but-real words are always ranked past 1500 (the red zone), even
    // when the built-in list for a word is short — otherwise they'd land in
    // the green zone and earn points they haven't earned.
    g.nextExtendedRank = Math.max(orderedWords.length + 1, 1501);

    broadcast({ type: 'game_started', mode, difficulty: g.difficulty });
    pushState();

    if (mode === 'test' && opts.autoplay) toggleTestAutoplay(true, opts.speed);
  } catch (err) {
    console.error('[START GAME ERROR]', err);
    broadcast({ type: 'server_error', message: 'Could not start the game: ' + safeMsg(err) });
  }
}

function giveUp() {
  if (!state.game.active) return;
  const g = state.game;
  const word = g.targetWord;
  // Put the answer on the board as the #1 row, so the finished list reads
  // top-down from the answer and stays on screen until the next round.
  const answer = {
    user: 'Answer', word, rank: 1, isHost: false, isWin: true, isReveal: true,
    ts: Date.now(), isRepeat: false, repeatOf: null, points: 0, total: 0,
  };
  g.board.set(word, answer);
  finishRound(null, { gaveUp: true });
  broadcast({ type: 'give_up', word, entry: answer });
}

function finishRound(winnerUser, opts = {}) {
  clearInterval(testAutoplayTimer);
  state.autoplay.running = false;
  const g = state.game;
  g.active = false;
  g.winner = winnerUser;
  g.result = {
    word: g.targetWord,
    winner: winnerUser,
    gaveUp: !!opts.gaveUp,
    guesses: g.totalGuesses,
    players: g.uniquePlayers.size,
    points: opts.points || 0,
    total: opts.total || 0,
  };
}

// ------------------------------------------------------------
// POINTS — deliberately small, so no single guess is a jackpot.
//
// Points are for DISCOVERY: a player earns them only when they are
// the first to find a word in a round. Repeating a word someone
// already found earns nothing, so pasting good words over and over
// can't farm points. The busiest a single guess can ever pay is 10
// (finding the secret word); most guesses pay 0-4.
//
// Format: [highest rank that still earns this many points, points].
// Tweak the numbers below to re-balance the game.
// ------------------------------------------------------------
const POINTS_BY_RANK = [
  [1, 10],     // the secret word itself
  [2, 8],
  [5, 7],
  [10, 6],
  [25, 5],
  [50, 4],
  [150, 3],
  [300, 2],
  [1500, 1],
  // rank 1501+ (far off, red) earns 0
];

function pointsForRank(rank) {
  if (rank == null) return 0;
  for (const [maxRank, pts] of POINTS_BY_RANK) {
    if (rank <= maxRank) return pts;
  }
  return 0;
}

function ensureLeaderboardEntry(user) {
  if (!state.leaderboard[user]) state.leaderboard[user] = { score: 0, wins: 0, guesses: 0 };
  return state.leaderboard[user];
}

// Ranks a guessed word no matter how far it is from the target:
//  - on the precomputed semantic shortlist -> that rank
//  - not on the shortlist, but a real English word -> a rank appended
//    just past the shortlist (always lands in the red zone, but it's
//    still a real, stable number instead of a dead end)
//  - not a recognized English word at all -> null ("not a word")
function resolveRank(word) {
  if (rankMap.has(word)) return rankMap.get(word);
  if (state.game.extendedRankMap.has(word)) return state.game.extendedRankMap.get(word);
  if (ENGLISH_WORDS.has(word)) {
    const rank = state.game.nextExtendedRank++;
    state.game.extendedRankMap.set(word, rank);
    return rank;
  }
  return null;
}

function handleGuess(user, rawText, isHost = false) {
  const g = state.game;
  if (!g.active) return;
  const word = normalize((rawText || '').split(/\s+/)[0]);
  if (!word) return;

  const rank = resolveRank(word);
  const prior = g.allGuessedWords.get(word); // first player to find it (host tests never count)
  const isRepeat = !!prior && prior.user !== user;
  const isWin = rank === 1;

  let points = 0;
  let total = 0;
  if (!isHost) {
    const lb = ensureLeaderboardEntry(user);
    lb.guesses += 1;
    if (!prior && rank != null) {
      points = pointsForRank(rank);
      lb.score += points;
    }
    if (isWin) lb.wins += 1;
    total = lb.score;
    if (!prior) g.allGuessedWords.set(word, { user });
    g.uniquePlayers.add(user);
  }

  const entry = {
    user, word, rank, isHost, isWin, ts: Date.now(),
    isRepeat,
    repeatOf: isRepeat ? prior.user : null,
    points,
    total,
  };

  g.totalGuesses += 1;
  g.latest = entry;

  // One row per distinct word; a real player's find replaces a host test entry.
  if (rank != null) {
    const existing = g.board.get(word);
    if (!existing || (existing.isHost && !isHost)) g.board.set(word, entry);
  }

  broadcast({ type: 'guess', entry, totalGuesses: g.totalGuesses, players: g.uniquePlayers.size });

  if (isWin) {
    finishRound(user, { points, total });
    broadcast({ type: 'win', user, word: g.targetWord, guessesUsed: g.totalGuesses, points, total });
    pushState();
  }
}

// ============================================================
// 5. TIKTOK LIVE CONNECTION
// ============================================================
let tiktokConn = null;
let retryTimer = null;

function updateConnStatus(status, message, username) {
  state.connection.status = status;
  state.connection.message = message;
  if (username !== undefined) state.connection.username = username;
  pushState();
}

// Different versions of this reverse-engineered library have exported
// the connection class under different names (WebcastPushConnection in
// v1, TikTokLiveConnection from v2 onward). We try every plausible one
// so a library upgrade doesn't silently break the whole app.
function loadConnectorClass() {
  const lib = require('tiktok-live-connector');
  return lib.TikTokLiveConnection || lib.WebcastPushConnection || lib.default || lib;
}
function loadEventNames(lib) {
  const WE = lib.WebcastEvent || {};
  return {
    CHAT: WE.CHAT || 'chat',
    DISCONNECTED: WE.DISCONNECTED || 'disconnected',
    ROOM_USER: WE.ROOM_USER || 'roomUser',
  };
}

function extractUsername(data) {
  return (
    data?.user?.uniqueId ||
    data?.uniqueId ||
    data?.user?.nickname ||
    data?.nickname ||
    data?.user?.username ||
    data?.username ||
    (data?.user?.userId ? `user_${data.user.userId}` : null) ||
    (data?.userId ? `user_${data.userId}` : null) ||
    'unknown_user'
  );
}
function extractText(data) {
  return data?.comment || data?.text || data?.content || data?.message || '';
}
function extractViewerCount(data) {
  return data?.viewerCount ?? data?.memberCount ?? data?.count ?? null;
}

async function connectTikTok(username, attempt = 1) {
  clearTimeout(retryTimer);
  const MAX_ATTEMPTS = 3;

  try {
    if (tiktokConn) { try { tiktokConn.disconnect(); } catch {} }

    const lib = require('tiktok-live-connector');
    const ConnClass = loadConnectorClass();
    const EVT = loadEventNames(lib);

    const options = {};
    if (process.env.TIKTOK_SIGN_API_KEY) {
      options.signApiKey = process.env.TIKTOK_SIGN_API_KEY;
    }

    tiktokConn = new ConnClass(username, options);

    tiktokConn.on(EVT.CHAT, (data) => {
      try {
        state.diagnostics.rawEventCount += 1;
        if (state.diagnostics.rawSamples.length < 5) {
          state.diagnostics.rawSamples.push(JSON.stringify(data, null, 2).slice(0, 4000));
        }
        const user = extractUsername(data);
        const text = extractText(data);
        state.diagnostics.lastReceived = { user, text };

        broadcast({
          type: 'raw_event',
          rawEventCount: state.diagnostics.rawEventCount,
          lastReceived: state.diagnostics.lastReceived,
          rawSamples: state.diagnostics.rawSamples,
        });

        // Chat only counts as guesses during a Live round; Test and Offline
        // rounds ignore whatever the connected chat is saying.
        if (state.mode === 'live') handleGuess(user, text, false);
      } catch (err) {
        console.error('[CHAT HANDLER ERROR]', err);
      }
    });

    tiktokConn.on(EVT.ROOM_USER, (data) => {
      try {
        const vc = extractViewerCount(data);
        if (vc != null) { state.viewerCount = vc; pushState(); }
      } catch (err) {
        console.error('[ROOM_USER HANDLER ERROR]', err);
      }
    });

    tiktokConn.on(EVT.DISCONNECTED, () => {
      updateConnStatus('error', 'Disconnected from TikTok LIVE. Tap Connect to try again.', username);
    });

    updateConnStatus('connecting', `Connecting to @${username} (attempt ${attempt} of ${MAX_ATTEMPTS})...`, username);
    await tiktokConn.connect();
    updateConnStatus('connected', `Connected to @${username}. Waiting for chat messages...`, username);
  } catch (err) {
    console.error('[TIKTOK CONNECT ERROR]', err);
    if (attempt < MAX_ATTEMPTS) {
      const delayMs = attempt * 3000;
      updateConnStatus('retrying', `Could not connect. Retrying in ${Math.round(delayMs / 1000)}s... (attempt ${attempt} of ${MAX_ATTEMPTS})`, username);
      retryTimer = setTimeout(() => connectTikTok(username, attempt + 1), delayMs);
    } else {
      updateConnStatus(
        'error',
        `Could not connect to @${username} after ${MAX_ATTEMPTS} tries. Check that: the username is correct (no @), the account is currently LIVE, and your sign key is valid. (${safeMsg(err)})`,
        username
      );
    }
  }
}

function disconnectTikTok() {
  clearTimeout(retryTimer);
  if (tiktokConn) { try { tiktokConn.disconnect(); } catch {} }
  updateConnStatus('idle', 'Disconnected.', null);
  state.viewerCount = null;
}

// ============================================================
// 6. TEST MODE SIMULATOR — no login, no external connection
// ============================================================
const FAKE_USERS = ['viewer_247', 'wordwiz', 'contexto_fan', 'guess_master', 'nightowl', 'tiktoker99', 'lurker_lisa', 'chatty_chris'];
const AUTOPLAY_MS = { slow: 2600, normal: 1400, fast: 700 };

function simulateChatMessage(username, text) {
  state.diagnostics.rawEventCount += 1;
  state.diagnostics.lastReceived = { user: username, text };
  broadcast({
    type: 'raw_event',
    rawEventCount: state.diagnostics.rawEventCount,
    lastReceived: state.diagnostics.lastReceived,
    rawSamples: state.diagnostics.rawSamples,
  });
  handleGuess(username, text, false);
}

function autoplayTick() {
  if (!state.game.active) {
    clearInterval(testAutoplayTimer);
    state.autoplay.running = false;
    return;
  }
  // Prefer words nobody has guessed yet so the board keeps filling up.
  const fresh = orderedWords.slice(1, 60).filter((w) => !state.game.allGuessedWords.has(w));
  const guess = (!fresh.length || Math.random() < 0.06) ? state.game.targetWord : pickRandom(fresh);
  simulateChatMessage(pickRandom(FAKE_USERS), guess);
}

function toggleTestAutoplay(on, speed) {
  clearInterval(testAutoplayTimer);
  state.autoplay.running = false;
  if (AUTOPLAY_MS[speed]) state.autoplay.speed = speed;
  if (on && state.game.active && state.mode === 'test') {
    state.autoplay.running = true;
    testAutoplayTimer = setInterval(autoplayTick, AUTOPLAY_MS[state.autoplay.speed]);
  }
  pushState();
}

// ============================================================
// 7. CLIENT -> SERVER MESSAGE ROUTER
// ============================================================
function handleClientMessage(msg, ws) {
  switch (msg.type) {
    case 'connect_tiktok':
      if (!msg.username) return safeSend(ws, { type: 'server_error', message: 'Please enter a TikTok username first.' });
      connectTikTok(String(msg.username).replace(/^@/, '').trim());
      break;
    case 'disconnect_tiktok':
      disconnectTikTok();
      break;
    case 'start_game':
      startGame(MODES.includes(msg.mode) ? msg.mode : 'live', {
        word: msg.word,
        difficulty: msg.difficulty,
        length: msg.length,
        autoplay: !!msg.autoplay,
        speed: msg.speed,
      });
      break;
    case 'give_up':
      giveUp();
      pushState();
      break;
    case 'host_guess':
      // Offline rounds: the host types guesses on behalf of real players,
      // so they are named and scored. Live/Test: a host entry is a test
      // guess that never scores.
      if (state.mode === 'offline') {
        handleGuess(String(msg.name || '').trim().slice(0, 24) || 'Player', msg.text, false);
      } else {
        handleGuess('HOST', msg.text, true);
      }
      break;
    case 'simulate_chat':
      simulateChatMessage(msg.username || pickRandom(FAKE_USERS), msg.text);
      break;
    case 'test_autoplay':
      toggleTestAutoplay(!!msg.on, msg.speed);
      break;
    default:
      safeSend(ws, { type: 'server_error', message: 'Unknown action: ' + msg.type });
  }
}

// ============================================================
// 8. START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`TikTok Contexto server running on port ${PORT}`);
});
