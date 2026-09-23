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
const lemmatizer = require('wink-lemmatizer');

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

// ------------------------------------------------------------
// SAVED DEFAULT SETTINGS ("Save & Apply as Default")
// Lets the host set everything up once (mode, speed, timings, etc.) and
// have every future visit — this device or any other, even after a
// redeploy — start from those same settings instead of the hard-coded
// ones. Saved to a plain JSON file on disk so it survives server
// restarts; kept out of the data folder's word files so it's easy to
// spot. Only a known, small set of fields is ever written here (see
// handleClientMessage's 'save_default_settings' case) — never anything
// arbitrary a client happens to send.
// ------------------------------------------------------------
const DEFAULT_SETTINGS_FILE = path.join(__dirname, 'data', 'default-settings.json');
function loadDefaultSettings() {
  try {
    if (fs.existsSync(DEFAULT_SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(DEFAULT_SETTINGS_FILE, 'utf8'));
    }
  } catch (err) {
    console.warn('[default-settings] could not read saved defaults:', err.message);
  }
  return null;
}
function saveDefaultSettings(obj) {
  try {
    fs.writeFileSync(DEFAULT_SETTINGS_FILE, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.warn('[default-settings] could not save defaults (read-only disk?):', err.message);
  }
}

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
  autoplay: { running: false, speed: 'normal', ticks: 0 }, // Test mode's simulated chat
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
    roundAvatars: new Map(),    // user -> latest known avatar URL, for THIS round's top scorers
    hintedWords: new Set(),     // words already revealed via a hint this round
  },
  leaderboard: {}, // username -> { score, wins, guesses } — all-time session totals, kept on the server
  defaultSettings: null, // host's saved "always start with these settings" — see SETTINGS DEFAULTS below
};
state.defaultSettings = loadDefaultSettings();

const MODES = ['live', 'test', 'offline'];
let rankMap = new Map();
let orderedWords = [];
let testAutoplayTimer = null;

