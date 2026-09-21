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
  mode: null, // 'live' | 'test'
  viewerCount: null,
  diagnostics: {
    rawEventCount: 0,
    lastReceived: null,
    rawSamples: [],
  },
  game: {
    active: false,
    difficulty: null,
    targetWord: null,
    targetLength: null,
    hintsGiven: [],
    hintsUsed: 0,
    guesses: [],          // chronological feed (capped)
    closestByWord: new Map(), // word -> {user, rank, ts} best-known entry, for the ranked board
    allGuessedWords: new Map(), // word -> {user, rank} first guesser, for "already guessed" tags
    tierHistory: [],       // full-round tier sequence, for the share recap (not capped like guesses)
    winner: null,
    startedAt: null,
    uniquePlayers: new Set(),
  },
  leaderboard: {}, // username -> { score, wins, guesses }
  roundHistory: [], // { word, winner, guessesUsed, players, difficulty, durationMs }
};

let rankMap = new Map();
let orderedWords = [];

function getPublicState() {
  return {
    connection: state.connection,
    mode: state.mode,
    viewerCount: state.viewerCount,
    diagnostics: state.diagnostics,
    game: {
      active: state.game.active,
      difficulty: state.game.difficulty,
      targetLength: state.game.targetLength,
      hintsGiven: state.game.hintsGiven,
      hintsUsed: state.game.hintsUsed,
      guesses: state.game.guesses.slice(-40),
      closest: closestBoard(10),
      winner: state.game.winner,
      uniquePlayers: state.game.uniquePlayers.size,
      totalGuesses: state.game.guesses.length,
    },
    leaderboard: topLeaderboard(10),
    roundHistory: state.roundHistory.slice(-8),
  };
}

function closestBoard(n) {
  return Array.from(state.game.closestByWord.values())
    .sort((a, b) => a.rank - b.rank)
    .slice(0, n);
}
function topLeaderboard(n) {
  return Object.entries(state.leaderboard)
    .map(([user, v]) => ({ user, score: v.score, wins: v.wins }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}
function pushState() { broadcast({ type: 'state', state: getPublicState() }); }

// ============================================================
// 3. WORD DATA / PUZZLE BUILDING
// ============================================================
const WORD_BANK = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'words.json'), 'utf8'));
const FALLBACK_PUZZLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'fallback-puzzles.json'), 'utf8'));

function normalize(w) {
  return (w || '').toLowerCase().trim().replace(/[^a-z]/g, '');
}
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

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
    state.mode = mode;
    let puzzle;

    if (mode === 'test') {
      const word = opts.word && FALLBACK_PUZZLES[normalize(opts.word)]
        ? opts.word
        : pickRandom(Object.keys(FALLBACK_PUZZLES));
      puzzle = buildPuzzleFromFallback(word);
    } else {
      const pool = WORD_BANK[difficulty] || WORD_BANK.medium;
      const word = opts.word || pickRandom(pool);
      try {
        puzzle = await buildPuzzleFromDatamuse(word);
      } catch (err) {
        console.error('[DATAMUSE FAILED]', err);
        broadcast({ type: 'server_error', message: 'Could not reach the word-similarity service, using a backup word instead.' });
        puzzle = buildPuzzleFromFallback(pickRandom(Object.keys(FALLBACK_PUZZLES)));
      }
    }

    if (!puzzle) throw new Error('Could not build a puzzle for that word.');

    rankMap = puzzle.map;
    orderedWords = puzzle.order;

    state.game.active = true;
    state.game.difficulty = difficulty;
    state.game.targetWord = puzzle.target;
    state.game.targetLength = puzzle.target.length;
    state.game.hintsGiven = [];
    state.game.hintsUsed = 0;
    state.game.guesses = [];
    state.game.closestByWord = new Map();
    state.game.allGuessedWords = new Map();
    state.game.tierHistory = [];
    state.game.winner = null;
    state.game.startedAt = Date.now();
    state.game.uniquePlayers = new Set();

    broadcast({ type: 'game_started', targetLength: state.game.targetLength, mode, difficulty });
    pushState();
  } catch (err) {
    console.error('[START GAME ERROR]', err);
    broadcast({ type: 'server_error', message: 'Could not start the game: ' + safeMsg(err) });
  }
}

// Adaptive hint: reveal a word ranked roughly halfway between the
// closest guess so far and the answer — this mirrors real Contexto's
// "easy" hint behaviour instead of a fixed, unrelated ladder.
function giveHint() {
  if (!state.game.active) return;
  const best = closestBoard(1)[0];
  const bestRank = best ? best.rank : Math.min(1200, orderedWords.length);
  if (bestRank <= 2) {
    broadcast({ type: 'server_error', message: "You're already almost there — one more good guess should do it!" });
    return;
  }
  const targetRank = Math.max(2, Math.floor(bestRank / 2));
  let hintWord = null;
  for (let r = targetRank; r >= 2; r--) {
    const candidate = orderedWords[r - 1];
    if (candidate && !state.game.hintsGiven.includes(candidate)) {
      hintWord = candidate;
      break;
    }
  }
  if (!hintWord) {
    broadcast({ type: 'server_error', message: 'No new hint available right now — try another guess first.' });
    return;
  }
  state.game.hintsGiven.push(hintWord);
  state.game.hintsUsed += 1;
  broadcast({ type: 'hint_reveal', word: hintWord });
  pushState();
}

function giveUp() {
  if (!state.game.active) return;
  const word = state.game.targetWord;
  const payload = {
    word,
    guessesUsed: state.game.guesses.length,
    hintsUsed: state.game.hintsUsed,
    players: state.game.uniquePlayers.size,
    tierHistory: state.game.tierHistory,
  };
  finishRound(null, { gaveUp: true });
  broadcast({ type: 'give_up', ...payload });
}

