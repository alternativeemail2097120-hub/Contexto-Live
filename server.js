/**
 * TikTok LIVE Contexto — Server
 * ------------------------------------------------------------
 * Everything the audience types in TikTok LIVE chat becomes a
 * guess in a Contexto-style word game. See README.md for the
 * plain-language explanation of every part of this file.
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

// ============================================================
// 0. CRASH PROTECTION (requirement #5)
//    If one bad message throws an error, we log it and keep
//    going instead of taking the whole server down.
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
  connection: { status: 'idle', message: 'Not connected yet.', username: null }, // idle|connecting|connected|retrying|error
  mode: null, // 'live' | 'test'
  diagnostics: {
    rawEventCount: 0,
    lastReceived: null, // { user, text }
    rawSamples: [], // first few full raw payloads, stringified
  },
  game: {
    active: false,
    targetWord: null,     // hidden from clients until win
    targetLength: null,
    hintsGiven: [],        // words revealed as hints
    hintsRemaining: 0,
    guesses: [],            // recent guesses (capped)
    closest: [],             // top 10 closest-ever guesses this round, by rank asc
    winner: null,
  },
  leaderboard: {}, // username -> cumulative score (session only)
};

let rankMap = new Map();       // normalized word -> rank
let orderedWords = [];         // rank order list, used for hints
const HINT_RANK_STEPS = [1200, 600, 300, 120, 50, 20, 8];

function getPublicState() {
  return {
    connection: state.connection,
    mode: state.mode,
    diagnostics: state.diagnostics,
    game: {
      active: state.game.active,
      targetLength: state.game.targetLength,
      hintsGiven: state.game.hintsGiven,
      hintsRemaining: state.game.hintsRemaining,
      guesses: state.game.guesses.slice(-30),
      closest: state.game.closest,
      winner: state.game.winner,
    },
    leaderboard: topLeaderboard(10),
  };
}

function topLeaderboard(n) {
  return Object.entries(state.leaderboard)
    .map(([user, score]) => ({ user, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

function pushState() { broadcast({ type: 'state', state: getPublicState() }); }

// ============================================================
// 3. WORD DATA / PUZZLE BUILDING
// ============================================================
const WORD_LIST = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'words.json'), 'utf8'));
const FALLBACK_PUZZLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'fallback-puzzles.json'), 'utf8'));

function normalize(w) {
  return (w || '').toLowerCase().replace(/[^a-z]/g, '');
}

// Builds a rank map using Datamuse's free "means-like" endpoint.
// This requires internet access, which Render's servers have even
// though our own sandbox does not.
async function buildPuzzleFromDatamuse(word) {
  const target = normalize(word);
  const url = `https://api.datamuse.com/words?ml=${encodeURIComponent(target)}&max=3000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Datamuse responded with status ' + res.status);
  const data = await res.json();
  if (!Array.isArray(data) || data.length < 20) throw new Error('Datamuse returned too few results');

  const map = new Map();
  const order = [target];
  map.set(target, 1);
  let rank = 2;
  for (const item of data) {
    const w = normalize(item.word);
    if (w && !map.has(w)) {
      map.set(w, rank++);
      order.push(w);
    }
  }
  return { target, map, order };
}

function buildPuzzleFromFallback(word) {
  const target = normalize(word);
  const list = FALLBACK_PUZZLES[target];
  if (!list) return null;
  const map = new Map();
  list.forEach((w, i) => map.set(normalize(w), i + 1));
  return { target, map, order: list.map(normalize) };
}

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ============================================================
// 4. GAME LOGIC
// ============================================================
async function startGame(mode, requestedWord) {
  try {
    state.mode = mode;
    let puzzle;

    if (mode === 'test') {
      const word = requestedWord && FALLBACK_PUZZLES[normalize(requestedWord)]
        ? requestedWord
        : pickRandom(Object.keys(FALLBACK_PUZZLES));
      puzzle = buildPuzzleFromFallback(word);
    } else {
      const word = requestedWord || pickRandom(WORD_LIST);
      try {
        puzzle = await buildPuzzleFromDatamuse(word);
      } catch (err) {
        console.error('[DATAMUSE FAILED]', err);
        broadcast({ type: 'server_error', message: 'Could not reach the word-similarity service, using a backup word list instead.' });
        puzzle = buildPuzzleFromFallback(pickRandom(Object.keys(FALLBACK_PUZZLES)));
      }
    }

    if (!puzzle) throw new Error('Could not build a puzzle for that word.');

    rankMap = puzzle.map;
    orderedWords = puzzle.order;

    state.game.active = true;
    state.game.targetWord = puzzle.target;
    state.game.targetLength = puzzle.target.length;
    state.game.hintsGiven = [];
    state.game.hintsRemaining = HINT_RANK_STEPS.length;
    state.game.guesses = [];
    state.game.closest = [];
    state.game.winner = null;

    broadcast({ type: 'game_started', targetLength: state.game.targetLength, mode });
    pushState();
  } catch (err) {
    console.error('[START GAME ERROR]', err);
    broadcast({ type: 'server_error', message: 'Could not start the game: ' + safeMsg(err) });
  }
}

function giveHint() {
  if (!state.game.active) return;
  const stepIndex = HINT_RANK_STEPS.length - state.game.hintsRemaining;
  if (stepIndex >= HINT_RANK_STEPS.length) return;
  const targetRank = HINT_RANK_STEPS[stepIndex];
  // find the word in orderedWords whose rank is closest to (but not below) targetRank
  let hintWord = null;
  for (let r = targetRank; r >= 1; r--) {
    const candidate = orderedWords[r - 1];
    if (candidate && candidate !== state.game.targetWord && !state.game.hintsGiven.includes(candidate)) {
      hintWord = candidate;
      break;
    }
  }
  if (!hintWord) return;
  state.game.hintsGiven.push(hintWord);
  state.game.hintsRemaining -= 1;
  broadcast({ type: 'hint_reveal', word: hintWord, approxRank: targetRank });
  pushState();
}

function scoreForRank(rank) {
  if (rank == null) return 0;
  return Math.max(0, 1000 - rank);
}

function handleGuess(user, rawText, isHost = false) {
  if (!state.game.active) return;
  const word = normalize((rawText || '').split(/\s+/)[0]);
  if (!word) return;

  const rank = rankMap.has(word) ? rankMap.get(word) : null;
  const entry = { user, word, rank, isHost, isWin: rank === 1, ts: Date.now() };

  state.game.guesses.push(entry);
  if (state.game.guesses.length > 200) state.game.guesses.shift();

  if (rank != null) {
    state.game.closest.push(entry);
    state.game.closest.sort((a, b) => a.rank - b.rank);
    state.game.closest = state.game.closest.slice(0, 10);

    if (!isHost) {
      const pts = scoreForRank(rank);
      state.leaderboard[user] = (state.leaderboard[user] || 0) + pts;
    }
  }

  broadcast({ type: 'guess', entry });

  if (entry.isWin && !state.game.winner) {
    state.game.winner = user;
    state.game.active = false;
    broadcast({ type: 'win', user, word: state.game.targetWord });
  }

  pushState();
}

// ============================================================
// 5. TIKTOK LIVE CONNECTION (requirement #1, #2, #4, #6)
// ============================================================
let tiktokConn = null;
let retryTimer = null;

function updateConnStatus(status, message, username) {
  state.connection.status = status;
  state.connection.message = message;
  if (username !== undefined) state.connection.username = username;
  pushState();
}

function loadConnectorClass() {
  const lib = require('tiktok-live-connector');
  // Different versions of this reverse-engineered library have used
  // different export names. We try every plausible one so a library
  // upgrade doesn't silently break the whole app (requirement #1/#2).
  return lib.WebcastPushConnection || lib.TikTokLiveConnection || lib.default || lib;
}

// Pulls a value out of the raw event using every field name we've
// ever seen this library use, in priority order. Never trust a
// single hardcoded field name (requirement #2).
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
  return (
    data?.comment ||
    data?.text ||
    data?.content ||
    data?.message ||
    ''
  );
}

async function connectTikTok(username, attempt = 1) {
  clearTimeout(retryTimer);
  const MAX_ATTEMPTS = 3;

  try {
    if (tiktokConn) {
      try { tiktokConn.disconnect(); } catch {}
    }

    const ConnClass = loadConnectorClass();
    const options = {};
    if (process.env.TIKTOK_SIGN_API_KEY) {
      // Required signing key (eulerstream.com) — see requirement #4.
      options.signApiKey = process.env.TIKTOK_SIGN_API_KEY;
    }

    tiktokConn = new ConnClass(username, options);
    state.mode = 'live';

    tiktokConn.on('chat', (data) => {
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

    tiktokConn.on('disconnected', () => {
      updateConnStatus('error', 'Disconnected from TikTok LIVE. Click Connect to try again.', username);
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
        `Could not connect to @${username} after ${MAX_ATTEMPTS} tries. Check that: the username is correct, the account is currently LIVE, and your sign key is valid. (${safeMsg(err)})`,
        username
      );
    }
  }
}

function disconnectTikTok() {
  clearTimeout(retryTimer);
  if (tiktokConn) {
    try { tiktokConn.disconnect(); } catch {}
  }
  updateConnStatus('idle', 'Disconnected.', null);
}

// ============================================================
// 6. TEST MODE SIMULATOR (requirement #8)
//    No login, no external connection — pure local simulation.
// ============================================================
let testAutoplayTimer = null;
const FAKE_USERS = ['viewer_247', 'wordwiz', 'contexto_fan', 'guess_master', 'nightowl', 'tiktoker99'];

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
    const guess = Math.random() < 0.15
      ? state.game.targetWord
      : pickRandom(pool.slice(0, Math.min(pool.length, 400)));
    simulateChatMessage(pickRandom(FAKE_USERS), guess);
  }, 1500);
}

// ============================================================
// 7. CLIENT -> SERVER MESSAGE ROUTER
// ============================================================
function handleClientMessage(msg, ws) {
  switch (msg.type) {
    case 'connect_tiktok':
      if (!msg.username) return safeSend(ws, { type: 'server_error', message: 'Please enter a TikTok username first.' });
      connectTikTok(msg.username.replace(/^@/, ''));
      break;
    case 'disconnect_tiktok':
      disconnectTikTok();
      break;
    case 'start_game':
      startGame(msg.mode === 'test' ? 'test' : 'live', msg.word);
      break;
    case 'hint':
      giveHint();
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