// All-time leaderboard entries, highest score first. No cap by default —
// the client shows the top 20 at a glance and scrolls for the rest, so the
// full list (everyone who has ever scored this session) is always sent.
function topLeaderboard(n = Infinity) {
  return Object.entries(state.leaderboard)
    .map(([user, d]) => ({ user, score: d.score, wins: d.wins, avatar: d.avatar || null }))
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
    leaderboardTop: topLeaderboard(),
    defaultSettings: state.defaultSettings,
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
// (the first instant after a cold start) — see pickBalancedTargetWord().
const ALL_LIVE_WORDS = Array.from(new Set([...(WORD_BANK.easy || []), ...(WORD_BANK.medium || []), ...(WORD_BANK.hard || [])]));
// Words the host can pick from in Test and Offline mode (built-in, no internet needed).
const WORD_CHOICES = Object.keys(FALLBACK_PUZZLES).sort();

function normalize(w) {
  return (w || '').toLowerCase().trim().replace(/[^a-z]/g, '');
}
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// The secret word's length is never fixed or user-selectable — it can be
// anywhere from 4 to 12 letters, and the UI never hints at how many
// letters it is. This range is purely a sanity bound (very short words are
// mostly function words / too easy to brute-force; very long words are
// mostly obscure compounds), not a difficulty setting.
const TARGET_LENGTHS_MIN = 4;
const TARGET_LENGTHS_MAX = 12;

function isGoodLiveTarget(w) {
  // Real, single, unbroken word; never something we've explicitly excluded
  // from being a secret word (still fine as something a player can guess).
  return !TARGET_BLOCKLIST.has(w);
}

// ------------------------------------------------------------
// ROOT-WORD (LEMMA) ONLY — the SECRET word must already be its own base
// dictionary form: never a plural noun ("cars"), never a conjugated or
// tensed verb, and never a participle ("jumping", "jumped", "runs").
// This only restricts what can be picked as the answer — guesses are
// unaffected and still rank against the full dictionary as before.
//
// A simple suffix rule (reject anything ending in "s"/"ed"/"ing") would
// wrongly reject perfectly good base words like "bus", "glass", "bed",
// "speed", "ring", or "king". wink-lemmatizer already knows the many
// English exceptions to those patterns, so it's used here instead of
// hand-written suffix-stripping: a word is only rejected if lemmatizing
// it as a noun OR a verb actually changes it (meaning it was inflected).
// ------------------------------------------------------------
function isBaseFormWord(w) {
  try {
    if (lemmatizer.noun(w) !== w) return false;
    if (lemmatizer.verb(w) !== w) return false;
  } catch { /* never let an odd input crash target selection */ }
  return true;
}

// Filters a list of candidate words down to base-form-only, but never
// returns an empty list — if every candidate happens to get filtered out
// (frequency band still tiny at cold start, etc.) the unfiltered list is
// used instead so a round can always start.
function baseFormOnly(words) {
  const kept = words.filter(isBaseFormWord);
  return kept.length ? kept : words;
}

// ------------------------------------------------------------
// LIVE-MODE SECRET WORD POOL — BALANCED DIFFICULTY, ALWAYS RANDOM
//
// Picking the target from the entire loaded dictionary (400k+ words)
// meant it could land on genuinely obscure or technical words that only
// happen to clear the "150 semantic neighbors" bar in buildSemanticCore().
// That made rounds swing wildly between "too easy" and "unfairly hard".
//
// Instead, the target is drawn from a word-frequency list (how often each
// word is actually used in real English), downloaded once at startup —
// the same pattern already used for the dictionary itself, see
// REMOTE_DICTIONARIES above. Words are kept only if they fall in a middle
// frequency band:
//   - the very top of the frequency list (mostly "the/of/have/with"-style
//     function words) is skipped — those make dull, low-signal targets
//   - anything past a generous cutoff further down the list is dropped —
//     that's where genuinely rare/technical words live
// What's left is a large pool (thousands of words) that skews toward
// everyday nouns/verbs/adjectives but still reaches into less common,
// genuinely challenging vocabulary — enough range for a fast, casual
// guesser and a sharp, word-savvy one to both have a fair round, without
// a difficulty knob and without ever repeating the same tiny shortlist.
// No length filter is applied beyond the 4-12 sanity bound above — the
// pool is never split or chosen by length.
// ------------------------------------------------------------
const FREQUENCY_LIST_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt';
const FREQ_CACHE_FILE = path.join(os.tmpdir(), 'contexto-frequency-words.v1.txt');
// Skip the most frequent entries (function words, "have/that/with/from"
// style words with little semantic content) and stop well short of the
// tail (the rarest, least-recognizable end of the list).
const FREQ_BAND_SKIP_TOP = 300;
const FREQ_BAND_MAX_RANK = 15000;

let frequencyOrder = [];       // words, most-to-least frequent, raw from the source
let balancedWordPool = [];     // filtered + banded pool actually drawn from
let balancedPoolBuiltFromSize = 0;
let balancedPoolBuiltFromFreqLen = 0;

function rebuildBalancedWordPool() {
  const source = frequencyOrder.length ? frequencyOrder : [];
  const banded = source.slice(FREQ_BAND_SKIP_TOP, FREQ_BAND_MAX_RANK);
  const pool = [];
  for (const w of banded) {
    if (w.length < TARGET_LENGTHS_MIN || w.length > TARGET_LENGTHS_MAX) continue;
    if (!isGoodLiveTarget(w)) continue;
    // Keep only words we can actually rank against (present in the loaded
    // dictionary) — filters out any stray noise in the frequency source.
    if (ENGLISH_WORDS.size && !ENGLISH_WORDS.has(w)) continue;
    if (!isBaseFormWord(w)) continue; // root words only — see isBaseFormWord above
    pool.push(w);
  }
  balancedWordPool = pool;
  balancedPoolBuiltFromSize = ENGLISH_WORDS.size;
  balancedPoolBuiltFromFreqLen = frequencyOrder.length;
}

function currentBalancedWordPool() {
  if (balancedPoolBuiltFromSize !== ENGLISH_WORDS.size || balancedPoolBuiltFromFreqLen !== frequencyOrder.length) {
    rebuildBalancedWordPool();
  }
  return balancedWordPool;
}

function parseFrequencyList(text) {
  const words = [];
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    // Lines look like "word 12345678" (word, then a frequency count).
    const w = raw.split(/\s+/)[0].toLowerCase();
    if (!/^[a-z]+$/.test(w)) continue;
    words.push(w);
  }
  return words;
}

