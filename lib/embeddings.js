'use strict';
/**
 * Word-embedding ranking engine (the same idea the real Contexto uses).
 *
 * Every word in a fixed vocabulary has a vector. When a round starts, every
 * vocabulary word is ranked by cosine similarity to the secret word, so
 * rank #1 is the secret word, #2 is its closest neighbour, and so on down
 * the whole vocabulary. A word's rank never depends on guess order.
 *
 * Vectors come from pre-trained GloVe (Wikipedia + Gigaword), published as a
 * gensim "KeyedVectors" save on Hugging Face: a `.vectors.npy` matrix plus a
 * pickled `.model` file holding the word list. Both are read here without
 * Python. The result is trimmed to the most common ~70k real words and cached
 * on disk, so restarts are fast.
 *
 * You can override the source with environment variables:
 *   EMBEDDING_NPY_URL    link to a .npy float32 matrix  (rows = words)
 *   EMBEDDING_VOCAB_URL  link to the matching word list (plain text, one
 *                        word per line, OR a gensim .model pickle)
 * Or drop `vectors.npy` + `vocab.txt` (or `vocab.model`) into data/vectors/.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_VOCAB = 70000;       // how many words stay guessable
const SCAN_ROWS = 220000;      // only look at the most frequent rows of the source
const CACHE_VERSION = 'v2';

const HF = 'https://huggingface.co/fse/';
const DEFAULT_SOURCES = [
  { name: 'glove-wiki-gigaword-100', npy: HF + 'glove-wiki-gigaword-100/resolve/main/glove-wiki-gigaword-100.model.vectors.npy', vocab: HF + 'glove-wiki-gigaword-100/resolve/main/glove-wiki-gigaword-100.model' },
  { name: 'glove-wiki-gigaword-50', npy: HF + 'glove-wiki-gigaword-50/resolve/main/glove-wiki-gigaword-50.model.vectors.npy', vocab: HF + 'glove-wiki-gigaword-50/resolve/main/glove-wiki-gigaword-50.model' },
];

// ---------- .npy parsing ----------
function parseNpy(buf) {
  if (buf.length < 12 || buf[0] !== 0x93 || buf.toString('latin1', 1, 6) !== 'NUMPY') throw new Error('not a .npy file');
  const major = buf[6];
  let headerLen, headerStart;
  if (major === 1) { headerLen = buf.readUInt16LE(8); headerStart = 10; }
  else { headerLen = buf.readUInt32LE(8); headerStart = 12; }
  const header = buf.toString('latin1', headerStart, headerStart + headerLen);
  const descr = (header.match(/'descr'\s*:\s*'([^']+)'/) || [])[1];
  const fortran = /'fortran_order'\s*:\s*True/.test(header);
  const shape = (header.match(/'shape'\s*:\s*\(([^)]*)\)/) || [])[1];
  if (descr !== '<f4' || fortran || !shape) throw new Error('unsupported .npy layout: ' + header.trim());
  const dims = shape.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  if (dims.length !== 2) throw new Error('expected a 2-D matrix');
  const dataStart = headerStart + headerLen;
  const rows = dims[0], cols = dims[1];
  if (buf.length < dataStart + rows * cols * 4) throw new Error('.npy file is truncated');
  // Copy to an aligned Float32Array (Buffers from fetch may be unaligned).
  const data = new Float32Array(rows * cols);
  Buffer.from(data.buffer).set(buf.subarray(dataStart, dataStart + rows * cols * 4));
  return { rows, cols, data };
}

// ---------- word list: plain text or gensim pickle ----------
function looksLikePickle(buf) { return buf.length > 2 && buf[0] === 0x80; }

/**
 * Pulls the vocabulary out of a gensim KeyedVectors pickle without a full
 * pickle interpreter: the `index_to_key` list is the one very long run of
 * consecutive pickled strings (the `key_to_index` dict interleaves ints, so
 * it never forms a long run). `expectedRows` picks the right run.
 */
