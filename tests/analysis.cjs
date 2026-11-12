// Run with node tests/analysis.cjs. Pure-function checks with no browser: filename parsing,
// BPM detection, Hot Cue normalisation, formatting/escaping and validation of saved playlists/history.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

// Copy one top-level function out of app.js by matching its braces.
function extract(name) {
  const start = source.search(new RegExp(`^function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `function ${name} not found in app.js`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unbalanced braces in ${name}`);
}

const storage = new Map();
const context = vm.createContext({
  console: { warn: () => {} },
  clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
  HOT_CUE_NUMBERS: { A: 1, B: 2, C: 3, D: 4 },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { if (key === 'full') throw new Error('QuotaExceededError'); storage.set(key, String(value)); },
  },
});
for (const name of ['parseFilename', 'estimateBpm', 'normaliseHotCues', 'formatTime', 'formatBytes', 'escapeHtml',
  'readStoredJson', 'writeStoredJson', 'loadStoredHistory', 'loadStoredPlaylists']) {
  vm.runInContext(extract(name), context);
}
const plain = (value) => JSON.parse(JSON.stringify(value)); // vm objects have another realm's prototypes

// Filenames
assert.deepEqual(plain(context.parseFilename('Artist Name - Track Title.mp3')), { artist: 'Artist Name', title: 'Track Title' });
assert.deepEqual(plain(context.parseFilename('Artist – Title – Extended Mix.flac')), { artist: 'Artist', title: 'Title – Extended Mix' });
assert.deepEqual(plain(context.parseFilename('my_track_name.wav')), { artist: 'Unknown Artist', title: 'my track name' });
assert.deepEqual(plain(context.parseFilename('.mp3')), { artist: 'Unknown Artist', title: 'Untitled Track' });

// BPM detection on a synthetic kick pattern
function clickTrack(bpm, seconds = 60, sampleRate = 22050) {
  const data = new Float32Array(seconds * sampleRate);
  const period = (60 / bpm) * sampleRate;
  for (let beat = 0; beat * period < data.length; beat += 1) {
    const start = Math.round(beat * period);
    for (let i = 0; i < 800 && start + i < data.length; i += 1) data[start + i] = Math.sin(i / 6) * Math.exp(-i / 160);
  }
  return { sampleRate, duration: seconds, numberOfChannels: 1, length: data.length, getChannelData: () => data };
}
// Within 0.5 BPM across the range and common sample rates (before 1.2.0 it read up to 2.5 BPM low).
for (const sampleRate of [22050, 44100, 48000]) {
  for (const bpm of [90, 96, 110, 120, 124, 126, 128, 132, 140, 150, 160, 174]) {
    const detected = context.estimateBpm(clickTrack(bpm, 60, sampleRate));
    assert.ok(Math.abs(detected - bpm) <= 0.5, `expected ~${bpm} BPM at ${sampleRate} Hz, detected ${detected}`);
  }
}
// Outside 88–176 the result folds by octaves: this is why the BPM editor has ½× and 2×.
assert.ok(Math.abs(context.estimateBpm(clickTrack(70)) - 140) <= 0.5, 'slow tempo doubles');
assert.equal(context.estimateBpm(clickTrack(124, 3)), 128, 'too short to analyse falls back to 128');

// Hot Cues
assert.deepEqual(plain(context.normaliseHotCues({ A: 1.5, B: '2', C: -1, D: 'x', E: 3 })), { A: 1.5, B: 2 });
assert.deepEqual(plain(context.normaliseHotCues({ A: null, B: '', C: 0 })), { C: 0 });
assert.deepEqual(plain(context.normaliseHotCues(undefined)), {});

// Formatting and escaping
assert.equal(context.formatTime(125.67, true), '02:05.6');
assert.equal(context.formatTime(NaN), '00:00');
assert.equal(context.formatTime(-4), '00:00');
assert.equal(context.formatBytes(512), '512 B');
assert.equal(context.formatBytes(1536), '1.50 KB');
assert.equal(context.formatBytes(5 * 1024 ** 3), '5.00 GB');
assert.equal(context.escapeHtml(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');

// Saved history and playlists
assert.deepEqual(plain(context.loadStoredHistory()), []);
storage.set('dualDeckHistory', '["a",2,null,"b"]');
assert.deepEqual(plain(context.loadStoredHistory()), ['a', 'b']);
storage.set('dualDeckHistory', '{broken');
assert.deepEqual(plain(context.loadStoredHistory()), []);
assert.deepEqual(plain(context.loadStoredPlaylists()).map((p) => p.name), ['Warm Up', 'Peak Time', 'Closing']);
storage.set('dualDeckPlaylists', '[]');
assert.deepEqual(plain(context.loadStoredPlaylists()), [], 'an emptied playlist list stays empty');
storage.set('dualDeckPlaylists', '[{"id":"x","name":"Mine","trackIds":["a",1]},{"id":2,"name":"Bad"},null,{"id":"y","name":"No tracks"}]');
assert.deepEqual(plain(context.loadStoredPlaylists()), [{ id: 'x', name: 'Mine', trackIds: ['a'] }, { id: 'y', name: 'No tracks', trackIds: [] }]);
assert.equal(context.writeStoredJson('ok', { a: 1 }), true);
assert.equal(storage.get('ok'), '{"a":1}');
assert.equal(context.writeStoredJson('full', 1), false);

console.log('PASS analysis: filename parsing, BPM detection and octave folding, Hot Cues, formatting, escaping, saved playlist/history validation');