function finishRound(winnerUser, opts = {}) {
  const durationMs = state.game.startedAt ? Date.now() - state.game.startedAt : null;
  state.roundHistory.push({
    word: state.game.targetWord,
    winner: winnerUser,
    guessesUsed: state.game.guesses.length,
    players: state.game.uniquePlayers.size,
    difficulty: state.game.difficulty,
    gaveUp: !!opts.gaveUp,
    durationMs,
  });
  if (state.roundHistory.length > 30) state.roundHistory.shift();
  state.game.active = false;
  state.game.winner = winnerUser;
}

function scoreForRank(rank) {
  if (rank == null) return 0;
  return Math.max(0, 1000 - rank);
}

function ensureLeaderboardEntry(user) {
  if (!state.leaderboard[user]) state.leaderboard[user] = { score: 0, wins: 0, guesses: 0, seenWords: {} };
  return state.leaderboard[user];
}

function tierFor(rank) {
  if (rank == null) return 'red';
  if (rank === 1) return 'exact';
  if (rank <= 50) return 'dark-green';
  if (rank <= 300) return 'green';
  if (rank <= 1500) return 'orange';
  return 'red';
}
// Log-scaled "match" percentage — same non-linear scale the heat bar
// uses client-side, computed here too so the recap/share text can use
// a plain number without the browser re-deriving it.
function matchPercent(rank) {
  if (rank == null) return 0;
  const MAX = 3000;
  const pct = 100 * (1 - Math.log(rank) / Math.log(MAX));
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function handleGuess(user, rawText, isHost = false) {
  if (!state.game.active) return;
  const word = normalize((rawText || '').split(/\s+/)[0]);
  if (!word) return;

  const rank = rankMap.has(word) ? rankMap.get(word) : null;
  const alreadyBy = state.game.allGuessedWords.get(word);
  const isRepeat = !!alreadyBy && alreadyBy.user !== user;
  const entry = {
    user, word, rank, isHost, isWin: rank === 1, ts: Date.now(),
    percent: matchPercent(rank),
    isRepeat,
    repeatOf: isRepeat ? alreadyBy.user : null,
  };

  if (!alreadyBy) state.game.allGuessedWords.set(word, { user, rank });
  if (!isHost) state.game.tierHistory.push(tierFor(rank));

  state.game.guesses.push(entry);
  if (state.game.guesses.length > 300) state.game.guesses.shift();
  if (!isHost) state.game.uniquePlayers.add(user);

  if (rank != null) {
    const existing = state.game.closestByWord.get(word);
    if (!existing || rank < existing.rank) {
      state.game.closestByWord.set(word, { user, word, rank, ts: entry.ts });
    }

    if (!isHost) {
      const lb = ensureLeaderboardEntry(user);
      lb.guesses += 1;
      // Only award points the first time THIS user finds THIS word this
      // round — stops someone farming points by pasting the same good
      // guess over and over.
      if (!lb.seenWords[`${state.game.targetWord}:${word}`]) {
        lb.seenWords[`${state.game.targetWord}:${word}`] = true;
        lb.score += scoreForRank(rank);
      }
    }
  }

  broadcast({ type: 'guess', entry });

  if (entry.isWin && state.game.active) {
    if (!isHost) {
      const lb = ensureLeaderboardEntry(user);
      lb.wins += 1;
      lb.score += Math.max(0, 250 - state.game.guesses.length); // speed bonus
    }
    finishRound(user);
    broadcast({
      type: 'win',
      user,
      word: state.game.targetWord,
      guessesUsed: state.game.guesses.length,
      hintsUsed: state.game.hintsUsed,
      players: state.game.uniquePlayers.size,
      tierHistory: state.game.tierHistory,
    });
  }

  pushState();
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
    state.mode = 'live';

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

        handleGuess(user, text, false);
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
let testAutoplayTimer = null;
const FAKE_USERS = ['viewer_247', 'wordwiz', 'contexto_fan', 'guess_master', 'nightowl', 'tiktoker99', 'lurker_lisa', 'chatty_chris'];

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

function toggleTestAutoplay(on) {
  clearInterval(testAutoplayTimer);
  if (!on || !state.game.active) return;
  const pool = orderedWords.length ? orderedWords : ['hello', 'test', 'word'];
  testAutoplayTimer = setInterval(() => {
    if (!state.game.active) { clearInterval(testAutoplayTimer); return; }
    const guess = Math.random() < 0.12
      ? state.game.targetWord
      : pickRandom(pool.slice(0, Math.min(pool.length, 35)));
    simulateChatMessage(pickRandom(FAKE_USERS), guess);
  }, 1400);
}

// ============================================================
// 7. CLIENT -> SERVER MESSAGE ROUTER
// ============================================================
function handleClientMessage(msg, ws) {
  switch (msg.type) {
    case 'connect_tiktok':
      if (!msg.username) return safeSend(ws, { type: 'server_error', message: 'Please enter a TikTok username first.' });
      connectTikTok(msg.username.replace(/^@/, '').trim());
      break;
    case 'disconnect_tiktok':
      disconnectTikTok();
      break;
    case 'start_game':
      startGame(msg.mode === 'test' ? 'test' : 'live', { word: msg.word, difficulty: msg.difficulty });
      break;
    case 'hint':
      giveHint();
      break;
    case 'give_up':
      giveUp();
      pushState();
      break;
    case 'host_comment':
      broadcast({ type: 'host_message', text: msg.text });
      break;
    case 'host_guess':
      handleGuess('HOST', msg.text, true);
      break;
    case 'simulate_chat':
      simulateChatMessage(msg.username || pickRandom(FAKE_USERS), msg.text);
      break;
    case 'test_autoplay':
      toggleTestAutoplay(!!msg.on);
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