function wordsFromPickle(buf, expectedRows) {
  let best = [];
  let run = [];
  const flush = () => { if (run.length > best.length) best = run; run = []; };
  let i = 0;
  const n = buf.length;
  while (i < n) {
    const op = buf[i];
    let len = -1, start = 0;
    if (op === 0x8c && i + 2 <= n) { len = buf[i + 1]; start = i + 2; }                   // SHORT_BINUNICODE
    else if (op === 0x58 && i + 5 <= n) { len = buf.readUInt32LE(i + 1); start = i + 5; } // BINUNICODE
    if (len >= 0) {
      if (len > 0 && len <= 80 && start + len <= n) {
        run.push(buf.toString('utf8', start, start + len));
        i = start + len;
        // optional memoize ops that follow every string
        if (buf[i] === 0x94) i += 1;
        else if (buf[i] === 0x71) i += 2;
        else if (buf[i] === 0x72) i += 5;
        continue;
      }
      flush(); i += 1; continue;
    }
    // opcodes that may sit between strings inside one long list
    if (op === 0x28 || op === 0x65 || op === 0x61) { i += 1; continue; }                 // MARK, APPENDS, APPEND
    if (op === 0x95 && i + 9 <= n) { i += 9; continue; }                                  // FRAME
    if (op === 0x94) { i += 1; continue; }                                                // MEMOIZE
    flush();
    i += 1;
  }
  flush();
  if (expectedRows && best.length < expectedRows) throw new Error(`vocabulary scan found ${best.length} words, expected ${expectedRows}`);
  return expectedRows ? best.slice(0, expectedRows) : best;
}

function wordsFromBuffer(buf, expectedRows) {
  if (looksLikePickle(buf)) return wordsFromPickle(buf, expectedRows);
  return buf.toString('utf8').split(/\r?\n/).map((s) => s.trim().split(/\s+/)[0]).filter((s) => s !== undefined).slice(0, expectedRows || undefined);
}

async function download(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
    return Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(timer); }
}

