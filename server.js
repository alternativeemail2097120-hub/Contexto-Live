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
const os = require('os');
const { WebSocketServer } = require('ws');

// ------------------------------------------------------------
// ENGLISH DICTIONARY
// Used so that ANY real word a player guesses gets an actual rank, even
// when it has nothing to do with the target — it just lands far away
// (red). Text that isn't a recognized word is left unranked ("not a
// word"). This mirrors how the real Contexto ranks its whole vocabulary
// rather than only a shortlist of closely related words.
//
// The dictionary is merged from several sources:
//   1. the bundled `word-list` package (about 275,000 words) — loaded
//      instantly, so the game works the moment the server starts
//   2. any .txt files you drop into data/dictionaries/ (one word per line)
//   3. large public word lists, downloaded once when the server starts
//      (and remembered in a temporary file so restarts are quick)
// The total is printed in the logs and shown in the status drawer.
// ------------------------------------------------------------
const DICTIONARY_TARGET = 400000;
const ENGLISH_WORDS = new Set();
const dictionary = { total: 0, target: DICTIONARY_TARGET, status: 'loading' };

// Words the game will never pick as the SECRET word, even though they're
// still valid to type as a guess. Keeps a broadcast-safe target word while
// leaving the guessable dictionary untouched. Add more, one per line, in
// data/dictionaries/blocklist.txt (see the README) if you find gaps.
const TARGET_BLOCKLIST = new Set(('nigger nigga fuck fucking fucker fucked shit shitty cunt cock cocks dick dicks ' +
  'pussy pussies bitch bitches asshole assholes whore whores slut sluts rape raping rapist ' +
  'faggot faggots fag fags retard retarded nazi nazis hitler molest molester paedophile pedophile ' +
  'pedo incest bestiality suicide masturbate masturbation orgasm penis vagina semen sperm ejaculate').split(' '));

const TWO_LETTER_WORDS = new Set(('aa ab ad ae ag ah ai al am an ar as at aw ax ay ba be bi bo by ca ch da de do ' +
  'ea ed ee ef eh el em en er es ex fa fe fy gi go gu ha he hi hm ho id if in io is it jo ka ki la li lo ma me mi ' +
  'mm mo mu my na ne no nu od oe of oh oi ok om on oo op or os ou ow ox oy pa pe pi po qi re sh si so st ta te ti ' +
  'to uh um un up us ut we wo xi xu ya ye yo yu za zo').split(' '));

// Adds every usable word in `text` (one per line) and returns how many
// were new. Big public lists contain junk (stray letters, capitalised
// proper names, hyphenated fragments), so entries are filtered: letters
// a-z only, single letters must be "a" or "i", and 2-letter entries must
// be real 2-letter words. With `strict`, capitalised entries (proper
// nouns, acronyms) are skipped too.
function addWords(text, { strict = false } = {}) {
  let added = 0;
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    if (strict && raw !== raw.toLowerCase()) continue;
    const w = raw.toLowerCase();
    if (!/^[a-z]+$/.test(w)) continue;
    if (w.length === 1 && w !== 'a' && w !== 'i') continue;
    if (w.length === 2 && !TWO_LETTER_WORDS.has(w)) continue;
    if (!ENGLISH_WORDS.has(w)) { ENGLISH_WORDS.add(w); added++; }
  }
  dictionary.total = ENGLISH_WORDS.size;
  return added;
}

const DICT_DIR = path.join(__dirname, 'data', 'dictionaries');
const DICT_CACHE_FILE = path.join(os.tmpdir(), 'contexto-english-words.v1.txt');
const BLOCKLIST_FILE = path.join(__dirname, 'data', 'word-blocklist.txt');

// Optional: add your own words to never use as a secret word, one per line.
try {
  if (fs.existsSync(BLOCKLIST_FILE)) {
    for (const line of fs.readFileSync(BLOCKLIST_FILE, 'utf8').split(/\r?\n/)) {
      const w = line.trim().toLowerCase();
      if (w) TARGET_BLOCKLIST.add(w);
    }
  }
} catch { /* optional file — ignore if missing/unreadable */ }