async function loadFrequencyList() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    const res = await fetch(FREQUENCY_LIST_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    clearTimeout(timer);
    frequencyOrder = parseFrequencyList(text);
    try { fs.writeFileSync(FREQ_CACHE_FILE, frequencyOrder.join('\n')); } catch { /* read-only disk: skip */ }
    console.log(`[frequency] loaded ${frequencyOrder.length.toLocaleString('en-US')} ranked words for balanced word selection`);
  } catch (err) {
    console.warn(`[frequency] could not download frequency list: ${err.message}`);
    try {
      if (fs.existsSync(FREQ_CACHE_FILE)) {
        frequencyOrder = fs.readFileSync(FREQ_CACHE_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
        console.log(`[frequency] using remembered download: ${frequencyOrder.length.toLocaleString('en-US')} ranked words`);
      }
    } catch { /* ignore an unreadable cache */ }
  }
  rebuildBalancedWordPool();
  pushState();
}

function pickBalancedTargetWord() {
  const pool = currentBalancedWordPool();
  if (pool.length) return pickRandom(pool);

  // Frequency list unavailable (first instant after a cold start, or the
  // download failed with no cached copy) and dictionary not filtered yet:
  // fall back to the small curated list so a round can always start.
  const lo = TARGET_LENGTHS_MIN, hi = TARGET_LENGTHS_MAX;
  let candidates = ALL_LIVE_WORDS.filter((w) => { const l = normalize(w).length; return l >= lo && l <= hi; });
  if (!candidates.length) candidates = ALL_LIVE_WORDS;
  candidates = baseFormOnly(candidates);
  return pickRandom(candidates);
}

// ------------------------------------------------------------
// RANKING ENGINE
//
// Real Contexto ranks words with a proprietary semantic-similarity model
// (word embeddings such as word2vec/GloVe): every word in its vocabulary
// gets a fixed cosine-distance-based rank to the target the moment the
// puzzle is built, #1 is always the target itself, and a word's rank
// never changes based on who guesses it or when. We approximate that in
// two stages so every round — Live, Test, or Offline — can rank the
// ENTIRE loaded dictionary (hundreds of thousands of words), fully
// deterministically (the same word always lands on the same rank within
// a round, no matter the guess order):
//
//   STAGE 1 — SEMANTIC CORE (tried first, in every mode — Live, Test, and
//   Offline all reach for this before anything else):
//   Query Datamuse across eleven relation types (meaning, synonyms,
//   co-occurrence triggers, modifier pairs, hypernyms/hyponyms,
//   holonyms/meronyms, collocations) and merge them with Reciprocal
//   Rank Fusion (RRF) — the same multi-source rank-merging technique
//   search engines use — weighted so the strongest semantic signals
//   dominate. This is what a single richer embedding model would give
//   you, approximated from several narrower ones. This needs the
//   server to have internet access (which a hosted deploy always
//   does) — it's the ONLY stage that actually knows what words mean.
//
//   STAGE 2 — LEXICAL-AFFINITY EXTENSION (fallback + gap-filler):
//   Everything the semantic core doesn't cover gets a deterministic rank
//   from a bigram-overlap / shared-prefix / length-closeness score
//   against the target, computed once per round over the full loaded
//   dictionary and sorted. This is a purely orthographic (spelling-based)
//   proxy, not a semantic one — it's what's left of the board once you
//   run out of real "means like" data, so words on it can be unrelated
//   in meaning despite a close-looking rank. No network needed, so it's
//   also what every mode falls back to, in full, if Stage 1 is ever
//   unreachable — Test and Offline still work with zero internet, just
//   with noticeably weaker ranking quality in that one edge case.
// ------------------------------------------------------------