// ---------- the engine ----------
function createEmbeddings(log = console.log) {
  const eng = {
    status: 'idle',      // idle | loading | ready | failed
    source: null,
    dims: 0,
    words: [],
    index: new Map(),
    vectors: null,       // Float32Array, normalized rows
    error: null,
  };
  const cacheBin = path.join(os.tmpdir(), `contexto-vectors.${CACHE_VERSION}.bin`);
  const cacheTxt = path.join(os.tmpdir(), `contexto-vectors.${CACHE_VERSION}.txt`);

  function install(words, dims, vectors, source) {
    eng.words = words;
    eng.dims = dims;
    eng.vectors = vectors;
    eng.index = new Map(words.map((w, i) => [w, i]));
    eng.source = source;
    eng.status = 'ready';
    eng.error = null;
  }

  // Keeps only common, real, lowercase words; centres + normalizes vectors.
  function compact(allWords, matrix, cols, isAllowed, source) {
    const keep = [];
    const seen = new Set();
    const limit = Math.min(allWords.length, SCAN_ROWS);
    for (let r = 0; r < limit && keep.length < MAX_VOCAB; r++) {
      const w = allWords[r];
      if (!/^[a-z]{2,20}$/.test(w) || seen.has(w)) continue;
      if (isAllowed && !isAllowed(w)) continue;
      seen.add(w);
      keep.push(r);
    }
    if (keep.length < 5000) throw new Error('only ' + keep.length + ' usable words in the vector file');
    const out = new Float32Array(keep.length * cols);
    const mean = new Float64Array(cols);
    keep.forEach((r, i) => {
      for (let c = 0; c < cols; c++) { const v = matrix[r * cols + c]; out[i * cols + c] = v; mean[c] += v; }
    });
    for (let c = 0; c < cols; c++) mean[c] /= keep.length;
    for (let i = 0; i < keep.length; i++) {
      let norm = 0;
      for (let c = 0; c < cols; c++) { const v = out[i * cols + c] - mean[c]; out[i * cols + c] = v; norm += v * v; }
      norm = Math.sqrt(norm) || 1;
      for (let c = 0; c < cols; c++) out[i * cols + c] /= norm;
    }
    return { words: keep.map((r) => allWords[r]), dims: cols, vectors: out, source };
  }

  function saveCache(c) {
    try {
      fs.writeFileSync(cacheBin, Buffer.from(c.vectors.buffer, c.vectors.byteOffset, c.vectors.byteLength));
      fs.writeFileSync(cacheTxt, c.source + '\n' + c.dims + '\n' + c.words.join('\n'));
    } catch { /* read-only disk: fine */ }
  }
  function loadCache() {
    if (!fs.existsSync(cacheBin) || !fs.existsSync(cacheTxt)) return null;
    const lines = fs.readFileSync(cacheTxt, 'utf8').split('\n');
    const source = lines[0], dims = Number(lines[1]);
    const words = lines.slice(2).filter(Boolean);
    const raw = fs.readFileSync(cacheBin);
    const vectors = new Float32Array(words.length * dims);
    Buffer.from(vectors.buffer).set(raw.subarray(0, vectors.byteLength));
    if (raw.length < vectors.byteLength || !dims || words.length < 5000) return null;
    return { words, dims, vectors, source: source + ' (cached)' };
  }

  async function fromSource(src, isAllowed) {
    const npyBuf = src.npyBuf || await download(src.npy, 240000);
    const { rows, cols, data } = parseNpy(npyBuf);
    const vocabBuf = src.vocabBuf || await download(src.vocab, 120000);
    const words = wordsFromBuffer(vocabBuf, rows);
    if (words.length < rows) throw new Error('word list shorter than matrix');
    return compact(words, data, cols, isAllowed, src.name);
  }

  eng.load = async function load(isAllowed) {
    if (eng.status === 'loading' || eng.status === 'ready') return;
    eng.status = 'loading';
    try {
      const cached = loadCache();
      if (cached) { install(cached.words, cached.dims, cached.vectors, cached.source); log(`[embeddings] ready from cache: ${cached.words.length} words (${cached.source})`); return; }

      const sources = [];
      // 1. files placed in data/vectors/
      const dir = path.join(__dirname, '..', 'data', 'vectors');
      const localNpy = path.join(dir, 'vectors.npy');
      const localVocab = ['vocab.txt', 'vocab.model'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
      if (fs.existsSync(localNpy) && localVocab) sources.push({ name: 'local files', npyBuf: fs.readFileSync(localNpy), vocabBuf: fs.readFileSync(localVocab) });
      // 2. custom links
      if (process.env.EMBEDDING_NPY_URL && process.env.EMBEDDING_VOCAB_URL) sources.push({ name: 'custom links', npy: process.env.EMBEDDING_NPY_URL, vocab: process.env.EMBEDDING_VOCAB_URL });
      // 3. built-in downloads
      sources.push(...DEFAULT_SOURCES);

      let lastErr = null;
      for (const src of sources) {
        try {
          log(`[embeddings] loading ${src.name}…`);
          const c = await fromSource(src, isAllowed);
          install(c.words, c.dims, c.vectors, c.source);
          saveCache(c);
          log(`[embeddings] ready: ${c.words.length} words, ${c.dims} dimensions (${c.source})`);
          return;
        } catch (err) {
          lastErr = err;
          log(`[embeddings] ${src.name} failed: ${err.message}`);
        }
      }
      throw lastErr || new Error('no embedding source worked');
    } catch (err) {
      eng.status = 'failed';
      eng.error = err.message;
      log('[embeddings] unavailable, using the Datamuse backup ranking: ' + err.message);
    }
  };

  eng.has = (w) => eng.index.has(w);

  /** Whole vocabulary, closest first. The target itself is always first. */
  eng.rankAll = function rankAll(target) {
    const t = eng.index.get(target);
    if (t === undefined) return null;
    const { vectors, dims, words } = eng;
    const n = words.length;
    const sims = new Float32Array(n);
    const tv = vectors.subarray(t * dims, (t + 1) * dims);
    for (let i = 0; i < n; i++) {
      let s = 0;
      const o = i * dims;
      for (let c = 0; c < dims; c++) s += vectors[o + c] * tv[c];
      sims[i] = s;
    }
    sims[t] = Infinity;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    idx.sort((a, b) => sims[b] - sims[a] || a - b);
    const order = new Array(n);
    for (let i = 0; i < n; i++) order[i] = words[idx[i]];
    return order;
  };

  // Test hook: install synthetic vectors.
  eng._installForTest = install;
  eng._internals = { parseNpy, wordsFromPickle, wordsFromBuffer, compact };
  return eng;
}

module.exports = { createEmbeddings, parseNpy, wordsFromPickle };