// 1) bundled list  2) your own .txt files  3) list remembered from last download
try {
  addWords(fs.readFileSync((require('word-list').default) || require('word-list'), 'utf8'));
} catch (err) {
  console.error('[dictionary] could not load the bundled word list:', err.message);
}
try {
  for (const file of fs.readdirSync(DICT_DIR)) {
    if (!/\.txt$/i.test(file)) continue;
    const added = addWords(fs.readFileSync(path.join(DICT_DIR, file), 'utf8'));
    console.log(`[dictionary] data/dictionaries/${file}: +${added.toLocaleString('en-US')} words`);
  }
} catch { /* no data/dictionaries folder — that's fine */ }
try {
  if (fs.existsSync(DICT_CACHE_FILE)) {
    const added = addWords(fs.readFileSync(DICT_CACHE_FILE, 'utf8'));
    console.log(`[dictionary] remembered download: +${added.toLocaleString('en-US')} words`);
  }
} catch { /* ignore an unreadable cache */ }

// Public word lists downloaded on startup. Each one is optional: if a
// download fails the others still load. To add more without touching any
// code, set WORD_LIST_URLS in Render to a comma-separated list of links to
// plain-text word lists (one word per line).
const REMOTE_DICTIONARIES = [
  { name: 'dwyl/english-words', url: 'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt', strict: true },
  { name: 'Moby single words', url: 'https://www.gutenberg.org/files/3201/files/SINGLE.TXT', strict: true },
];

function finishDictionary() {
  dictionary.total = ENGLISH_WORDS.size;
  dictionary.status = 'ready';
  const n = dictionary.total.toLocaleString('en-US');
  if (dictionary.total >= DICTIONARY_TARGET) {
    console.log(`[dictionary] ready: ${n} words`);
  } else {
    console.warn(`[dictionary] ready, but only ${n} words (goal: ${DICTIONARY_TARGET.toLocaleString('en-US')}). ` +
      'See "Growing the dictionary" in the README to add more.');
  }
}

async function loadRemoteDictionaries() {
  if (dictionary.total >= DICTIONARY_TARGET) { finishDictionary(); return; }
  const extra = String(process.env.WORD_LIST_URLS || '').split(',').map((u) => u.trim()).filter(Boolean)
    .map((url) => ({ name: url, url, strict: false }));
  let addedAny = false;
  for (const src of [...REMOTE_DICTIONARIES, ...extra]) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(src.url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      clearTimeout(timer);
      const added = addWords(text, { strict: src.strict });
      addedAny = addedAny || added > 0;
      console.log(`[dictionary] ${src.name}: +${added.toLocaleString('en-US')} words (total ${dictionary.total.toLocaleString('en-US')})`);
    } catch (err) {
      console.warn(`[dictionary] could not download ${src.name}: ${err.message}`);
    }
  }
  if (addedAny) {
    try { fs.writeFileSync(DICT_CACHE_FILE, Array.from(ENGLISH_WORDS).join('\n')); } catch { /* read-only disk: skip */ }
  }
  finishDictionary();
  pushState();
}

if (dictionary.total >= DICTIONARY_TARGET) finishDictionary();

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

// The front-end lives entirely in public/ — one folder, one source of
// truth. Pages are served with no-cache so a redeploy is always picked
// up immediately.
app.use((req, res, next) => {
  if (/\.(html|js|css)$/.test(req.path) || req.path === '/') res.set('Cache-Control', 'no-cache');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
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
    targetWord: null,
    board: new Map(),           // word -> best entry (one row per distinct ranked word)
    allGuessedWords: new Map(), // word -> { user } first player to find it (points + repeat tags)
    totalGuesses: 0,
    latest: null,               // the most recent guess, shown in the "Latest" line
    winner: null,
    result: null,               // { word, winner, gaveUp, guesses, players, points, total, topScorers } once the round ends
    startedAt: null,
    uniquePlayers: new Set(),
    extendedRankMap: new Map(), // word -> rank, for valid English words outside the core semantic list
    nextExtendedRank: null,     // next rank to hand out to such a word
    roundScores: new Map(),     // user -> points earned so far THIS round
    hintedWords: new Set(),     // words already revealed via a hint this round
  },
  leaderboard: {}, // username -> { score, wins, guesses } — all-time session totals, kept on the server
};