// How many total ranked words a single round guarantees (target + core +
// extension). This covers the ENTIRE loaded dictionary (hundreds of
// thousands of words) rather than stopping at a fixed count. Real Contexto
// gives every word in its vocabulary a fixed, deterministic rank the
// instant the round starts, based purely on distance from the target —
// never on who guessed what, or when. Capping the extension at a fixed
// number used to mean that anything past the cutoff (often perfectly
// reasonable, related words) fell through to resolveRank()'s "extended"
// fallback below, which — because it only assigns a rank the first time a
// word happens to be guessed — made ranks order-of-guessing dependent
// instead of similarity dependent: two hosts guessing the same words in a
// different order could see different ranks, and two different words that
// are guessed one after another always come out as adjacent ranks even
// when they aren't actually similar. Setting no cap here means the
// lexical-affinity pass below (which already scores the full dictionary
// every round; see extendOrderWithLexicalAffinity) keeps ALL of that
// work instead of throwing most of it away, so essentially every real
// word gets a genuine, stable rank up front. resolveRank()'s fallback
// still exists as a safety net for the rare case where a word enters the
// dictionary mid-round (the background download in loadRemoteDictionaries
// finishing after the round already started).
const EXTENDED_RANK_LIMIT = Infinity;

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
  // Require a genuinely rich set of neighbors before accepting this word as
  // a puzzle target — not just "found something". A word with only a
  // handful of Datamuse hits (typically an obscure or oddly-formed compound
  // like "peabrain" or "hotfoot") makes for a target where almost nothing a
  // normal player would guess is anywhere close, which feels broken rather
  // than challenging. Real Contexto draws its secret words from a curated
  // list of common, well-connected words for exactly this reason. 150 is a
  // practical stand-in for "well-connected enough to be fair" — ordinary
  // words like "coffee" or "ocean" clear it by a wide margin.
  if (!anyOk || fused.size < 150) throw new Error('Not enough semantic neighbors found for "' + target + '"');

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
// in coreOrder), scoring and sorting every remaining word by lexical
// affinity to the target, up to `limit` total ranked words (see
// EXTENDED_RANK_LIMIT above — in practice this means the whole
// dictionary). So an off-topic-but-real guess always lands on a real,
// stable, deterministically-computed rank instead of a dead end — or
// worse, a rank that depends on who happened to guess it first.
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