const MODES = ['live', 'test', 'offline'];
let rankMap = new Map();
let orderedWords = [];
let testAutoplayTimer = null;

// Top N all-time leaderboard entries, highest score first.
function topLeaderboard(n = 20) {
  return Object.entries(state.leaderboard)
    .map(([user, d]) => ({ user, score: d.score, wins: d.wins }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

function getPublicState() {
  return {
    connection: state.connection,
    mode: state.mode,
    viewerCount: state.viewerCount,
    autoplay: state.autoplay,
    diagnostics: state.diagnostics,
    dictionary,
    wordChoices: WORD_CHOICES,
    leaderboardTop: topLeaderboard(20),
    game: {
      active: state.game.active,
      winner: state.game.winner,
      result: state.game.result,
      uniquePlayers: state.game.uniquePlayers.size,
      totalGuesses: state.game.totalGuesses,
      latest: state.game.latest,
      board: boardEntries(150),
      hintsAvailable: hintsRemaining(),
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
// Small curated pool, used only when the full dictionary isn't ready yet
// (the first instant after a cold start) — see pickWordByRandomLength().
const ALL_LIVE_WORDS = Array.from(new Set([...(WORD_BANK.easy || []), ...(WORD_BANK.medium || []), ...(WORD_BANK.hard || [])]));
// Words the host can pick from in Test and Offline mode (built-in, no internet needed).
const WORD_CHOICES = Object.keys(FALLBACK_PUZZLES).sort();

function normalize(w) {
  return (w || '').toLowerCase().trim().replace(/[^a-z]/g, '');
}
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// The secret word's length is randomized every round (4-12 letters) so
// it's never confined to one length, and is never revealed up front —
// the UI has nothing that hints at how many letters it is.
const TARGET_LENGTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12];

// Host-selectable length ranges (Live mode). "any" keeps the full 4-12 spread.
const LENGTH_RANGES = { any: [4, 12], short: [4, 6], medium: [7, 9], long: [10, 12] };

// ------------------------------------------------------------
// LIVE-MODE SECRET WORD POOL
// Live mode's secret word is picked at random from the ENTIRE English
// dictionary loaded above (hundreds of thousands of legitimate words) —
// never from a small curated list — so no two broadcasters (and no two
// rounds) are stuck seeing the same handful of words. The pool is bucketed
// by length once, then re-bucketed whenever the dictionary grows (e.g. once
// the remote word lists finish downloading a few seconds after startup).
// ------------------------------------------------------------
const livePoolByLength = new Map(); // length -> string[]
let livePoolBuiltFromSize = 0;

function isGoodLiveTarget(w) {
  // Real, single, unbroken word; never something we've explicitly excluded
  // from being a secret word (still fine as something a player can guess).
  return !TARGET_BLOCKLIST.has(w);
}

function rebuildLiveWordPool() {
  livePoolByLength.clear();
  for (const len of TARGET_LENGTHS) livePoolByLength.set(len, []);
  for (const w of ENGLISH_WORDS) {
    const len = w.length;
    if (len < 4 || len > 12) continue;
    if (!isGoodLiveTarget(w)) continue;
    livePoolByLength.get(len).push(w);
  }
  livePoolBuiltFromSize = ENGLISH_WORDS.size;
}

// Rebuild the pool automatically the first time it's needed, and again any
// time the dictionary has grown since (e.g. after the remote word lists finish
// downloading in the background).
function liveWordPool(len) {
  if (livePoolBuiltFromSize !== ENGLISH_WORDS.size) rebuildLiveWordPool();
  return livePoolByLength.get(len) || [];
}

function pickWordByRandomLength(lengthKey) {
  const [lo, hi] = LENGTH_RANGES[lengthKey] || LENGTH_RANGES.any;
  const validLens = TARGET_LENGTHS.filter((l) => l >= lo && l <= hi);
  const lens = validLens.length ? validLens : TARGET_LENGTHS;

  // Prefer the full dictionary pool — this is what makes every round a
  // genuinely random word from the whole English language.
  if (ENGLISH_WORDS.size > 0) {
    const targetLen = pickRandom(lens);
    let candidates = liveWordPool(targetLen);
    if (!candidates.length) {
      // Nothing of that exact length: fall back to the whole chosen range.
      candidates = lens.flatMap((l) => liveWordPool(l));
    }
    if (candidates.length) return pickRandom(candidates);
  }

  // Extremely unlikely fallback: dictionary somehow empty. Use the small
  // curated list so Live mode still works.
  const targetLen = pickRandom(lens);
  let candidates = ALL_LIVE_WORDS.filter((w) => normalize(w).length === targetLen);
  if (!candidates.length) {
    candidates = ALL_LIVE_WORDS.filter((w) => { const l = normalize(w).length; return l >= lo && l <= hi; });
  }
  if (!candidates.length) candidates = ALL_LIVE_WORDS;
  return pickRandom(candidates);
}

// Test/Offline "Random" draws from the SAME whole-dictionary pool Live
// mode uses (hundreds of thousands of words spanning every topic and
// genre) rather than the small curated shortlist, so the secret word
// stays fresh and unpredictable even across hours of continuous play.
// buildPuzzleFromFallback() can rank a full board for any of these words
// purely offline, via the lexical-affinity engine above.
function pickFallbackWordByRandomLength() {
  if (ENGLISH_WORDS.size > 0) {
    const word = pickWordByRandomLength('any');
    if (word) return word;
  }
  // Extremely unlikely fallback: dictionary somehow not loaded yet.
  const keys = Object.keys(FALLBACK_PUZZLES);
  return pickRandom(keys);
}

// ------------------------------------------------------------
// RANKING ENGINE
//
// Real Contexto pulls its ranking from a proprietary semantic-similarity
// model. We approximate that in two stages so every round — Live, Test,
// or Offline — can rank a professionally-ordered board at least 100,000
// words deep, deterministically (the same word always lands on the same
// rank within a round, never depending on guess order):
//
//   STAGE 1 — SEMANTIC CORE (Live mode, needs internet):
//   Query Datamuse across eleven relation types (meaning, synonyms,
//   co-occurrence triggers, modifier pairs, hypernyms/hyponyms,
//   holonyms/meronyms, collocations) and merge them with Reciprocal
//   Rank Fusion (RRF) — the same multi-source rank-merging technique
//   search engines use — weighted so the strongest semantic signals
//   dominate. This is what a single richer embedding model would give
//   you, approximated from several narrower ones.
//
//   STAGE 2 — LEXICAL-AFFINITY EXTENSION (every mode, offline-capable):
//   Everything the semantic core doesn't cover gets a deterministic rank
//   from a bigram-overlap / shared-prefix / length-closeness score
//   against the target, computed once per round over the full loaded
//   dictionary and sorted. No network needed, so it's also what powers
//   Test and Offline mode's full-dictionary vocabulary (see item 6 —
//   widening the word pool — in buildPuzzleFromFallback below).
// ------------------------------------------------------------

// How many total ranked words a single round guarantees (target + core +
// extension). Comfortably past the 100,000-rank requirement, with a safety
// margin, while staying fast to compute once per round start.
const EXTENDED_RANK_LIMIT = 120000;

// Each Datamuse relation code, and how much it should count for in the
// fused ranking. "ml" (meaning) and "syn" (synonyms) are the strongest
// semantic signals; the rest fill in the kind of associative neighbors a
// human player would also reach for (e.g. "barista" for "coffee").
const RELATION_WEIGHTS = {
  ml: 1.00,   // means like — primary semantic closeness
  syn: 0.90,  // synonyms
  trg: 0.65,  // triggers — statistically co-occurring words
  jja: 0.45,  // nouns commonly modified by this adjective
  jjb: 0.45,  // adjectives commonly used to modify this noun
  spc: 0.40,  // "kind of" (more specific)
  gen: 0.40,  // "kind of", inverse (more general)
  com: 0.35,  // comprises / holonyms
  par: 0.35,  // part of / meronyms
  bga: 0.25,  // frequent followers
  bgb: 0.25,  // frequent predecessors
};
const RELATION_MAX = 1000;   // Datamuse's practical per-query result cap
const RRF_K = 60;            // Reciprocal Rank Fusion smoothing constant

function datamuseUrl(code, word, max) {
  const q = code === 'ml' ? `ml=${encodeURIComponent(word)}` : `rel_${code}=${encodeURIComponent(word)}`;
  return `https://api.datamuse.com/words?${q}&max=${max}`;
}
async function fetchDatamuseRelation(code, word, max) {
  const res = await fetch(datamuseUrl(code, word, max));
  if (!res.ok) throw new Error('Datamuse ' + code + ' responded with status ' + res.status);
  return res.json();
}

// Fetches every relation in parallel (a single slow/failed relation never
// blocks the others — Promise.allSettled) and fuses them with weighted
// Reciprocal Rank Fusion: a word that appears near the top of several
// relations outranks one that only appears once, even far down a single
// list. This is the "utmost professional" approximation of a full
// semantic-similarity model available without training/hosting one.
async function buildSemanticCore(target) {
  const codes = Object.keys(RELATION_WEIGHTS);
  const settled = await Promise.allSettled(codes.map((code) => fetchDatamuseRelation(code, target, RELATION_MAX)));

  const fused = new Map(); // word -> fused score
  let anyOk = false;
  settled.forEach((res, i) => {
    if (res.status !== 'fulfilled' || !Array.isArray(res.value)) return;
    anyOk = true;
    const weight = RELATION_WEIGHTS[codes[i]];
    res.value.forEach((item, listRank) => {
      const w = normalize(item.word);
      if (!w || w === target || isTrivialVariant(target, w)) return;
      const contribution = weight / (RRF_K + listRank + 1);
      fused.set(w, (fused.get(w) || 0) + contribution);
    });
  });
  if (!anyOk || fused.size < 20) throw new Error('Not enough semantic neighbors found for "' + target + '"');

  return Array.from(fused.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([w]) => w);
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

async function buildPuzzleFromDatamuse(word) {
  const target = normalize(word);
  const core = await buildSemanticCore(target);
  let order = [target, ...core];
  const coreSet = new Set(order);
  order = extendOrderWithLexicalAffinity(target, order, coreSet, EXTENDED_RANK_LIMIT + 1);
  const map = new Map();
  order.forEach((w, i) => map.set(w, i + 1));
  return { target, map, order };
}

// ---- Stage 2 helpers: bigram-overlap lexical affinity (no network) ----
function bigramIndex(c1, c2) { return (c1 - 97) * 26 + (c2 - 97); }

function bigramProfile(word) {
  const hist = new Uint8Array(676);
  let count = 0;
  for (let i = 0; i < word.length - 1; i++) {
    const c1 = word.charCodeAt(i) - 97, c2 = word.charCodeAt(i + 1) - 97;
    if (c1 < 0 || c1 > 25 || c2 < 0 || c2 > 25) continue;
    const idx = bigramIndex(c1, c2);
    if (hist[idx] < 255) hist[idx]++;
    count++;
  }
  return { hist, count };
}

// Deterministic, dependency-free stand-in for a semantic-distance model:
// scores a word by orthographic (bigram) overlap with the target, tempered
// by shared prefix length and how close the two words are in length. It's
// a lexical proxy rather than true semantics, but it is stable (the same
// word always lands on the same rank), cheap enough to run over the whole
// dictionary once per round, and needs no network — which is exactly what
// lets Test/Offline mode share Live mode's full vocabulary (see item 6).
function lexicalAffinityScore(target, targetProfile, word) {
  let overlap = 0;
  let wordCount = 0;
  for (let i = 0; i < word.length - 1; i++) {
    const c1 = word.charCodeAt(i) - 97, c2 = word.charCodeAt(i + 1) - 97;
    if (c1 < 0 || c1 > 25 || c2 < 0 || c2 > 25) continue;
    wordCount++;
    if (targetProfile.hist[bigramIndex(c1, c2)] > 0) overlap++;
  }
  const union = targetProfile.count + wordCount - overlap;
  const dice = union > 0 ? overlap / union : 0;
  let prefix = 0;
  const minLen = Math.min(word.length, target.length);
  while (prefix < minLen && word[prefix] === target[prefix]) prefix++;
  const lenPenalty = Math.abs(word.length - target.length) * 0.015;
  return dice + prefix * 0.03 - lenPenalty;
}

// Fills in the rest of the loaded dictionary (skipping whatever's already
// in coreOrder) up to `limit` total ranked words, so an off-topic-but-real
// guess always lands on a real, stable, professionally-computed rank
// instead of a dead end — or worse, a rank that depends on who happened
// to guess it first.
function extendOrderWithLexicalAffinity(target, coreOrder, coreSet, limit) {
  const room = limit - coreOrder.length;
  if (room <= 0 || !ENGLISH_WORDS.size) return coreOrder;
  const targetProfile = bigramProfile(target);
  const scored = [];
  for (const w of ENGLISH_WORDS) {
    if (coreSet.has(w)) continue;
    scored.push([w, lexicalAffinityScore(target, targetProfile, w)]);
  }
  scored.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const extra = scored.length > room ? scored.slice(0, room) : scored;
  return coreOrder.concat(extra.map(([w]) => w));
}

// Test/Offline: prefer the hand-curated word list when one exists (a
// slightly richer, hand-picked near-neighborhood), then always extend
// with the same offline lexical-affinity engine so ANY real word — not
// just the ~15 curated targets — gets a full, deep, deterministic ranking.
function buildPuzzleFromFallback(word) {
  const target = normalize(word);
  if (!target) return null;
  const curated = FALLBACK_PUZZLES[target];
  let order = curated ? curated.map(normalize).filter((w) => w && w !== target) : [];
  order = [target, ...order];
  const coreSet = new Set(order);
  order = extendOrderWithLexicalAffinity(target, order, coreSet, EXTENDED_RANK_LIMIT + 1);
  const map = new Map();
  order.forEach((w, i) => map.set(w, i + 1));
  return { target, map, order };
}

// ============================================================
// 4. GAME LOGIC
// ============================================================
async function startGame(mode, opts = {}) {
  try {
    const custom = normalize(opts.word || '');
    let puzzle;

    if (mode === 'live') {
      if (opts.word && custom.length < 3) throw new Error('The secret word needs at least 3 letters.');
      if (custom) {
        try {
          puzzle = await buildPuzzleFromDatamuse(custom);
        } catch (err) {
          console.error('[DATAMUSE FAILED]', err);
          if (!FALLBACK_PUZZLES[custom]) {
            throw new Error(`Could not build a ranking for "${custom}". Check the spelling, or leave the secret word empty for a random one.`);
          }
          broadcast({ type: 'server_error', message: 'Could not reach the word-similarity service, using a backup word instead.' });
          puzzle = buildPuzzleFromFallback(custom);
        }
      } else {
        // Random word: try a handful of fresh random picks from the full
        // dictionary before giving up — an obscure pick that Datamuse can't
        // rank well shouldn't mean settling for the small curated list.
        const RANDOM_ATTEMPTS = 6;
        let lastErr = null;
        for (let attempt = 1; attempt <= RANDOM_ATTEMPTS && !puzzle; attempt++) {
          const word = pickWordByRandomLength(opts.length);
          try {
            puzzle = await buildPuzzleFromDatamuse(word);
          } catch (err) {
            lastErr = err;
          }
        }
        if (!puzzle) {
          console.error('[DATAMUSE FAILED after retries]', lastErr);
          broadcast({ type: 'server_error', message: 'Could not reach the word-similarity service, using a backup word instead.' });
          puzzle = buildPuzzleFromFallback(pickRandom(Object.keys(FALLBACK_PUZZLES)));
        }
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
    g.roundScores = new Map();
    g.hintedWords = new Set();
    // Unrelated-but-real words are always ranked past 1500 (the red zone), even
    // when the built-in list for a word is short — otherwise they'd land in
    // the green zone and earn points they haven't earned.
    g.nextExtendedRank = Math.max(orderedWords.length + 1, 1501);

    broadcast({ type: 'game_started', mode });
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
    user: 'Answer', word, rank: 1, isHost: false, isHint: false, isWin: true, isReveal: true,
    ts: Date.now(), isRepeat: false, repeatOf: null, points: 0, total: 0, avatar: null,
  };
  g.board.set(word, answer);
  finishRound(null, { gaveUp: true });
  broadcast({ type: 'give_up', word, entry: answer, result: g.result });
  pushState();
}

function finishRound(winnerUser, opts = {}) {
  clearInterval(testAutoplayTimer);
  state.autoplay.running = false;
  const g = state.game;
  g.active = false;
  g.winner = winnerUser;
  const topScorers = Array.from(g.roundScores.entries())
    .map(([user, points]) => ({ user, points }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 10);
  g.result = {
    word: g.targetWord,
    winner: winnerUser,
    gaveUp: !!opts.gaveUp,
    guesses: g.totalGuesses,
    players: g.uniquePlayers.size,
    points: opts.points || 0,
    total: opts.total || 0,
    topScorers,
    leaderboardTop: topLeaderboard(20),
  };
}

// ------------------------------------------------------------
// POINTS — deliberately small.
//
// Points are for DISCOVERY: a player earns them only when they are the
// first to find a word in a round. Repeating a word someone already
// found earns nothing, so pasting good words over and over can't farm
// points. Only the closest ten words score at all:
//   - the secret word (rank 1) is worth the most: 5 points
//   - ranks 2 to 10 earn 4 down to 1 point, the closer the better
//   - anything past rank 10 earns nothing
//
// Format: [highest rank that still earns this many points, points].
// Tweak the numbers below to re-balance the game.
// ------------------------------------------------------------
const POINTS_BY_RANK = [
  [1, 5],      // the secret word itself
  [2, 4],
  [3, 3],
  [5, 2],      // ranks 4-5
  [10, 1],     // ranks 6-10
  // rank 11 and beyond earns 0
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

function handleGuess(user, rawText, isHost = false, avatar = null) {
  const g = state.game;
  if (!g.active) return;
  const word = normalize((rawText || '').split(/\s+/)[0]);
  if (!word) return;

  const rank = resolveRank(word);
  const prior = g.allGuessedWords.get(word); // first player to find it (host tests never count)
  const isRepeat = !!prior; // someone already guessed this exact word this round
  const isWin = rank === 1;

  let points = 0;
  let total = 0;
  if (!isHost) {
    const lb = ensureLeaderboardEntry(user);
    lb.guesses += 1;
    if (!prior && rank != null) {
      points = pointsForRank(rank);
      lb.score += points;
      if (points > 0) g.roundScores.set(user, (g.roundScores.get(user) || 0) + points);
    }
    if (isWin) lb.wins += 1;
    total = lb.score;
    if (!prior) g.allGuessedWords.set(word, { user });
    g.uniquePlayers.add(user);
  }

  const entry = {
    user, word, rank, isHost, isHint: false, isWin, ts: Date.now(),
    isRepeat,
    repeatOf: isRepeat ? prior.user : null,
    points,
    total,
    avatar: avatar || null,
  };

  g.totalGuesses += 1;
  g.latest = entry;

  // One row per distinct word; a real player's find replaces a host/hint test entry.
  if (rank != null) {
    const existing = g.board.get(word);
    if (!existing || ((existing.isHost || existing.isHint) && !isHost)) g.board.set(word, entry);
  }

  broadcast({ type: 'guess', entry, totalGuesses: g.totalGuesses, players: g.uniquePlayers.size });

  if (isWin) {
    finishRound(user, { points, total });
    broadcast({ type: 'win', user, word: g.targetWord, guessesUsed: g.totalGuesses, points, total, result: g.result });
    pushState();
  }
}

// If nobody has found or been hinted anything yet this round, the very
// first hint anchors here instead of handing out the globally best word
// (rank 2) outright — keeps the opening hint meaningful rather than a
// near-spoiler.
const INITIAL_HINT_ANCHOR = 250;

// The best (lowest, i.e. closest-to-1) rank currently sitting on the
// board, across both real finds and previous hints. Infinity if the
// board is empty.
function currentBestBoardRank() {
  let best = Infinity;
  for (const entry of state.game.board.values()) {
    if (entry.rank != null && entry.rank < best) best = entry.rank;
  }
  return best;
}

// How much further a hint could still improve on the current best guess.
// Approximate (doesn't account for already-hinted gaps in between) — it's
// only used to size the Hint button's remaining count, not to pick ranks.
function hintsRemaining() {
  const g = state.game;
  if (!g.active || !orderedWords.length) return 0;
  const bestRank = currentBestBoardRank();
  const anchor = bestRank === Infinity ? Math.min(INITIAL_HINT_ANCHOR, orderedWords.length) : bestRank;
  return Math.max(0, anchor - 2);
}

// Reveals a word ranked only slightly better than the current best guess
// on the board — never a big jump straight to rank #2 — by walking
// backward, rank by rank, from just below the current best until it finds
// one that hasn't been found or hinted yet. This keeps each hint a small,
// earned step closer to the answer rather than one hint solving the round.
function giveHint() {
  const g = state.game;
  if (!g.active) { broadcast({ type: 'server_error', message: 'Start a round before asking for a hint.' }); return; }

  const bestRank = currentBestBoardRank();
  const anchor = bestRank === Infinity ? Math.min(INITIAL_HINT_ANCHOR, orderedWords.length) : bestRank;

  for (let r = anchor - 1; r >= 2; r--) {
    const w = orderedWords[r - 1];
    if (!w || g.board.has(w)) continue; // already found or already hinted
    const rank = rankMap.get(w);
    const entry = {
      user: 'Hint', word: w, rank, isHost: false, isHint: true, isWin: false, ts: Date.now(),
      isRepeat: false, repeatOf: null, points: 0, total: 0, avatar: null,
    };
    g.board.set(w, entry);
    g.hintedWords.add(w);
    broadcast({ type: 'hint', entry });
    pushState();
    return;
  }
  broadcast({ type: 'server_error', message: 'No better hint available right now — your guesses are already this close!' });
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
// Best-effort profile picture URL — different library versions expose it
// under different shapes, so we try the plausible ones and fall back to
// null (the client then shows a colored initial instead).
function extractAvatar(data) {
  return (
    data?.user?.profilePicture?.url?.[0] ||
    data?.user?.profilePicture?.urls?.[0] ||
    data?.user?.avatarThumb?.url_list?.[0] ||
    data?.user?.avatarThumb?.urlList?.[0] ||
    data?.user?.avatarLarger?.url_list?.[0] ||
    data?.profilePictureUrl ||
    null
  );
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
        const avatar = extractAvatar(data);
        state.diagnostics.lastReceived = { user, text };

        broadcast({
          type: 'raw_event',
          rawEventCount: state.diagnostics.rawEventCount,
          lastReceived: state.diagnostics.lastReceived,
          rawSamples: state.diagnostics.rawSamples,
        });

        // Chat only counts as guesses during a Live round; Test and Offline
        // rounds ignore whatever the connected chat is saying.
        if (state.mode === 'live') handleGuess(user, text, false, avatar);
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
        length: msg.length,
        autoplay: !!msg.autoplay,
        speed: msg.speed,
      });
      break;
    case 'give_up':
      giveUp();
      break;
    case 'request_hint':
      giveHint();
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
    case 'reset_leaderboard':
      // Manual, host-triggered wipe of the all-time session leaderboard.
      // Does not touch the current round in progress.
      state.leaderboard = {};
      pushState();
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
  loadRemoteDictionaries().catch((err) => console.error('[dictionary] unexpected error:', err));
});