// The fully-offline fallback path (Stage 2 only — no network), used when
// Datamuse can't be reached. Prefers the hand-curated word list when one
// exists for this target (a slightly richer, hand-picked near-neighborhood),
// then always extends with the offline lexical-affinity engine so ANY real
// word — not just the ~15 curated targets — gets a full, deep, deterministic
// ranking, even though it's an orthographic approximation rather than a
// semantic one.
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

    // Every mode now tries the real semantic-similarity service first —
    // not just Live. Test and Offline used to always use the small
    // hand-curated word list plus the bigram-overlap approximation below,
    // which is a purely orthographic (letter-pattern) proxy, not a
    // semantic one: it can rank obscure words that merely share letter
    // sequences with the target (e.g. "bedraggle", "bedrizzle") far above
    // genuinely related common words ("bed", "room", "furniture"), which
    // isn't how Contexto ranks anything. Datamuse's "means like" relation
    // is a real semantic signal, so every mode reaches for it first now;
    // the offline bigram approximation only kicks in as a last resort if
    // the service is unreachable, so Test/Offline still always work even
    // with no network at all — they just won't rank as richly in that
    // rare case.
    if (opts.word && custom.length < 3) throw new Error('The secret word needs at least 3 letters.');
    if (custom) {
      try {
        puzzle = await buildPuzzleFromDatamuse(custom);
      } catch (err) {
        console.error('[DATAMUSE FAILED]', err);
        if (!FALLBACK_PUZZLES[custom] && !ENGLISH_WORDS.has(custom)) {
          throw new Error(`Could not build a ranking for "${custom}". Check the spelling, or leave the secret word empty for a random one.`);
        }
        broadcast({ type: 'server_error', message: 'Could not reach the word-similarity service, using the offline backup ranking instead.' });
        puzzle = buildPuzzleFromFallback(custom);
      }
    } else {
      // Random word: try several fresh random picks from the full
      // dictionary before giving up — an obscure pick that Datamuse can't
      // rank well shouldn't mean settling for the small curated list. Raised
      // from 6 to 15 now that a "good" target requires a much richer
      // semantic core (see the 150-word floor above), so more attempts are
      // typically needed to land on a common, well-connected word instead
      // of an obscure one.
      const RANDOM_ATTEMPTS = 15;
      let lastErr = null;
      for (let attempt = 1; attempt <= RANDOM_ATTEMPTS && !puzzle; attempt++) {
        const word = pickBalancedTargetWord();
        try {
          puzzle = await buildPuzzleFromDatamuse(word);
        } catch (err) {
          lastErr = err;
        }
      }
      if (!puzzle) {
        console.error('[DATAMUSE FAILED after retries]', lastErr);
        broadcast({ type: 'server_error', message: 'Could not reach the word-similarity service, using the offline backup ranking instead.' });
        puzzle = buildPuzzleFromFallback(pickRandom(baseFormOnly(Object.keys(FALLBACK_PUZZLES))));
      }
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
    g.roundAvatars = new Map();
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
  // Every player who scored this round — no cap. The floating window
  // scrolls if the list is long, but nobody who earned points is left off.
  const topScorers = Array.from(g.roundScores.entries())
    .map(([user, points]) => ({ user, points, avatar: g.roundAvatars.get(user) || null }))
    .sort((a, b) => b.points - a.points);
  g.result = {
    word: g.targetWord,
    winner: winnerUser,
    gaveUp: !!opts.gaveUp,
    guesses: g.totalGuesses,
    players: g.uniquePlayers.size,
    points: opts.points || 0,
    total: opts.total || 0,
    topScorers,
    leaderboardTop: topLeaderboard(),
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

function ensureLeaderboardEntry(user, avatar) {
  if (!state.leaderboard[user]) state.leaderboard[user] = { score: 0, wins: 0, guesses: 0, avatar: avatar || null };
  else if (avatar) state.leaderboard[user].avatar = avatar;
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
    const lb = ensureLeaderboardEntry(user, avatar);
    lb.guesses += 1;
    if (avatar) g.roundAvatars.set(user, avatar);
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

// The upper end of the "between the current best guess and #1" window a
// hint is drawn from. For the very first hint of the round this is always
// capped at INITIAL_HINT_ANCHOR, no matter how far away the current best
// guess on the board is — otherwise, if every guess so far happened to be
// a bad one (e.g. stuck in the tens of thousands), the first hint would
// anchor to that bad guess and reveal something only marginally better,
// instead of a genuinely useful hundreds-range word. Once at least one
// hint has been given, later hints anchor to the actual best rank on the
// board, so each one lands roughly halfway between that and the answer.
function hintAnchor() {
  const g = state.game;
  const bestRank = currentBestBoardRank();
  const cap = Math.min(INITIAL_HINT_ANCHOR, orderedWords.length);
  if (g.hintedWords.size === 0) return Math.min(bestRank, cap);
  return bestRank;
}

// How many more hints are realistically left. Since each hint now roughly
// halves the remaining gap to the answer (see giveHint below), the count
// simulates that halving down to rank 2 rather than assuming a step of 1.
// Approximate (doesn't account for already-hinted ranks in between) — it's
// only used to size the Hint button's remaining count, not to pick ranks.
function hintsRemaining() {
  const g = state.game;
  if (!g.active || !orderedWords.length) return 0;
  let anchor = hintAnchor();
  let count = 0;
  while (anchor > 2 && count < 100) {
    anchor = Math.max(2, Math.round((anchor + 1) / 2));
    count++;
  }
  return count;
}

// Reveals a word ranked BETWEEN the current best guess on the board and the
// answer itself (rank 1) — never the answer, and never something that isn't
// actually closer than what's already been found. Rather than crawling one
// rank at a time, each hint aims for the midpoint of that gap (e.g. best
// guess is #250 -> hint lands near #125 -> next hint near #63, and so on),
// so every hint is a meaningful, evenly-spaced step closer instead of a
// barely-noticeable nudge. If the exact midpoint rank has already been
// found or hinted, it searches outward from the midpoint (checking the
// rank just above and just below alternately) until it finds one that's
// still available, always staying strictly between 1 and the anchor.
function giveHint() {
  const g = state.game;
  if (!g.active) { broadcast({ type: 'server_error', message: 'Start a round before asking for a hint.' }); return; }

  const anchor = hintAnchor(); // current best rank on the board (or the opening cap)
  if (anchor <= 2) {
    broadcast({ type: 'server_error', message: 'No better hint available right now — your guesses are already this close!' });
    return;
  }

  const midpoint = Math.max(2, Math.round((anchor + 1) / 2));

  for (let offset = 0; offset < anchor - 1; offset++) {
    const candidates = offset === 0 ? [midpoint] : [midpoint - offset, midpoint + offset];
    for (const r of candidates) {
      if (r < 2 || r >= anchor) continue; // must stay strictly between #1 and the current best
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

// "Play until finished": every tick the chance that the bots land on the
// exact secret word climbs a little higher, on top of the small flat base
// chance. That means autoplay always converges on a win within a bounded,
// predictable number of ticks instead of (rarely, but possibly) running for
// a very long time on bad luck — the round-ending guess is guaranteed to
// happen, not just likely.
const AUTOPLAY_BASE_WIN_CHANCE = 0.06;
const AUTOPLAY_WIN_CHANCE_STEP = 0.015; // added per tick since the round started
const AUTOPLAY_MAX_TICKS_BEFORE_FORCE = 45; // by this many ticks, the chance is 100%

function autoplayTick() {
  if (!state.game.active) {
    clearInterval(testAutoplayTimer);
    state.autoplay.running = false;
    return;
  }
  state.autoplay.ticks = (state.autoplay.ticks || 0) + 1;
  // Prefer words nobody has guessed yet so the board keeps filling up.
  const fresh = orderedWords.slice(1, 60).filter((w) => !state.game.allGuessedWords.has(w));
  const winChance = Math.min(1, AUTOPLAY_BASE_WIN_CHANCE + state.autoplay.ticks * AUTOPLAY_WIN_CHANCE_STEP);
  const forceWin = state.autoplay.ticks >= AUTOPLAY_MAX_TICKS_BEFORE_FORCE;
  const guess = (!fresh.length || forceWin || Math.random() < winChance) ? state.game.targetWord : pickRandom(fresh);
  simulateChatMessage(pickRandom(FAKE_USERS), guess);
}

function toggleTestAutoplay(on, speed) {
  clearInterval(testAutoplayTimer);
  state.autoplay.running = false;
  if (AUTOPLAY_MS[speed]) state.autoplay.speed = speed;
  if (on && state.game.active && state.mode === 'test') {
    state.autoplay.running = true;
    state.autoplay.ticks = 0; // fresh countdown to a guaranteed win each time it (re)starts
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
    case 'save_default_settings': {
      // "Save & Apply as Default" — only ever writes this known, small
      // whitelist of fields, straight from the Settings panel, never
      // anything else a message might carry.
      const s = msg.settings || {};
      const allowed = [
        'mode', 'username', 'autoplay', 'speed', 'playerName', 'autoNextRound',
        'timingAnswerSeconds', 'timingLeaderboardSeconds', 'timingPopupSeconds', 'timingAutoNextSeconds',
      ];
      const clean = {};
      for (const key of allowed) if (Object.prototype.hasOwnProperty.call(s, key)) clean[key] = s[key];
      state.defaultSettings = clean;
      saveDefaultSettings(clean);
      pushState();
      break;
    }
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
  loadFrequencyList().catch((err) => console.error('[frequency] unexpected error:', err));
});
