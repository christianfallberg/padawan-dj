'use strict';

const APP_VERSION = '6.2.54';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const TAU = Math.PI * 2;
const JOG_SCRATCH_SECONDS_PER_REVOLUTION = 1.8;
const JOG_NUDGE_SECONDS_PER_REVOLUTION = 0.45;
const JOG_SCRATCH_RADIUS_RATIO = 0.90; // Only the outermost 10% is nudge.
const JOG_CENTER_RADIUS_RATIO = 0.20; // Centre is controlled by horizontal dragging.
const DEFAULT_WAVEFORM_WINDOW_SECONDS = 32;
const HOT_CUE_COLORS = { A: '#ff5278', B: '#459eff', C: '#24dca6', D: '#b17aff' };
const HOT_CUE_NUMBERS = { A: 1, B: 2, C: 3, D: 4 }; // Keep original A-D storage keys.

const state = {
  tracks: [],
  history: JSON.parse(localStorage.getItem('dualDeckHistory') || '[]'),
  selectedDeck: 'A',
  selectedTrackId: null,
  source: 'collection',
  search: '',
  sort: { field: 'addedAt', direction: 'desc' },
  playlists: JSON.parse(localStorage.getItem('dualDeckPlaylists') || 'null') || [
    { id: 'warm-up', name: 'Warm Up', trackIds: [] },
    { id: 'peak-time', name: 'Peak Time', trackIds: [] },
    { id: 'closing', name: 'Closing', trackIds: [] },
  ],
  db: null,
  importing: false,
  waveformWindowSeconds: DEFAULT_WAVEFORM_WINDOW_SECONDS,
  deferredInstallPrompt: null,
  serviceWorkerReady: false,
};

const ui = {
  fileInput: $('#fileInput'),
  importButton: $('#importButton'),
  loadDemosButton: $('#loadDemosButton'),
  clearLibraryButton: $('#clearLibraryButton'),
  trackTableBody: $('#trackTableBody'),
  searchInput: $('#searchInput'),
  libraryStatus: $('#libraryStatus'),
  browserHeading: $('#browserHeading'),
  browserCount: $('#browserCount'),
  totalDuration: $('#totalDuration'),
  toast: $('#toast'),
  helpDialog: $('#helpDialog'),
  installButton: $('#installButton'),
  storageButton: $('#storageButton'),
  storageCompact: $('#storageCompact'),
  storageDialog: $('#storageDialog'),
  storageTrackCount: $('#storageTrackCount'),
  storageLibrarySize: $('#storageLibrarySize'),
  storageUsed: $('#storageUsed'),
  storageQuota: $('#storageQuota'),
  storageMeterFill: $('#storageMeterFill'),
  persistentStatus: $('#persistentStatus'),
  offlineStatus: $('#offlineStatus'),
  actionDialog: $('#actionDialog'),
  actionDialogForm: $('#actionDialogForm'),
  actionDialogCode: $('#actionDialogCode'),
  actionDialogTitle: $('#actionDialogTitle'),
  actionDialogMessage: $('#actionDialogMessage'),
  actionDialogField: $('#actionDialogField'),
  actionDialogLabel: $('#actionDialogLabel'),
  actionDialogInput: $('#actionDialogInput'),
  actionDialogConfirm: $('#actionDialogConfirm'),
  actionDialogCancel: $('#actionDialogCancel'),
  actionDialogClose: $('#actionDialogClose'),
  requestPersistenceButton: $('#requestPersistenceButton'),
  exportLibraryButton: $('#exportLibraryButton'),
  clearLibraryDialogButton: $('#clearLibraryDialogButton'),
  storageOrigin: $('#storageOrigin'),
  levelBars: $$('.level-meter i'),
};

function showToast(message, duration = 2200) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => ui.toast.classList.remove('show'), duration);
}

function requestDialog({ title, message, code = 'SYSTEM ACTION', label = '', value = '', type = 'text', min, max, step, confirmText = 'CONFIRM', danger = false }) {
  return new Promise((resolve) => {
    const hasInput = Boolean(label);
    ui.actionDialogCode.textContent = code;
    ui.actionDialogTitle.textContent = title;
    ui.actionDialogMessage.textContent = message;
    ui.actionDialogField.hidden = !hasInput;
    ui.actionDialogLabel.textContent = label;
    ui.actionDialogInput.type = type;
    ui.actionDialogInput.value = value;
    ui.actionDialogInput.min = min ?? '';
    ui.actionDialogInput.max = max ?? '';
    ui.actionDialogInput.step = step ?? '';
    ui.actionDialogInput.required = hasInput;
    ui.actionDialogConfirm.textContent = confirmText;
    ui.actionDialogConfirm.classList.toggle('danger', danger);

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      ui.actionDialogForm.removeEventListener('submit', submit);
      ui.actionDialogCancel.removeEventListener('click', cancel);
      ui.actionDialogClose.removeEventListener('click', cancel);
      ui.actionDialog.removeEventListener('cancel', cancelEvent);
      ui.actionDialog.close();
      resolve(result);
    };
    const submit = (event) => {
      event.preventDefault();
      if (hasInput && !ui.actionDialogForm.reportValidity()) return;
      finish(hasInput ? ui.actionDialogInput.value : true);
    };
    const cancel = () => finish(null);
    const cancelEvent = (event) => { event.preventDefault(); cancel(); };
    ui.actionDialogForm.addEventListener('submit', submit);
    ui.actionDialogCancel.addEventListener('click', cancel);
    ui.actionDialogClose.addEventListener('click', cancel);
    ui.actionDialog.addEventListener('cancel', cancelEvent);
    ui.actionDialog.showModal();
    if (hasInput) requestAnimationFrame(() => { ui.actionDialogInput.focus(); ui.actionDialogInput.select(); });
    else requestAnimationFrame(() => ui.actionDialogConfirm.focus());
  });
}

function formatTime(seconds, tenths = false) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenth = Math.floor((seconds % 1) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}${tenths ? `.${tenth}` : ''}`;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit' }).format(new Date(timestamp));
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaled = value / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && scaled >= 1024; i += 1) {
    scaled /= 1024;
    unit = units[i];
  }
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(decimals)} ${unit}`;
}

function localLibraryBytes() {
  return state.tracks.reduce((total, track) => total + (track.blob?.size || 0) + (track.coverBlob?.size || 0), 0);
}

function parseFilename(filename) {
  const clean = filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' ').trim();
  const separator = clean.includes(' - ') ? ' - ' : clean.includes(' – ') ? ' – ' : null;
  if (!separator) return { artist: 'Unknown Artist', title: clean || 'Untitled Track' };
  const [artist, ...titleParts] = clean.split(separator);
  return { artist: artist.trim() || 'Unknown Artist', title: titleParts.join(separator).trim() || clean };
}


function synchsafeInteger(bytes, offset) {
  return ((bytes[offset] & 0x7f) << 21) | ((bytes[offset + 1] & 0x7f) << 14) | ((bytes[offset + 2] & 0x7f) << 7) | (bytes[offset + 3] & 0x7f);
}

function decodeId3Text(bytes) {
  if (!bytes?.length) return '';
  const encoding = bytes[0];
  let payload = bytes.slice(1);
  try {
    if (encoding === 0) return new TextDecoder('iso-8859-1').decode(payload).replace(/\0/g, '').trim();
    if (encoding === 3) return new TextDecoder('utf-8').decode(payload).replace(/\0/g, '').trim();
    if (encoding === 2) {
      const swapped = new Uint8Array(payload.length);
      for (let i = 0; i + 1 < payload.length; i += 2) { swapped[i] = payload[i + 1]; swapped[i + 1] = payload[i]; }
      return new TextDecoder('utf-16le').decode(swapped).replace(/\0/g, '').trim();
    }
    return new TextDecoder('utf-16').decode(payload).replace(/\0/g, '').trim();
  } catch (_) {
    return '';
  }
}

function findId3Terminator(bytes, start, encoding) {
  if (encoding === 0 || encoding === 3) {
    const index = bytes.indexOf(0, start);
    return index === -1 ? bytes.length : index;
  }
  for (let i = start; i + 1 < bytes.length; i += 2) {
    if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
  }
  return bytes.length;
}

function readId3Metadata(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const metadata = {};
  if (bytes.length < 10 || String.fromCharCode(...bytes.slice(0, 3)) !== 'ID3') return metadata;
  const version = bytes[3];
  const tagEnd = Math.min(bytes.length, 10 + synchsafeInteger(bytes, 6));
  let offset = 10;

  while (offset + 10 <= tagEnd) {
    const frameId = String.fromCharCode(...bytes.slice(offset, offset + 4));
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
    const frameSize = version === 4
      ? synchsafeInteger(bytes, offset + 4)
      : ((bytes[offset + 4] << 24) >>> 0) + (bytes[offset + 5] << 16) + (bytes[offset + 6] << 8) + bytes[offset + 7];
    if (!frameSize || offset + 10 + frameSize > bytes.length) break;
    const payload = bytes.slice(offset + 10, offset + 10 + frameSize);

    if (frameId === 'TIT2') metadata.title = decodeId3Text(payload);
    else if (frameId === 'TPE1') metadata.artist = decodeId3Text(payload);
    else if (frameId === 'TALB') metadata.album = decodeId3Text(payload);
    else if (frameId === 'TKEY') metadata.key = decodeId3Text(payload);
    else if (frameId === 'APIC' && payload.length > 8 && !metadata.coverBlob) {
      const encoding = payload[0];
      const mimeEnd = payload.indexOf(0, 1);
      if (mimeEnd > 1) {
        const mime = new TextDecoder('iso-8859-1').decode(payload.slice(1, mimeEnd)) || 'image/jpeg';
        const descriptionStart = mimeEnd + 2;
        const descriptionEnd = findId3Terminator(payload, descriptionStart, encoding);
        const imageStart = Math.min(payload.length, descriptionEnd + (encoding === 0 || encoding === 3 ? 1 : 2));
        const imageBytes = payload.slice(imageStart);
        if (imageBytes.length > 32) metadata.coverBlob = new Blob([imageBytes], { type: mime });
      }
    }
    offset += 10 + frameSize;
  }
  return metadata;
}

function coverInitials(track) {
  const source = (track?.title || 'DD').trim().split(/\s+/).slice(0, 2).map((word) => word[0] || '').join('').toUpperCase();
  return source || 'DD';
}

function fallbackCoverDataUrl(track) {
  const seed = [...`${track?.title || ''}${track?.artist || ''}`].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const hue = seed % 360;
  const initials = coverInitials(track);
  const title = escapeHtml(track?.title || 'Padawan DJ');
  const artist = escapeHtml(track?.artist || 'Performance');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 82% 48%)"/><stop offset="1" stop-color="hsl(${(hue + 55) % 360} 78% 14%)"/></linearGradient></defs><rect width="320" height="320" fill="#090c11"/><circle cx="250" cy="70" r="175" fill="url(#g)" opacity=".92"/><path d="M-30 250L245-25M20 340L340 20" stroke="white" stroke-opacity=".18" stroke-width="18"/><text x="28" y="205" fill="white" font-family="Arial,sans-serif" font-size="96" font-weight="800">${initials}</text><text x="30" y="260" fill="white" font-family="Arial,sans-serif" font-size="18" font-weight="700">${title.slice(0, 24)}</text><text x="30" y="286" fill="white" fill-opacity=".7" font-family="Arial,sans-serif" font-size="14">${artist.slice(0, 28)}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function getTrackCoverUrl(track) {
  if (!track) return '';
  if (track.coverUrl) return track.coverUrl;
  track.coverUrl = track.coverBlob ? URL.createObjectURL(track.coverBlob) : fallbackCoverDataUrl(track);
  return track.coverUrl;
}

function normaliseHotCues(hotCues) {
  const result = {};
  for (const letter of Object.keys(HOT_CUE_NUMBERS)) {
    const rawValue = hotCues?.[letter];
    if (rawValue === null || rawValue === undefined || rawValue === '') continue;
    const value = Number(rawValue);
    if (Number.isFinite(value) && value >= 0) result[letter] = value;
  }
  return result;
}

function createPeaks(buffer, length = 2400) {
  const channelCount = Math.min(buffer.numberOfChannels, 2);
  const sampleLength = buffer.length;
  const blockSize = Math.max(1, Math.floor(sampleLength / length));
  const peaks = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = i * blockSize;
    const end = Math.min(sampleLength, start + blockSize);
    let max = 0;
    for (let sample = start; sample < end; sample += Math.max(1, Math.floor(blockSize / 22))) {
      let value = 0;
      for (let channel = 0; channel < channelCount; channel += 1) {
        value += Math.abs(buffer.getChannelData(channel)[sample] || 0);
      }
      max = Math.max(max, value / channelCount);
    }
    peaks[i] = Math.min(1, max * 1.35);
  }
  return peaks;
}

function estimateBpm(buffer) {
  const sampleRate = buffer.sampleRate;
  const channel = buffer.getChannelData(0);
  const secondsToAnalyze = Math.min(90, buffer.duration);
  const envelopeRate = 100;
  const frameSize = Math.max(1, Math.floor(sampleRate / envelopeRate));
  const frameCount = Math.floor((secondsToAnalyze * sampleRate) / frameSize);
  if (frameCount < 400) return 128;

  const energy = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * frameSize;
    const end = Math.min(channel.length, start + frameSize);
    let sum = 0;
    for (let i = start; i < end; i += 4) sum += Math.abs(channel[i]);
    energy[frame] = sum / Math.max(1, Math.ceil((end - start) / 4));
  }

  const onset = new Float32Array(frameCount);
  let mean = 0;
  for (let i = 2; i < frameCount; i += 1) {
    const local = energy[i] - (energy[i - 1] * 0.8 + energy[i - 2] * 0.2);
    onset[i] = Math.max(0, local);
    mean += onset[i];
  }
  mean /= frameCount;
  for (let i = 0; i < frameCount; i += 1) onset[i] = Math.max(0, onset[i] - mean * 0.6);

  let bestBpm = 128;
  let bestScore = -Infinity;
  for (let bpm = 72; bpm <= 180; bpm += 0.5) {
    const lag = Math.round((envelopeRate * 60) / bpm);
    let score = 0;
    for (let i = lag; i < frameCount; i += 1) {
      score += onset[i] * onset[i - lag];
    }
    const halfLag = lag * 2;
    if (halfLag < frameCount) {
      for (let i = halfLag; i < frameCount; i += 2) score += onset[i] * onset[i - halfLag] * 0.18;
    }
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }

  while (bestBpm < 88) bestBpm *= 2;
  while (bestBpm > 176) bestBpm /= 2;
  return Math.round(bestBpm * 10) / 10;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('dualDeckPerformance', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('tracks')) {
        db.createObjectStore('tracks', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const request = state.db.transaction('tracks', 'readonly').objectStore('tracks').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function dbPut(track) {
  const stored = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    bpm: track.bpm,
    key: track.key,
    duration: track.duration,
    addedAt: track.addedAt,
    filename: track.filename,
    gridOffset: track.gridOffset || 0,
    hotCues: normaliseHotCues(track.hotCues),
    album: track.album || '',
    coverBlob: track.coverBlob || null,
    blob: track.blob,
  };
  return new Promise((resolve, reject) => {
    const request = state.db.transaction('tracks', 'readwrite').objectStore('tracks').put(stored);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function dbClear() {
  return new Promise((resolve, reject) => {
    const request = state.db.transaction('tracks', 'readwrite').objectStore('tracks').clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function dbDelete(trackId) {
  return new Promise((resolve, reject) => {
    const request = state.db.transaction('tracks', 'readwrite').objectStore('tracks').delete(trackId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = audioContext.createGain();
const masterAnalyser = audioContext.createAnalyser();
masterAnalyser.fftSize = 256;
masterGain.gain.value = 0.85;
masterGain.connect(masterAnalyser);
masterAnalyser.connect(audioContext.destination);
const cueBus = audioContext.createGain();
const cueStream = audioContext.createMediaStreamDestination();
cueBus.connect(cueStream);
cueBus.gain.value = 0.65;
const cueAudio = new Audio();
cueAudio.srcObject = cueStream.stream;
cueAudio.muted = true; // Fail closed: CUE must never play through default speakers.
cueAudio.playsInline = true;
const cueGains = {};
let cueDeviceId = null;
let cueEnabled = false;

function refreshCueGates() {
  for (const [id, gain] of Object.entries(cueGains)) {
    const button = document.querySelector(`.mixer-channel[data-deck="${id}"] .cue-monitor`);
    const active = Boolean(button?.classList.contains('active'));
    button?.setAttribute('aria-pressed', String(active));
    gain.gain.setTargetAtTime(active ? 1 : 0, audioContext.currentTime, 0.01);
  }
}

async function listCueDevices() {
  const select = $('#headphoneOutput');
  if (!navigator.mediaDevices?.enumerateDevices) {
    select.replaceChildren(new Option('Device selection not available in this browser', ''));
    return [];
  }
  const previous = select.value || cueDeviceId;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === 'audiooutput' && device.deviceId && !['default', 'communications'].includes(device.deviceId)
  );
  select.replaceChildren(new Option('Select USB headphones / audio interface', ''));
  for (const [index, device] of devices.entries()) {
    select.add(new Option(device.label || `Audio output ${index + 1} (permission needed)`, device.deviceId));
  }
  if (devices.some((device) => device.deviceId === previous)) select.value = previous;
  return devices;
}

// On Chrome, requesting microphone permission exposes the full audio output list.
// The stream is immediately stopped and is never connected to the DJ audio graph.
async function discoverCueDevices() {
  const status = $('#cueOutputStatus');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone permission API is not available in this browser.');
  status.textContent = 'Requesting temporary audio device permission…';
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
  const devices = await listCueDevices();
  status.textContent = devices.length
    ? `${devices.length} output device(s) detected. Select your USB-C headphones, then enable.`
    : 'No separate output detected. Check the USB-C headphones in macOS Sound settings.';
}

// Errors must be visible in the panel, not just buried in the Console.
function describeCueError(error) {
  const label = error?.name || 'Error';
  const detail = error?.message || 'Unknown audio routing error';
  const advice = {
    NotAllowedError: 'Allow audio device access in Chrome or macOS; then use DETECT OUTPUTS.',
    NotFoundError: 'Selected device is missing. Reconnect the USB-C headphones and detect outputs again.',
    AbortError: 'The audio device could not be switched. Reconnect it and retry.',
    NotReadableError: 'The audio device is unavailable or in use by another application.',
    NotSupportedError: 'Try the latest Chrome or Edge on desktop.'
  }[label] || '';
  return `${label}: ${detail}${advice ? ' — ' + advice : ''}`;
}

function testCueOutput() {
  if (!cueEnabled) {
    $('#cueOutputStatus').textContent = 'Enable a separate headphone output before testing.';
    return;
  }
  const tone = audioContext.createOscillator();
  const volume = audioContext.createGain();
  tone.type = 'sine';
  tone.frequency.value = 440;
  volume.gain.value = 0.035;
  tone.connect(volume);
  volume.connect(cueBus);
  tone.start();
  tone.stop(audioContext.currentTime + 0.35);
  tone.onended = () => { tone.disconnect(); volume.disconnect(); };
  $('#cueOutputStatus').textContent = 'Test tone sent to the selected headphones.';
}

async function enableCueOutput(deviceId) {
  if (!deviceId || typeof cueAudio.setSinkId !== 'function') throw new Error('This browser cannot select a separate headphone output. Try Chrome or Edge.');
  cueAudio.muted = true;
  cueEnabled = false;
  cueAudio.pause();
  await ensureAudioReady();
  await cueAudio.setSinkId(deviceId);
  cueDeviceId = deviceId;
  await cueAudio.play();
  cueAudio.muted = false;
  cueEnabled = true;
  $('#cueOutputStatus').textContent = 'Headphone monitoring enabled';
  showToast('Headphone CUE enabled');
}

function disableCueOutput() {
  cueAudio.muted = true;
  cueAudio.pause();
  cueEnabled = false;
  cueDeviceId = null;
  $('#cueOutputStatus').textContent = 'Headphone monitoring disabled';
  showToast('Headphone CUE disabled');
}


class Deck {
  constructor(id) {
    this.id = id;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.preservesPitch = false;
    this.audio.webkitPreservesPitch = false;
    this.track = null;
    this.objectUrl = null;
    this.cueTime = 0;
    this.tempoPercent = 0;
    this.jogAngle = 0;
    this.scratchVoice = null;

    this.source = audioContext.createMediaElementSource(this.audio);
    this.low = audioContext.createBiquadFilter();
    this.low.type = 'lowshelf';
    this.low.frequency.value = 320;
    this.mid = audioContext.createBiquadFilter();
    this.mid.type = 'peaking';
    this.mid.frequency.value = 1000;
    this.mid.Q.value = 0.9;
    this.high = audioContext.createBiquadFilter();
    this.high.type = 'highshelf';
    this.high.frequency.value = 3200;
    this.trimGain = audioContext.createGain();
    this.channelGain = audioContext.createGain(); // Fixed master-channel gain, independent of CUE level.
    this.cueLevelGain = audioContext.createGain(); // Deck-specific headphone volume.
    this.crossGain = audioContext.createGain();

    this.source.connect(this.low);
    this.low.connect(this.mid);
    this.mid.connect(this.high);
    this.high.connect(this.trimGain);
    // Separate headphone volume from the master path after shared EQ/trim.
    this.trimGain.connect(this.channelGain);
    this.trimGain.connect(this.cueLevelGain);
    this.cueGain = audioContext.createGain();
    this.cueGain.gain.value = 0;
    this.cueLevelGain.connect(this.cueGain);
    this.cueGain.connect(cueBus);
    cueGains[id] = this.cueGain;
    this.channelGain.connect(this.crossGain);
    this.crossGain.connect(masterGain);

    this.trimGain.gain.value = 1;
    this.channelGain.gain.value = 0.9;
    this.cueLevelGain.gain.value = 0.9;
    this.crossGain.gain.value = Math.SQRT1_2;

    this.audio.addEventListener('ended', () => {
      this.updatePlayState();
      showToast(`Deck ${this.id}: track ended`);
    });
    this.audio.addEventListener('error', () => showToast(`Deck ${this.id}: could not play this file`));
  }

  async load(track) {
    await ensureAudioReady();
    await ensureTrackDecoded(track);
    this.stopScratchGrain();
    this.pause();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(track.blob);
    this.track = track;
    this.track.hotCues = normaliseHotCues(this.track.hotCues);
    this.cueTime = track.gridOffset || 0;
    this.tempoPercent = 0;
    this.audio.src = this.objectUrl;
    this.audio.currentTime = 0;
    this.audio.playbackRate = 1;
    $(`#tempo${this.id}`).value = '0';
    this.updateTrackUi();
    drawOverview(this);
    renderTable();
  }

  async playPause() {
    if (!this.track) return showToast(`Load a track into Deck ${this.id} first`);
    await ensureAudioReady();
    if (this.audio.paused) {
      await this.audio.play();
    } else {
      this.audio.pause();
    }
    this.updatePlayState();
  }

  pause() {
    this.audio.pause();
    this.updatePlayState();
  }

  unload() {
    this.stopScratchGrain();
    this.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.track = null;
    this.cueTime = 0;
    this.updateTrackUi();
    drawOverview(this);
    drawWaveform(this);
  }

  cue() {
    if (!this.track) return;
    if (!this.audio.paused) {
      this.audio.pause();
      this.audio.currentTime = this.cueTime;
      showToast(`Deck ${this.id}: returned to cue`);
    } else if (Math.abs(this.audio.currentTime - this.cueTime) > 0.15) {
      this.cueTime = this.audio.currentTime;
      this.track.gridOffset = this.cueTime;
      dbPut(this.track).catch(console.error);
      showToast(`Deck ${this.id}: cue set at ${formatTime(this.cueTime, true)}`);
    } else {
      this.audio.currentTime = this.cueTime;
    }
    this.updatePlayState();
  }

  setTempo(percent) {
    this.tempoPercent = Number(percent);
    this.audio.playbackRate = clamp(1 + this.tempoPercent / 100, 0.5, 2);
    this.updateTempoUi();
  }

  seekTo(seconds) {
    if (!this.track) return;
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : this.track.duration || 0;
    const maximum = Math.max(0, duration - 0.01);
    const target = clamp(Number(seconds) || 0, 0, maximum);
    try {
      this.audio.currentTime = target;
    } catch (error) {
      console.warn(`Deck ${this.id}: seek unavailable until metadata is ready`, error);
    }
  }

  seekBy(seconds) {
    this.seekTo((this.audio.currentTime || 0) + Number(seconds || 0));
  }

  // Play a very short sample from the decoded track while the platter moves.
  // The HTMLAudioElement is paused during scratching, so seeking alone is silent.
  // Send the grains through the deck's existing EQ, fader, crossfader and CUE buses.
  stopScratchGrain() {
    const voice = this.scratchVoice;
    if (!voice) return;
    this.scratchVoice = null;
    const now = audioContext.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, 0.003);
    try { voice.source.stop(now + 0.012); } catch (_) { /* already ended */ }
  }

  scratchGrain(deltaSeconds, elapsedSeconds) {
    const buffer = this.track?.buffer;
    if (!buffer || buffer.length < 2 || Math.abs(deltaSeconds) < 0.0002) return;

    const rate = clamp(Math.abs(deltaSeconds) / Math.max(elapsedSeconds, 0.012), 0.2, 3);
    const playSeconds = 0.075;
    const sampleRate = buffer.sampleRate;
    const frames = Math.min(buffer.length, Math.max(256, Math.ceil(playSeconds * rate * sampleRate)));
    const frame = clamp(Math.floor((this.audio.currentTime || 0) * sampleRate), 0, buffer.length - 1);

    let sample = buffer;
    let offset = 0;
    if (deltaSeconds > 0) {
      // Scrub forwards through the source buffer.
      offset = Math.max(0, Math.min(frame - frames, buffer.length - frames)) / sampleRate;
    } else {
      // BufferSourceNode cannot play in reverse; reverse only this tiny grain.
      sample = audioContext.createBuffer(buffer.numberOfChannels, frames, sampleRate);
      const endFrame = Math.min(buffer.length, Math.max(frames, frame + frames));
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const original = buffer.getChannelData(channel);
        const reversed = sample.getChannelData(channel);
        for (let i = 0; i < frames; i++) reversed[i] = original[endFrame - 1 - i];
      }
    }

    this.stopScratchGrain();
    const now = audioContext.currentTime;
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = sample;
    source.playbackRate.value = rate;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.85, now + 0.004);
    gain.gain.setValueAtTime(0.85, now + playSeconds - 0.012);
    gain.gain.linearRampToValueAtTime(0, now + playSeconds);
    source.connect(gain);
    gain.connect(this.low);
    const voice = { source, gain };
    this.scratchVoice = voice;
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      if (this.scratchVoice === voice) this.scratchVoice = null;
    };
    source.start(now, offset, frames / sampleRate);
  }

  resetToStart() {
    if (!this.track) return showToast(`Load a track into Deck ${this.id} first`);
    this.seekTo(0);
    updateRuntimeUi(this);
    drawWaveform(this);
    showToast(`Deck ${this.id}: back to 0:00`, 1000);
  }

  async triggerHotCue(letter) {
    if (!this.track) return showToast(`Load a track into Deck ${this.id} first`);
    this.track.hotCues = normaliseHotCues(this.track.hotCues);
    const savedTime = this.track.hotCues[letter];
    const button = document.querySelector(`.hotcue-button[data-deck="${this.id}"][data-cue="${letter}"]`);

    if (!Number.isFinite(savedTime)) {
      this.track.hotCues[letter] = this.audio.currentTime || 0;
      await dbPut(this.track);
      Object.values(decks).forEach((targetDeck) => {
        if (targetDeck.track?.id === this.track.id) {
          targetDeck.updateHotCueUi();
          drawOverview(targetDeck);
        }
      });
      button?.classList.add('is-triggered');
      setTimeout(() => button?.classList.remove('is-triggered'), 180);
      showToast(`Deck ${this.id}: Hot Cue ${HOT_CUE_NUMBERS[letter]} set at ${formatTime(this.track.hotCues[letter], true)}`);
      return;
    }

    await ensureAudioReady();
    this.seekTo(savedTime);
    if (this.audio.paused || this.audio.ended) await this.audio.play();
    this.updatePlayState();
    button?.classList.add('is-triggered');
    setTimeout(() => button?.classList.remove('is-triggered'), 180);
    showToast(`Deck ${this.id}: Hot Cue ${HOT_CUE_NUMBERS[letter]}`, 900);
  }

  async removeHotCue(letter) {
    if (!this.track) return;
    this.track.hotCues = normaliseHotCues(this.track.hotCues);
    if (!Number.isFinite(this.track.hotCues[letter])) return showToast(`Hot Cue ${HOT_CUE_NUMBERS[letter]} is empty`, 900);
    delete this.track.hotCues[letter];
    await dbPut(this.track);
    Object.values(decks).forEach((targetDeck) => {
      if (targetDeck.track?.id === this.track.id) {
        targetDeck.updateHotCueUi();
        drawOverview(targetDeck);
      }
    });
    showToast(`Deck ${this.id}: Hot Cue ${HOT_CUE_NUMBERS[letter]} deleted`);
  }

  updateJogVisual() {
    const jog = $(`#jog${this.id}`);
    const ring = jog?.querySelector('.jog-ring');
    const label = jog?.querySelector('.jog-label');
    if (!jog || !ring || !label) return;
    const current = this.audio.currentTime || 0;
    this.jogAngle = ((current / JOG_SCRATCH_SECONDS_PER_REVOLUTION) * 360) % 360;
    ring.style.transform = `rotate(${this.jogAngle}deg)`;
    label.style.transform = `rotate(${-this.jogAngle}deg)`;
    jog.setAttribute('aria-valuetext', `${formatTime(current, true)} track position`);
  }

  setGridOffset(offset) {
    if (!this.track) return;
    this.track.gridOffset = Math.max(0, offset);
    this.cueTime = this.track.gridOffset;
    dbPut(this.track).catch(console.error);
  }

  syncTo(masterDeck) {
    if (!this.track || !masterDeck.track) return showToast('Load tracks into both decks before syncing');
    const masterCurrentBpm = masterDeck.track.bpm * masterDeck.audio.playbackRate;
    const targetRate = clamp(masterCurrentBpm / this.track.bpm, 0.5, 2);
    this.setTempo((targetRate - 1) * 100);
    $(`#tempo${this.id}`).value = String((targetRate - 1) * 100);

    const masterPeriod = 60 / masterDeck.track.bpm;
    const targetPeriod = 60 / this.track.bpm;
    const masterPhaseRaw = (masterDeck.audio.currentTime - (masterDeck.track.gridOffset || 0)) / masterPeriod;
    const masterPhase = ((masterPhaseRaw % 1) + 1) % 1;
    const targetBeat = Math.round((this.audio.currentTime - (this.track.gridOffset || 0)) / targetPeriod);
    const aligned = (this.track.gridOffset || 0) + (targetBeat + masterPhase) * targetPeriod;
    if (Number.isFinite(aligned)) this.audio.currentTime = clamp(aligned, 0, Math.max(0, this.audio.duration - 0.05));
    showToast(`Deck ${this.id} synced to ${masterCurrentBpm.toFixed(2)} BPM`);
  }

  updateTrackUi() {
    const fallbackBpm = this.track?.bpm || 128;
    $(`#title${this.id}`).textContent = this.track?.title || 'No track loaded';
    $(`#artist${this.id}`).textContent = this.track?.artist || 'Import music and load a track';
    $(`#key${this.id}`).textContent = this.track?.key || '--';
    $(`#bpm${this.id}`).textContent = fallbackBpm.toFixed(2);
    $(`#elapsed${this.id}`).textContent = '00:00';
    $(`#remaining${this.id}`).textContent = `−${formatTime(this.track?.duration || 0)}`;
    $(`#overviewProgress${this.id}`).style.width = '0%';
    $(`#overviewPlayhead${this.id}`).style.left = '0%';
    const seekControl = $(`#overviewSeek${this.id}`);
    seekControl.value = '0';
    seekControl.disabled = !this.track;
    seekControl.setAttribute('aria-valuetext', '00:00 elapsed');
    this.updateCoverUi();
    this.updateHotCueUi();
    this.updateTempoUi();
  }

  updateCoverUi() {
    const coverUrl = this.track ? getTrackCoverUrl(this.track) : '';
    const deckCover = $(`#cover${this.id}`);
    const deckCoverBox = deckCover?.closest('.deck-cover');
    const jogCover = $(`#jogCover${this.id}`);
    const jogLabel = jogCover?.closest('.jog-label');
    const initials = this.track ? coverInitials(this.track) : 'DD';

    if (deckCover) {
      deckCover.src = coverUrl;
      deckCover.alt = this.track ? `${this.track.title} cover` : '';
      deckCoverBox?.classList.toggle('has-cover', Boolean(this.track));
      $(`#coverFallback${this.id}`).textContent = this.id === 'A' ? '1' : '2';
    }
    if (jogCover) {
      jogCover.src = coverUrl;
      jogCover.alt = this.track ? `${this.track.title} cover` : '';
      jogLabel?.classList.toggle('has-cover', Boolean(this.track));
      $(`#jogCoverFallback${this.id}`).textContent = initials;
    }
  }

  updateHotCueUi() {
    const hotCues = normaliseHotCues(this.track?.hotCues);
    document.querySelectorAll(`.hotcue-button[data-deck="${this.id}"]`).forEach((button) => {
      const letter = button.dataset.cue;
      const time = hotCues[letter];
      const isSet = Number.isFinite(time);
      button.classList.toggle('is-set', isSet);
      // Keep pad colors consistent with their waveform markers.
      button.style.removeProperty('color');
      button.style.setProperty('--hot-cue-accent', HOT_CUE_COLORS[letter]);
      const number = HOT_CUE_NUMBERS[letter];
      const info = isSet ? `saved at ${formatTime(time, true)}` : 'empty';
      button.setAttribute('aria-label', `Deck ${this.id === 'A' ? 1 : 2} Hot Cue ${number}, ${info}`);
      button.title = `Hot Cue ${number} · ${info} · Click to set/trigger · Shift-click or right-click to delete`;
    });
  }

  updateTempoUi() {
    const bpm = this.track ? this.track.bpm * this.audio.playbackRate : 128;
    $(`#bpm${this.id}`).textContent = bpm.toFixed(2);
    $(`#pitch${this.id}`).textContent = `${this.tempoPercent >= 0 ? '+' : ''}${this.tempoPercent.toFixed(1)}%`;
  }

  updatePlayState() {
    const isPlaying = !this.audio.paused && !this.audio.ended;
    const playButton = $(`#play${this.id}`);
    playButton.textContent = isPlaying ? 'Ⅱ' : '▶';
    playButton.classList.toggle('active', isPlaying);
    playButton.setAttribute('aria-pressed', String(isPlaying));
    $(`#jog${this.id}`).classList.toggle('is-playing', isPlaying);
  }
}

const decks = { A: new Deck('A'), B: new Deck('B') };

async function ensureAudioReady() {
  if (audioContext.state !== 'running') await audioContext.resume();
}

async function ensureTrackDecoded(track) {
  if (track.buffer && track.peaks) return;
  const arrayBuffer = await track.blob.arrayBuffer();
  track.buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  track.duration = track.buffer.duration;
  track.peaks = createPeaks(track.buffer);
}

function setSelectedDeck(id) {
  const changed = state.selectedDeck !== id;
  state.selectedDeck = id;
  $$('.deck-panel').forEach((panel) => panel.classList.toggle('selected-deck', panel.dataset.deck === id));
  if (changed) showToast(`Deck ${id === 'A' ? '1' : '2'} selected`, 900);
}

function setMasterDeck(id) {
  state.masterDeck = id;
  for (const deckId of ['A', 'B']) {
    const button = $(`#master${deckId}`);
    const active = id === deckId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
state.masterDeck = 'A';

async function addFiles(fileList) {
  if (state.importing) return;
  const files = [...fileList].filter((file) => file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name));
  if (!files.length) return showToast('No supported audio files found');
  state.importing = true;
  ui.importButton.disabled = true;
  await ensureAudioReady();

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    ui.libraryStatus.textContent = `ANALYSING ${index + 1}/${files.length}`;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const metadata = readId3Metadata(arrayBuffer);
      const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const parsed = parseFilename(file.name);
      const bpm = estimateBpm(buffer);
      const track = {
        id: crypto.randomUUID(),
        title: metadata.title || parsed.title,
        artist: metadata.artist || parsed.artist,
        album: metadata.album || '',
        bpm,
        key: metadata.key || '--',
        duration: buffer.duration,
        addedAt: Date.now() + index,
        filename: file.name,
        gridOffset: 0,
        hotCues: {},
        coverBlob: metadata.coverBlob || null,
        blob: file,
        buffer,
        peaks: createPeaks(buffer),
      };
      state.tracks.push(track);
      await dbPut(track);
      renderTable();
    } catch (error) {
      console.error(error);
      showToast(`Could not import ${file.name}`);
    }
  }

  state.importing = false;
  ui.importButton.disabled = false;
  updateLibraryStats();
  await updateStorageUi();
  showToast(`${files.length} track${files.length === 1 ? '' : 's'} imported`);
}

async function addDemoTracks() {
  const demos = [
    { url: 'assets/demo-a.wav', filename: 'Neon District - Signal Run.wav', title: 'Signal Run', artist: 'Neon District', bpm: 128, key: '8A' },
    { url: 'assets/demo-b.wav', filename: 'Static Theory - After Dark.wav', title: 'After Dark', artist: 'Static Theory', bpm: 124, key: '4A' },
  ];
  const existingNames = new Set(state.tracks.map((track) => track.filename));
  let added = 0;
  await ensureAudioReady();

  for (const demo of demos) {
    if (existingNames.has(demo.filename)) continue;
    try {
      const response = await fetch(demo.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const file = new File([blob], demo.filename, { type: 'audio/wav' });
      const buffer = await audioContext.decodeAudioData((await blob.arrayBuffer()).slice(0));
      const track = {
        id: crypto.randomUUID(),
        title: demo.title,
        artist: demo.artist,
        bpm: demo.bpm,
        key: demo.key,
        duration: buffer.duration,
        addedAt: Date.now() + added,
        filename: demo.filename,
        gridOffset: 0,
        hotCues: {},
        album: 'Padawan DJ Demos',
        coverBlob: null,
        blob: file,
        buffer,
        peaks: createPeaks(buffer),
      };
      state.tracks.push(track);
      await dbPut(track);
      added += 1;
    } catch (error) {
      console.error(error);
      showToast('Demo tracks require the included local web server');
      return;
    }
  }
  renderTable();
  await updateStorageUi();
  if (added) showToast('Demo tracks added to Collection');
  else showToast('Demo tracks are already in Collection');
}

async function loadTrackToDeck(trackId, deckId) {
  const track = state.tracks.find((item) => item.id === trackId);
  if (!track) return;
  setSelectedDeck(deckId);
  showToast(`Loading ${track.title} into Deck ${deckId === 'A' ? '1' : '2'}…`, 1000);
  try {
    await decks[deckId].load(track);
    state.history = [track.id, ...state.history.filter((id) => id !== track.id)].slice(0, 100);
    localStorage.setItem('dualDeckHistory', JSON.stringify(state.history));
    showToast(`${track.title} loaded into Deck ${deckId === 'A' ? '1' : '2'}`);
  } catch (error) {
    console.error(error);
    showToast('This audio file could not be decoded');
  }
}

function getVisibleTracks() {
  let tracks = [...state.tracks];
  if (state.source.startsWith('playlist:')) {
    const playlistId = state.source.split(':')[1];
    const playlist = state.playlists.find((item) => item.id === playlistId);
    const order = new Map((playlist?.trackIds || []).map((id, index) => [id, index]));
    tracks = tracks.filter((track) => order.has(track.id)).sort((a, b) => order.get(a.id) - order.get(b.id));
  }
  if (state.source === 'recent') tracks.sort((a, b) => b.addedAt - a.addedAt);
  if (state.source === 'history') {
    const order = new Map(state.history.map((id, index) => [id, index]));
    tracks = tracks.filter((track) => order.has(track.id)).sort((a, b) => order.get(a.id) - order.get(b.id));
  }
  const query = state.search.trim().toLowerCase();
  if (query) tracks = tracks.filter((track) => `${track.title} ${track.artist} ${track.bpm} ${track.key}`.toLowerCase().includes(query));

  if (state.source === 'collection') {
    const direction = state.sort.direction === 'asc' ? 1 : -1;
    const field = state.sort.field;
    tracks.sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction;
      return String(av ?? '').localeCompare(String(bv ?? '')) * direction;
    });
  }
  return tracks;
}

function savePlaylists() {
  localStorage.setItem('dualDeckPlaylists', JSON.stringify(state.playlists));
}

function renderPlaylistList() {
  const container = $('#playlistList');
  container.innerHTML = '';
  for (const playlist of state.playlists) {
    const row = document.createElement('div');
    row.className = 'playlist-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'playlist-select';
    button.dataset.playlist = playlist.id;
    button.innerHTML = `<span>♪</span>${escapeHtml(playlist.name)} <small>${playlist.trackIds.length}</small>`;
    button.classList.toggle('active', state.source === `playlist:${playlist.id}`);
    button.addEventListener('click', () => {
      state.source = `playlist:${playlist.id}`;
      ui.browserHeading.textContent = playlist.name;
      $$('.source-item').forEach((item) => item.classList.remove('active'));
      renderPlaylistList();
      renderTable();
    });
    button.addEventListener('dragover', (event) => {
      event.preventDefault();
      button.classList.add('drop-target');
    });
    button.addEventListener('dragleave', () => button.classList.remove('drop-target'));
    button.addEventListener('drop', (event) => {
      event.preventDefault();
      button.classList.remove('drop-target');
      const trackId = event.dataTransfer.getData('text/track-id');
      if (!trackId || playlist.trackIds.includes(trackId)) return;
      playlist.trackIds.push(trackId);
      savePlaylists();
      renderPlaylistList();
      showToast(`Track added to ${playlist.name}`);
    });
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'playlist-remove';
    removeButton.setAttribute('aria-label', `Remove playlist ${playlist.name}`);
    removeButton.title = `Remove ${playlist.name}`;
    removeButton.textContent = '×';
    removeButton.addEventListener('click', async () => {
      const confirmed = await requestDialog({ title: 'Remove playlist?', message: `“${playlist.name}” will be removed. Its tracks will stay in your Collection.`, code: 'PLAYLIST CONTROL', confirmText: 'REMOVE PLAYLIST', danger: true });
      if (!confirmed) return;
      state.playlists = state.playlists.filter((item) => item.id !== playlist.id);
      if (state.source === `playlist:${playlist.id}`) {
        state.source = 'collection';
        ui.browserHeading.textContent = 'Collection';
        $$('.source-item').forEach((item) => item.classList.toggle('active', item.dataset.source === 'collection'));
      }
      savePlaylists();
      renderPlaylistList();
      renderTable();
      showToast(`${playlist.name} removed`);
    });
    row.append(button, removeButton);
    container.appendChild(row);
  }
}

function renderTable() {
  const tracks = getVisibleTracks();
  const rows = tracks.map((track) => {
    const classes = [
      state.selectedTrackId === track.id ? 'selected' : '',
      decks.A.track?.id === track.id ? 'loaded-a' : '',
      decks.B.track?.id === track.id ? 'loaded-b' : '',
    ].filter(Boolean).join(' ');
    const deckBadges = `${decks.A.track?.id === track.id ? '<span class="deck-load-badge deck-1">1</span>' : ''}${decks.B.track?.id === track.id ? '<span class="deck-load-badge deck-2">2</span>' : ''}`;
    const coverUrl = getTrackCoverUrl(track);
    return `
      <tr data-id="${track.id}" class="${classes}" draggable="true">
        <td><div class="load-buttons"><button data-load="A" title="Load Deck 1" aria-label="Load ${escapeHtml(track.title)} on Deck 1">1</button><button data-load="B" title="Load Deck 2" aria-label="Load ${escapeHtml(track.title)} on Deck 2">2</button><button class="track-remove" data-remove-track type="button" title="Remove from library" aria-label="Remove ${escapeHtml(track.title)} from library"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4.5h9M6 4.5v-2h4v2m1.5 0-.5 9h-6l-.5-9M6.5 7v4m3-4v4"/></svg></button></div></td>
        <td title="${escapeHtml(track.title)}"><div class="track-title-cell">${deckBadges}<img src="${escapeHtml(coverUrl)}" alt=""><span class="track-title-text">${escapeHtml(track.title)}</span></div></td>
        <td title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</td>
        <td class="numeric editable" data-field="bpm" title="Double-click to edit BPM">${Number(track.bpm).toFixed(1)}</td>
        <td class="editable" data-field="key" title="Double-click to edit key">${escapeHtml(track.key || '--')}</td>
        <td class="numeric">${formatTime(track.duration)}</td>
        <td>${formatDate(track.addedAt)}</td>
      </tr>`;
  }).join('');

  ui.trackTableBody.innerHTML = rows || '<tr class="empty-state"><td colspan="7">No tracks match this view.</td></tr>';
  updateLibraryStats(tracks);
}

async function removeTrack(trackId) {
  const track = state.tracks.find((item) => item.id === trackId);
  if (!track) return;
  const confirmed = await requestDialog({
    title: 'Remove track?',
    message: `“${track.title}” will be removed from this browser, including its Hot Cues and playlist placements.`,
    code: 'LIBRARY',
    confirmText: 'REMOVE TRACK',
    danger: true,
  });
  if (!confirmed) return;

  Object.values(decks).forEach((deck) => {
    if (deck.track?.id === trackId) deck.unload();
  });
  if (track.coverUrl?.startsWith('blob:')) URL.revokeObjectURL(track.coverUrl);
  state.tracks = state.tracks.filter((item) => item.id !== trackId);
  state.history = state.history.filter((id) => id !== trackId);
  state.playlists.forEach((playlist) => { playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId); });
  if (state.selectedTrackId === trackId) state.selectedTrackId = null;
  localStorage.setItem('dualDeckHistory', JSON.stringify(state.history));
  savePlaylists();
  await dbDelete(trackId);
  renderPlaylistList();
  renderTable();
  await updateStorageUi();
  showToast(`${track.title} removed from Collection`);
}

function updateLibraryStats(visibleTracks = getVisibleTracks()) {
  const total = visibleTracks.reduce((sum, track) => sum + (track.duration || 0), 0);
  ui.libraryStatus.textContent = `${state.tracks.length} TRACK${state.tracks.length === 1 ? '' : 'S'}`;
  ui.browserCount.textContent = `${visibleTracks.length} track${visibleTracks.length === 1 ? '' : 's'}`;
  ui.totalDuration.textContent = `${formatTime(total)} total`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function canvasSize(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, ratio };
}

// Draw a continuous, antialiased envelope instead of stair-stepped columns.
// Interpolate when zoomed in; preserve the loudest peak in each pixel when zoomed out.
function drawWaveformEnvelope(ctx, peaks, duration, startTime, endTime, width, height, ratio, deckId) {
  const points = [];
  const columns = Math.ceil(width / ratio);
  const peakAt = (position) => {
    const index = clamp(position, 0, peaks.length - 1);
    const left = Math.floor(index);
    return peaks[left] + (peaks[Math.min(left + 1, peaks.length - 1)] - peaks[left]) * (index - left);
  };
  const timePerColumn = (endTime - startTime) / columns;
  for (let column = 0; column <= columns; column += 1) {
    const time = startTime + column * timePerColumn;
    if (time < 0 || time > duration) continue;
    const position = time / duration * (peaks.length - 1);
    const halfBin = timePerColumn / duration * (peaks.length - 1) / 2;
    let amplitude = peakAt(position);
    if (halfBin > 0.5) {
      for (let index = Math.max(0, Math.ceil(position - halfBin)); index <= Math.min(peaks.length - 1, Math.floor(position + halfBin)); index += 1) {
        amplitude = Math.max(amplitude, peaks[index]);
      }
    }
    points.push({ x: column / columns * width, h: amplitude * height * 0.44 });
  }
  if (points.length < 2) return;
  const center = height / 2;
  const outline = points.map((point) => ({ x: point.x, y: center - point.h }));
  for (let index = points.length - 1; index >= 0; index -= 1) {
    outline.push({ x: points[index].x, y: center + points[index].h });
  }
  ctx.beginPath();
  ctx.moveTo(outline[0].x, outline[0].y);
  for (let index = 1; index < outline.length - 1; index += 1) {
    const point = outline[index];
    const next = outline[index + 1];
    ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
  }
  const last = outline[outline.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.closePath();
  const cyan = deckId === 'A';
  const fill = ctx.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, cyan ? '#168bbd' : '#a91b66');
  fill.addColorStop(0.32, cyan ? '#16c8ff' : '#f73597');
  fill.addColorStop(0.5, cyan ? '#a1edff' : '#ffb0dc');
  fill.addColorStop(0.68, cyan ? '#16c8ff' : '#f73597');
  fill.addColorStop(1, cyan ? '#168bbd' : '#a91b66');
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawWaveform(deck) {
  const canvas = $(`#waveform${deck.id}`);
  const ctx = canvas.getContext('2d');
  const { width, height, ratio } = canvasSize(canvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, width, height);

  const centerY = height / 2;
  ctx.strokeStyle = '#202733';
  ctx.lineWidth = ratio;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();

  const track = deck.track;
  if (!track?.peaks) {
    ctx.fillStyle = '#8193a5';
    ctx.font = `500 ${10 * ratio}px "SFMono-Regular", Consolas, "Liberation Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`DECK ${deck.id === 'A' ? '1' : '2'} — LOAD TRACK`, width / 2, centerY + 3 * ratio);
    for (let x = 0; x < width; x += 80 * ratio) {
      ctx.fillStyle = '#151b23';
      ctx.fillRect(x, 0, ratio, height);
    }
    return;
  }

  const current = deck.audio.currentTime || 0;
  const halfWindow = state.waveformWindowSeconds / 2;
  const startTime = current - halfWindow;
  const endTime = current + halfWindow;
  const period = 60 / track.bpm;
  const firstBeat = Math.floor((startTime - (track.gridOffset || 0)) / period);
  const lastBeat = Math.ceil((endTime - (track.gridOffset || 0)) / period);

  for (let beat = firstBeat; beat <= lastBeat; beat += 1) {
    const beatTime = (track.gridOffset || 0) + beat * period;
    const x = ((beatTime - startTime) / (endTime - startTime)) * width;
    const isBar = ((beat % 4) + 4) % 4 === 0;
    ctx.fillStyle = isBar ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.09)';
    ctx.fillRect(Math.round(x), 0, isBar ? 1.4 * ratio : 0.7 * ratio, height);
    if (isBar) {
      ctx.fillStyle = deck.id === 'A' ? '#70e0ff' : '#ff77bd';
      ctx.font = `${7 * ratio}px ui-monospace`;
      ctx.fillText(String(Math.floor(beat / 4) + 1), x + 3 * ratio, 9 * ratio);
    }
  }

  drawWaveformEnvelope(ctx, track.peaks, track.duration || 1, startTime, endTime, width, height, ratio, deck.id);

  for (const [letter, cueTime] of Object.entries(normaliseHotCues(track.hotCues))) {
    if (cueTime < startTime || cueTime > endTime) continue;
    const x = ((cueTime - startTime) / (endTime - startTime)) * width;
    ctx.fillStyle = HOT_CUE_COLORS[letter];
    ctx.globalAlpha = 0.95;
    ctx.fillRect(Math.round(x - ratio), 0, Math.max(2 * ratio, 2), height);
    ctx.beginPath();
    ctx.moveTo(x - 5 * ratio, 0);
    ctx.lineTo(x + 5 * ratio, 0);
    ctx.lineTo(x, 7 * ratio);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#071018';
    ctx.font = `bold ${6 * ratio}px ui-sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(letter, x, 5.6 * ratio);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';

  if (current > track.duration) deck.audio.currentTime = track.duration;
}

function drawOverview(deck) {
  const canvas = $(`#overview${deck.id}`);
  const ctx = canvas.getContext('2d');
  const { width, height, ratio } = canvasSize(canvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#000204';
  ctx.fillRect(0, 0, width, height);
  if (!deck.track?.peaks) return;
  drawWaveformEnvelope(ctx, deck.track.peaks, deck.track.duration || 1, 0, deck.track.duration || 1, width, height, ratio, deck.id);

  const duration = deck.track.duration || 1;
  for (const [letter, cueTime] of Object.entries(normaliseHotCues(deck.track.hotCues))) {
    const x = clamp((cueTime / duration) * width, 0, width);
    ctx.fillStyle = HOT_CUE_COLORS[letter];
    ctx.fillRect(Math.round(x), 0, Math.max(2, window.devicePixelRatio || 1), height);
    ctx.beginPath();
    ctx.moveTo(x - 4, 0);
    ctx.lineTo(x + 4, 0);
    ctx.lineTo(x, 6);
    ctx.closePath();
    ctx.fill();
  }
}

function updateRuntimeUi(deck) {
  const duration = Number.isFinite(deck.audio.duration) ? deck.audio.duration : deck.track?.duration || 0;
  const current = deck.audio.currentTime || 0;
  const progress = duration ? clamp(current / duration, 0, 1) : 0;
  $(`#elapsed${deck.id}`).textContent = formatTime(current);
  $(`#remaining${deck.id}`).textContent = `−${formatTime(Math.max(0, duration - current))}`;
  $(`#overviewProgress${deck.id}`).style.width = `${progress * 100}%`;
  $(`#overviewPlayhead${deck.id}`).style.left = `${progress * 100}%`;
  const seekControl = $(`#overviewSeek${deck.id}`);
  seekControl.value = String(Math.round(progress * 1000));
  seekControl.disabled = !deck.track;
  seekControl.setAttribute('aria-valuetext', `${formatTime(current)} elapsed, ${formatTime(Math.max(0, duration - current))} remaining`);
  deck.updateJogVisual();
}

function updateMeter() {
  const data = new Uint8Array(masterAnalyser.frequencyBinCount);
  masterAnalyser.getByteFrequencyData(data);
  let average = 0;
  for (let i = 0; i < data.length; i += 1) average += data[i];
  average /= data.length || 1;
  const active = Math.round((average / 255) * ui.levelBars.length * 1.8);
  ui.levelBars.forEach((bar, index) => {
    bar.classList.toggle('is-lit', index < active);
  });
}

let lastWaveDraw = 0;
function animationLoop(timestamp) {
  updateRuntimeUi(decks.A);
  updateRuntimeUi(decks.B);
  if (timestamp - lastWaveDraw > 30) {
    drawWaveform(decks.A);
    drawWaveform(decks.B);
    lastWaveDraw = timestamp;
  }
  updateMeter();
  requestAnimationFrame(animationLoop);
}

function applyCrossfader(value) {
  const x = (Number(value) + 1) / 2;
  const gainA = Math.cos(x * 0.5 * Math.PI);
  const gainB = Math.cos((1 - x) * 0.5 * Math.PI);
  decks.A.crossGain.gain.setTargetAtTime(gainA, audioContext.currentTime, 0.01);
  decks.B.crossGain.gain.setTargetAtTime(gainB, audioContext.currentTime, 0.01);
}

function pointerPositionOnJog(event, jog) {
  const rect = jog.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = event.clientX - centerX;
  const dy = event.clientY - centerY;
  return {
    angle: Math.atan2(dy, dx),
    radiusRatio: Math.hypot(dx, dy) / (rect.width / 2),
  };
}

function normaliseAngleDelta(delta) {
  if (delta > Math.PI) return delta - TAU;
  if (delta < -Math.PI) return delta + TAU;
  return delta;
}

function bindJogControls(deck) {
  const jog = $(`#jog${deck.id}`);
  const interaction = {
    active: false,
    pointerId: null,
    mode: null,
    lastAngle: 0,
    lastX: 0,
    centreScrub: false,
    lastMoveTime: 0,
    wasPlaying: false,
  };

  const finishInteraction = (event) => {
    if (!interaction.active) return;
    if (event?.pointerId !== undefined && event.pointerId !== interaction.pointerId) return;
    const pointerId = interaction.pointerId;
    const shouldResume = interaction.mode === 'scratch' && interaction.wasPlaying && deck.track;
    deck.stopScratchGrain();
    interaction.active = false;
    interaction.pointerId = null;
    jog.classList.remove('dragging', 'scratching', 'nudging');
    if (jog.hasPointerCapture?.(pointerId)) jog.releasePointerCapture(pointerId);
    if (shouldResume) {
      deck.audio.play().catch((error) => {
        console.error(error);
        showToast(`Deck ${deck.id}: press Play to resume`);
      }).finally(() => deck.updatePlayState());
    } else {
      deck.updatePlayState();
    }
  };

  jog.addEventListener('pointerdown', (event) => {
    if (interaction.active || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (!deck.track) return showToast(`Load a track into Deck ${deck.id} first`);
    event.preventDefault();
    ensureAudioReady().catch(console.error);
    setSelectedDeck(deck.id);

    const position = pointerPositionOnJog(event, jog);
    interaction.active = true;
    interaction.pointerId = event.pointerId;
    interaction.lastAngle = position.angle;
    interaction.lastX = event.clientX;
    interaction.centreScrub = position.radiusRatio <= JOG_CENTER_RADIUS_RATIO;
    interaction.lastMoveTime = performance.now();
    interaction.mode = position.radiusRatio <= JOG_SCRATCH_RADIUS_RATIO ? 'scratch' : 'nudge';
    interaction.wasPlaying = !deck.audio.paused && !deck.audio.ended;

    if (jog.setPointerCapture) jog.setPointerCapture(event.pointerId);
    jog.classList.add('dragging', interaction.mode === 'scratch' ? 'scratching' : 'nudging');

    // Touching the platter stops it, just like vinyl mode on a controller.
    // Releasing it resumes playback if it was already running.
    if (interaction.mode === 'scratch' && interaction.wasPlaying) {
      deck.audio.pause();
      deck.updatePlayState();
    }
  });

  jog.addEventListener('pointermove', (event) => {
    if (!interaction.active || event.pointerId !== interaction.pointerId) return;
    event.preventDefault();
    const position = pointerPositionOnJog(event, jog);
    let delta = normaliseAngleDelta(position.angle - interaction.lastAngle);
    const deltaX = event.clientX - interaction.lastX;
    interaction.lastAngle = position.angle;
    interaction.lastX = event.clientX;
    if (event.shiftKey) delta *= 0.25;

    const secondsPerRevolution = interaction.mode === 'scratch'
      ? JOG_SCRATCH_SECONDS_PER_REVOLUTION
      : JOG_NUDGE_SECONDS_PER_REVOLUTION;
    // Small offsets near the spindle can cause wild angular jumps.
    const seconds = interaction.mode === 'scratch' && interaction.centreScrub
      ? (deltaX / jog.getBoundingClientRect().width) * secondsPerRevolution * (event.shiftKey ? 0.25 : 1)
      : (delta / TAU) * secondsPerRevolution;
    const now = performance.now();
    const elapsed = (now - interaction.lastMoveTime) / 1000;
    interaction.lastMoveTime = now;
    deck.seekBy(seconds);
    if (interaction.mode === 'scratch') deck.scratchGrain(seconds, elapsed);
    deck.updateJogVisual();
  });

  jog.addEventListener('pointerup', finishInteraction);
  jog.addEventListener('pointercancel', finishInteraction);
  jog.addEventListener('lostpointercapture', finishInteraction);
  jog.addEventListener('contextmenu', (event) => event.preventDefault());
  // Native image drag must not steal the pointer while scratching.
  jog.addEventListener('dragstart', (event) => event.preventDefault());

  jog.addEventListener('wheel', (event) => {
    if (!deck.track) return;
    event.preventDefault();
    setSelectedDeck(deck.id);
    const direction = event.deltaY > 0 ? 1 : -1;
    deck.seekBy(direction * (event.shiftKey ? 0.02 : 0.08));
    deck.updateJogVisual();
  }, { passive: false });
}

function bindJogDrop(deck) {
  const jog = `#jog${deck.id}`;
  const target = $(jog);
  const panel = target.closest('.deck-panel');
  const hasTrackData = (event) => {
    const types = Array.from(event.dataTransfer?.types || []);
    return types.includes('text/track-id') || (types.includes('text/plain') && !types.includes('Files'));
  };
  const clear = () => panel.classList.remove('track-drop-target');

  // Accept a track dropped anywhere over the deck, not only a small jog element.
  panel.addEventListener('dragenter', (event) => {
    if (!hasTrackData(event)) return;
    event.preventDefault();
    panel.classList.add('track-drop-target');
  });
  panel.addEventListener('dragover', (event) => {
    if (!hasTrackData(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    panel.classList.add('track-drop-target');
  });
  panel.addEventListener('dragleave', (event) => {
    if (event.relatedTarget && panel.contains(event.relatedTarget)) return;
    clear();
  });
  panel.addEventListener('drop', (event) => {
    if (!hasTrackData(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const trackId = event.dataTransfer.getData('text/track-id') || event.dataTransfer.getData('text/plain');
    clear();
    if (state.tracks.some((track) => track.id === trackId)) {
      loadTrackToDeck(trackId, deck.id).catch(console.error);
    }
  });
}

function bindWaveformControls(deck) {
  const canvas = $(`#waveform${deck.id}`);
  const row = canvas.closest('.waveform-row');
  const interaction = {
    active: false,
    pointerId: null,
    startX: 0,
    lastX: 0,
    startTime: 0,
    moved: false,
    pausedForScrub: false,
    wasPlaying: false,
  };

  const finish = (event) => {
    if (!interaction.active || (event.pointerId != null && event.pointerId !== interaction.pointerId)) return;
    const rect = canvas.getBoundingClientRect();

    if (!interaction.moved && deck.track) {
      const x = clamp((event.clientX ?? interaction.startX) - rect.left, 0, rect.width);
      const offset = (x / rect.width - 0.5) * state.waveformWindowSeconds;
      deck.seekTo(interaction.startTime + offset);
      showToast(`Deck ${deck.id}: jumped to ${formatTime(deck.audio.currentTime, true)}`, 1100);
    }

    if (interaction.pausedForScrub && interaction.wasPlaying && deck.track) {
      deck.audio.play().then(() => deck.updatePlayState()).catch(console.error);
    }

    interaction.active = false;
    interaction.pointerId = null;
    interaction.pausedForScrub = false;
    row.classList.remove('scrubbing');
    try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
  };

  canvas.addEventListener('pointerdown', (event) => {
    if (!deck.track || event.button !== 0) return;
    event.preventDefault();
    setSelectedDeck(deck.id);
    interaction.active = true;
    interaction.pointerId = event.pointerId;
    interaction.startX = event.clientX;
    interaction.lastX = event.clientX;
    interaction.startTime = deck.audio.currentTime || 0;
    interaction.moved = false;
    interaction.pausedForScrub = false;
    interaction.wasPlaying = !deck.audio.paused && !deck.audio.ended;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!interaction.active || event.pointerId !== interaction.pointerId || !deck.track) return;
    event.preventDefault();
    const totalMovement = Math.abs(event.clientX - interaction.startX);
    if (!interaction.moved && totalMovement < 3) return;

    if (!interaction.moved) {
      interaction.moved = true;
      row.classList.add('scrubbing');
      if (interaction.wasPlaying) {
        deck.audio.pause();
        interaction.pausedForScrub = true;
      }
    }

    const rect = canvas.getBoundingClientRect();
    let deltaX = event.clientX - interaction.lastX;
    interaction.lastX = event.clientX;
    if (event.shiftKey) deltaX *= 0.25;

    // Pulling the waveform to the right moves earlier audio under the fixed playhead.
    deck.seekBy(-(deltaX / rect.width) * state.waveformWindowSeconds);
    updateRuntimeUi(deck);
    drawWaveform(deck);
  });

  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('lostpointercapture', finish);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  canvas.addEventListener('keydown', (event) => {
    if (!deck.track) return;
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      event.preventDefault();
      const direction = event.code === 'ArrowRight' ? 1 : -1;
      deck.seekBy(direction * (event.shiftKey ? 0.1 : 1));
    }
  });
}

function bindOverviewControls(deck) {
  const seekControl = $(`#overviewSeek${deck.id}`);
  seekControl.addEventListener('input', (event) => {
    if (!deck.track) return;
    const duration = Number.isFinite(deck.audio.duration) ? deck.audio.duration : deck.track.duration || 0;
    setSelectedDeck(deck.id);
    deck.seekTo((Number(event.target.value) / 1000) * duration);
    updateRuntimeUi(deck);
    drawWaveform(deck);
  });
  const canvas = $(`#overview${deck.id}`);
  const strip = canvas.closest('.overview-strip');
  const interaction = { active: false, pointerId: null, startX: 0, moved: false, wasPlaying: false, pausedForScrub: false };

  const seekFromPointer = (event) => {
    if (!deck.track) return;
    const rect = canvas.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const duration = Number.isFinite(deck.audio.duration) ? deck.audio.duration : deck.track.duration || 0;
    deck.seekTo((x / rect.width) * duration);
    updateRuntimeUi(deck);
    drawWaveform(deck);
  };

  const finish = (event) => {
    if (!interaction.active || (event.pointerId != null && event.pointerId !== interaction.pointerId)) return;
    if (interaction.pausedForScrub && interaction.wasPlaying && deck.track) {
      deck.audio.play().then(() => deck.updatePlayState()).catch(console.error);
    }
    if (!interaction.moved && deck.track) showToast(`Deck ${deck.id}: jumped to ${formatTime(deck.audio.currentTime, true)}`, 900);
    interaction.active = false;
    interaction.pointerId = null;
    interaction.pausedForScrub = false;
    strip.classList.remove('scrubbing');
    try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
  };

  canvas.addEventListener('pointerdown', (event) => {
    if (!deck.track || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    setSelectedDeck(deck.id);
    interaction.active = true;
    interaction.pointerId = event.pointerId;
    interaction.startX = event.clientX;
    interaction.moved = false;
    interaction.wasPlaying = !deck.audio.paused && !deck.audio.ended;
    interaction.pausedForScrub = false;
    canvas.setPointerCapture(event.pointerId);
    seekFromPointer(event);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!interaction.active || event.pointerId !== interaction.pointerId || !deck.track) return;
    event.preventDefault();
    if (!interaction.moved && Math.abs(event.clientX - interaction.startX) >= 3) {
      interaction.moved = true;
      strip.classList.add('scrubbing');
      if (interaction.wasPlaying) {
        deck.audio.pause();
        interaction.pausedForScrub = true;
      }
    }
    if (interaction.moved) seekFromPointer(event);
  });

  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('lostpointercapture', finish);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('keydown', (event) => {
    if (!deck.track) return;
    if (event.code === 'Home') { event.preventDefault(); deck.resetToStart(); }
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      event.preventDefault();
      deck.seekBy((event.code === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1 : 5));
    }
  });
}

function setWaveformZoom(seconds) {
  state.waveformWindowSeconds = clamp(Number(seconds) || DEFAULT_WAVEFORM_WINDOW_SECONDS, 8, 180);
  $('#waveZoomLabel').textContent = `${Math.round(state.waveformWindowSeconds)}s`;
  $$('.waveform-ruler-marks span').forEach((mark, index, marks) => {
    const fraction = index / (marks.length - 1);
    const seconds = (fraction - 0.5) * state.waveformWindowSeconds;
    const label = Number(Math.abs(seconds).toFixed(1));
    mark.textContent = seconds < 0 ? `−${label}` : seconds > 0 ? `+${label}` : '0';
    mark.style.left = `${fraction * 100}%`;
  });
  drawWaveform(decks.A);
  drawWaveform(decks.B);
}

// Hardware-style EQ dials use the existing range inputs and Web Audio listeners.
// Vertical pointer dragging adjusts values; keyboard arrows work on the focused input.
function bindEqDials(deckId) {
  for (const name of ['trim', 'high', 'mid', 'low']) {
    const input = $(`#${name}${deckId}`);
    const unit = input.closest('.eq-knob-unit');
    const face = unit.querySelector('.eq-knob-face');
    const minimum = Number(input.min);
    const maximum = Number(input.max);
    const step = Number(input.step) || 1;
    const refreshDial = () => {
      const fraction = clamp((Number(input.value) - minimum) / (maximum - minimum), 0, 1);
      face.style.setProperty('--dial-angle', `${-135 + 270 * fraction}deg`);
      unit.setAttribute('data-value', String(input.value));
    };
    input.addEventListener('input', refreshDial);
    refreshDial();

    let drag = null;
    unit.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      input.focus({ preventScroll: true });
      drag = { id: event.pointerId, startY: event.clientY, startValue: Number(input.value) };
      unit.setPointerCapture(event.pointerId);
      unit.classList.add('adjusting');
    });
    unit.addEventListener('pointermove', (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      event.preventDefault();
      const sensitivity = event.shiftKey ? 460 : 170;
      const raw = drag.startValue + (drag.startY - event.clientY) * (maximum - minimum) / sensitivity;
      const snapped = Math.round((clamp(raw, minimum, maximum) - minimum) / step) * step + minimum;
      const next = String(Number(clamp(snapped, minimum, maximum).toFixed(3)));
      if (input.value !== next) {
        input.value = next;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    const endDrag = (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      drag = null;
      unit.classList.remove('adjusting');
      if (unit.hasPointerCapture(event.pointerId)) unit.releasePointerCapture(event.pointerId);
    };
    unit.addEventListener('pointerup', endDrag);
    unit.addEventListener('pointercancel', endDrag);
    unit.addEventListener('lostpointercapture', endDrag);
    unit.addEventListener('dblclick', (event) => {
      event.preventDefault();
      input.value = input.defaultValue;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

function bindDeckControls(deck) {
  bindEqDials(deck.id);
  bindJogControls(deck);
  bindJogDrop(deck);
  bindWaveformControls(deck);
  bindOverviewControls(deck);
  $(`#play${deck.id}`).addEventListener('click', () => deck.playPause().catch(console.error));
  $(`#cue${deck.id}`).addEventListener('click', () => deck.cue());
  $(`#start${deck.id}`).addEventListener('click', () => deck.resetToStart());
  document.querySelectorAll(`.hotcue-button[data-deck="${deck.id}"]`).forEach((button) => {
    button.addEventListener('click', (event) => {
      if (event.shiftKey) deck.removeHotCue(button.dataset.cue).catch(console.error);
      else deck.triggerHotCue(button.dataset.cue).catch(console.error);
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      deck.removeHotCue(button.dataset.cue).catch(console.error);
    });
  });
  $(`#tempo${deck.id}`).addEventListener('input', (event) => deck.setTempo(event.target.value));
  $(`#sync${deck.id}`).addEventListener('click', () => deck.syncTo(decks[state.masterDeck]));
  $(`#cueLevel${deck.id}`).addEventListener('input', (event) => deck.cueLevelGain.gain.setTargetAtTime(Number(event.target.value), audioContext.currentTime, 0.01));
  $(`#trim${deck.id}`).addEventListener('input', (event) => deck.trimGain.gain.setTargetAtTime(Number(event.target.value), audioContext.currentTime, 0.01));
  $(`#high${deck.id}`).addEventListener('input', (event) => deck.high.gain.setTargetAtTime(Number(event.target.value), audioContext.currentTime, 0.01));
  $(`#mid${deck.id}`).addEventListener('input', (event) => deck.mid.gain.setTargetAtTime(Number(event.target.value), audioContext.currentTime, 0.01));
  $(`#low${deck.id}`).addEventListener('input', (event) => deck.low.gain.setTargetAtTime(Number(event.target.value), audioContext.currentTime, 0.01));
  $(`.deck-${deck.id.toLowerCase()}`).addEventListener('pointerdown', () => setSelectedDeck(deck.id));
}

async function updateStorageUi() {
  const libraryBytes = localLibraryBytes();
  let usage = libraryBytes;
  let quota = 0;
  let persisted = false;

  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      usage = estimate.usage || libraryBytes;
      quota = estimate.quota || 0;
    }
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
  } catch (error) {
    console.warn('Storage information unavailable', error);
  }

  if (ui.storageCompact) ui.storageCompact.textContent = formatBytes(libraryBytes);
  if (ui.storageTrackCount) ui.storageTrackCount.textContent = String(state.tracks.length);
  if (ui.storageLibrarySize) ui.storageLibrarySize.textContent = formatBytes(libraryBytes);
  if (ui.storageUsed) ui.storageUsed.textContent = formatBytes(usage);
  if (ui.storageQuota) ui.storageQuota.textContent = quota ? formatBytes(quota) : 'Unknown';
  if (ui.storageMeterFill) ui.storageMeterFill.style.width = quota ? `${Math.min(100, (usage / quota) * 100)}%` : '0%';
  if (ui.storageOrigin) ui.storageOrigin.textContent = location.origin === 'null' ? 'Local file' : location.origin;

  if (ui.persistentStatus) {
    ui.persistentStatus.textContent = persisted ? 'ENABLED' : navigator.storage?.persist ? 'NOT ENABLED' : 'UNAVAILABLE';
    ui.persistentStatus.classList.toggle('good', persisted);
    ui.persistentStatus.classList.toggle('warn', !persisted);
  }
  if (ui.requestPersistenceButton) {
    ui.requestPersistenceButton.disabled = persisted || !navigator.storage?.persist || !window.isSecureContext;
    ui.requestPersistenceButton.textContent = persisted
      ? 'PERSISTENT STORAGE ENABLED'
      : window.isSecureContext
        ? 'REQUEST PERSISTENT STORAGE'
        : 'HTTPS REQUIRED FOR PERSISTENCE';
  }
  if (ui.offlineStatus) {
    const ready = state.serviceWorkerReady;
    ui.offlineStatus.textContent = ready ? 'READY' : ('serviceWorker' in navigator ? 'INSTALLING' : 'UNAVAILABLE');
    ui.offlineStatus.classList.toggle('good', ready);
    ui.offlineStatus.classList.toggle('warn', !ready);
  }
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return showToast('Persistent storage is not supported in this browser');
  if (!window.isSecureContext) return showToast('Open the app over HTTPS or localhost first');
  const granted = await navigator.storage.persist();
  await updateStorageUi();
  showToast(granted ? 'Persistent local storage enabled' : 'Browser did not grant persistent storage', 3200);
}

function exportLibraryData() {
  const tracks = state.tracks.map((track) => ({
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album || '',
    bpm: track.bpm,
    key: track.key,
    duration: track.duration,
    addedAt: track.addedAt,
    filename: track.filename,
    gridOffset: track.gridOffset || 0,
    hotCues: normaliseHotCues(track.hotCues),
    audioBytes: track.blob?.size || 0,
    artworkBytes: track.coverBlob?.size || 0,
  }));
  const payload = {
    app: 'Padawan DJ',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    origin: location.origin,
    note: 'Metadata backup only. Original audio and artwork binary data are not included.',
    tracks,
    playlists: state.playlists,
    history: state.history,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `padawan-dj-library-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Library metadata exported');
}

async function clearLocalLibrary() {
  if (!state.tracks.length) return showToast('The local library is already empty');
  const confirmed = await requestDialog({ title: 'Clear local library?', message: 'This removes every imported track, playlist assignment and Hot Cue from this browser. This cannot be undone.', code: 'DESTRUCTIVE ACTION', confirmText: 'CLEAR LIBRARY', danger: true });
  if (!confirmed) return;
  decks.A.pause(); decks.B.pause();
  decks.A.track = null; decks.B.track = null;
  decks.A.updateTrackUi(); decks.B.updateTrackUi();
  state.tracks.forEach((track) => {
    if (track.coverUrl?.startsWith('blob:')) URL.revokeObjectURL(track.coverUrl);
  });
  state.tracks = [];
  state.history = [];
  state.selectedTrackId = null;
  state.playlists.forEach((playlist) => { playlist.trackIds = []; });
  savePlaylists();
  renderPlaylistList();
  localStorage.removeItem('dualDeckHistory');
  await dbClear();
  renderTable();
  await updateStorageUi();
  showToast('Local library cleared');
}

function updateNetworkStatus() {
  if (!ui.networkStatus) return;
  const online = navigator.onLine;
  ui.networkStatus.textContent = online ? 'ONLINE' : 'OFFLINE';
  ui.networkStatus.classList.toggle('offline', !online);
  ui.networkStatus.title = online ? 'Network available' : 'Offline mode — local tracks remain available';
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    state.serviceWorkerReady = false;
    await updateStorageUi();
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js');
    await navigator.serviceWorker.ready;
    state.serviceWorkerReady = true;
    await updateStorageUi();

    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          showToast('A new app version is ready — refresh when convenient', 4200);
        }
      });
    });
  } catch (error) {
    console.warn('Service worker registration failed', error);
    state.serviceWorkerReady = false;
    await updateStorageUi();
  }
}

function setupInstallPrompt() {
  const installed = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (installed && ui.installButton) ui.installButton.hidden = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    if (ui.installButton) ui.installButton.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    state.deferredInstallPrompt = null;
    if (ui.installButton) ui.installButton.hidden = true;
    showToast('Padawan DJ installed');
  });
}

async function promptInstall() {
  if (!state.deferredInstallPrompt) return showToast('Install is available from your browser menu once the PWA is ready');
  state.deferredInstallPrompt.prompt();
  const choice = await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  if (ui.installButton) ui.installButton.hidden = true;
  showToast(choice.outcome === 'accepted' ? 'Installing Padawan DJ…' : 'Installation cancelled');
}

function setLibraryMaximized(maximized) {
  const workspace = $('.workspace');
  if (maximized && !workspace.classList.contains('library-maximized')) {
    // Start the library exactly where the deck panels start, whatever the layout breakpoint.
    workspace.style.setProperty('--deck-inset-top', getComputedStyle($('.decks-section')).paddingTop);
  }
  workspace.classList.toggle('library-maximized', maximized);
  const button = $('#libraryMaximizeButton');
  const label = maximized ? 'Restore decks' : 'Maximize library';
  button.setAttribute('aria-pressed', String(maximized));
  button.setAttribute('aria-label', label);
  button.title = `${label} (L)`;
  button.querySelector('span').textContent = maximized ? 'RESTORE' : 'MAXIMIZE';
  $('#selectionHint').textContent = maximized
    ? 'Double-click or use the 1 / 2 buttons to load. Press L or Esc to bring the decks back.'
    : 'Double-click to load, or drag a track directly onto a jog wheel.';
  if (!maximized) {
    // Overview canvases were hidden, so redraw them at their restored size.
    requestAnimationFrame(() => {
      drawOverview(decks.A);
      drawOverview(decks.B);
    });
  }
}

function bindEvents() {
  ui.importButton.addEventListener('click', () => ui.fileInput.click());
  const resetImportDropState = () => {
    ui.importButton.classList.remove('drop-target');
    ui.importButton.textContent = '＋ ADD TRACKS';
  };
  ui.importButton.addEventListener('dragenter', (event) => {
    if (![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    ui.importButton.classList.add('drop-target');
    ui.importButton.textContent = 'DROP AUDIO FILES';
  });
  ui.importButton.addEventListener('dragover', (event) => {
    if (![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  });
  ui.importButton.addEventListener('dragleave', (event) => {
    if (event.relatedTarget && ui.importButton.contains(event.relatedTarget)) return;
    resetImportDropState();
  });
  ui.importButton.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer.files;
    resetImportDropState();
    if (files.length) addFiles(files).catch(console.error);
  });
  ui.fileInput.addEventListener('change', (event) => {
    addFiles(event.target.files).catch(console.error);
    event.target.value = '';
  });
  ui.loadDemosButton.addEventListener('click', () => addDemoTracks().catch(console.error));
  ui.clearLibraryButton.addEventListener('click', () => clearLocalLibrary().catch(console.error));
  ui.storageButton.addEventListener('click', () => {
    updateStorageUi().catch(console.error);
    ui.storageDialog.showModal();
  });
  ui.requestPersistenceButton.addEventListener('click', () => requestPersistentStorage().catch(console.error));
  ui.exportLibraryButton.addEventListener('click', exportLibraryData);
  ui.clearLibraryDialogButton.addEventListener('click', () => clearLocalLibrary().catch(console.error));
  ui.installButton.addEventListener('click', () => promptInstall().catch(console.error));
  window.addEventListener('online', () => { updateNetworkStatus(); showToast('Back online', 1200); });
  window.addEventListener('offline', () => { updateNetworkStatus(); showToast('Offline mode — local library is still available', 2600); });

  function showHelpTab(tab) {
    const about = tab === 'about';
    $('#helpShortcutsPanel').hidden = about;
    $('#helpAboutPanel').hidden = !about;
    for (const button of $$('.help-tab')) {
      const active = button.dataset.helpTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    if (about) {
      $('#aboutVersion').textContent = APP_VERSION;
      const ua = navigator.userAgent || '';
      const browser = /Edg\//.test(ua) ? 'Microsoft Edge'
        : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\//.test(ua) ? 'Google Chrome'
        : /Safari\//.test(ua) ? 'Safari' : 'Unknown browser';
      $('#aboutBrowser').textContent = browser;
      const core = Boolean(window.AudioContext || window.webkitAudioContext) && Boolean(window.indexedDB);
      $('#aboutCoreSupport').textContent = core ? 'Available' : 'Missing required APIs';
      const output = typeof HTMLMediaElement.prototype.setSinkId === 'function';
      $('#aboutOutputSupport').textContent = output && window.isSecureContext ? 'API available · hardware required' : 'Not available';
    }
  }

  // Only working navigation targets: library, mixer, and audio outputs.
  const activateNavigation = (id) => {
    $$('.app-navigation .nav-pill').forEach((button) => button.classList.toggle('active', button.id === id));
  };
  const fullscreenButton = $('#fullscreenButton');
  fullscreenButton.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) { showToast('Fullscreen is unavailable in this browser.'); }
  });
  document.addEventListener('fullscreenchange', () => {
    const label = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreenButton.setAttribute('aria-label', label);
    fullscreenButton.title = label;
  });
  $('#navLibrary').addEventListener('click', () => {
    activateNavigation('navLibrary');
    $('#searchInput').focus({ preventScroll: true });
  });
  $('#libraryMaximizeButton').addEventListener('click', () => {
    setLibraryMaximized(!$('.workspace').classList.contains('library-maximized'));
  });
  $('#navMixer').addEventListener('click', () => {
    setLibraryMaximized(false);
    activateNavigation('navMixer');
    $('#crossfader').focus({ preventScroll: true });
  });
  $('#navAudio').addEventListener('click', () => {
    activateNavigation('navAudio');
    $('#audioOutputButton').click();
  });
  $('#helpButton').addEventListener('click', () => {
    showHelpTab('about');
    ui.helpDialog.showModal();
  });
  $$('.help-tab').forEach((button) => button.addEventListener('click', () => showHelpTab(button.dataset.helpTab)));
  $$('.cue-monitor').forEach((button) => button.addEventListener('click', () => {
    const deckId = button.closest('.mixer-channel')?.dataset.deck;
    if (!deckId) return;
    const activate = !button.classList.contains('active');
    $$('.cue-monitor').forEach((cueButton) => {
      cueButton.classList.toggle('active', activate && cueButton === button);
    });
    refreshCueGates();
    setSelectedDeck(deckId);
    showToast(`Deck ${deckId === 'A' ? '1' : '2'} cue ${button.classList.contains('active') ? 'on' : 'off'}${cueEnabled ? '' : ' — configure headphones in AUDIO OUTPUT'}`, 2000);
  }));
  $('#audioOutputButton').addEventListener('click', () => {
    listCueDevices().catch(console.error);
    $('#audioOutputDialog').showModal();
  });
  $('#closeAudioOutput').addEventListener('click', () => $('#audioOutputDialog').close());
  $('#closeAudioOutputX').addEventListener('click', () => $('#audioOutputDialog').close());
  // Only dismiss when the gesture starts and ends outside the dialog itself.
  // Clicking padding or dragging a slider beyond an edge must leave it open.
  [ui.helpDialog, ui.storageDialog, $('#audioOutputDialog')].forEach((dialog) => {
    let startedOutside = false;
    const isOutside = (event) => {
      const rect = dialog.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom;
    };
    dialog.addEventListener('pointerdown', (event) => {
      startedOutside = event.target === dialog && isOutside(event);
    });
    dialog.addEventListener('pointercancel', () => { startedOutside = false; });
    dialog.addEventListener('click', (event) => {
      if (startedOutside && event.target === dialog && isOutside(event)) dialog.close();
      startedOutside = false;
    });
  });
  $('#detectHeadphones').addEventListener('click', () => {
    discoverCueDevices().catch((error) => {
      $('#cueOutputStatus').textContent = describeCueError(error);
      console.error('Audio device discovery failed:', error);
    });
  });
  $('#testHeadphones').addEventListener('click', testCueOutput);
  $('#cueVolume').addEventListener('input', (event) => {
    cueBus.gain.setTargetAtTime(Number(event.target.value), audioContext.currentTime, 0.01);
  });
  $('#enableHeadphones').addEventListener('click', async () => {
    const status = $('#cueOutputStatus');
    try {
      let id = $('#headphoneOutput').value;
      if (navigator.mediaDevices?.selectAudioOutput) {
        const device = await navigator.mediaDevices.selectAudioOutput(id ? { deviceId: id } : {});
        id = device.deviceId;
      }
      if (!id) throw new Error('Select a separate headphone device first.');
      await enableCueOutput(id);
      await listCueDevices();
      $('#headphoneOutput').value = id;
    } catch (error) {
      cueAudio.muted = true;
      cueAudio.pause();
      cueEnabled = false;
      status.textContent = describeCueError(error);
      showToast(`Headphone output failed: ${error.name || 'error'} — see Audio Output`, 3500);
      console.error('Headphone output failed:', error);
    }
  });
  $('#disableHeadphones').addEventListener('click', disableCueOutput);
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    listCueDevices().then(() => {
      if (cueEnabled && !Array.from($('#headphoneOutput').options).some((option) => option.value === cueDeviceId)) {
        disableCueOutput();
        $('#cueOutputStatus').textContent = 'Headphones disconnected — monitoring disabled';
      }
    }).catch(console.error);
  });
  const crossfader = $('#crossfader');
  let keyboardCrossfader = false;
  crossfader.addEventListener('pointerdown', () => { keyboardCrossfader = false; });
  crossfader.addEventListener('keydown', () => { keyboardCrossfader = true; });
  crossfader.addEventListener('keyup', () => { keyboardCrossfader = false; });
  crossfader.addEventListener('blur', () => { keyboardCrossfader = false; });
  const updateCrossfader = () => {
    // Native range controls can cancel pointer events during a drag. Snap from
    // the input value itself, while retaining precise keyboard adjustments.
    if (!keyboardCrossfader && Math.abs(Number(crossfader.value)) <= 0.1) crossfader.value = '0';
    applyCrossfader(crossfader.value);
  };
  crossfader.addEventListener('input', updateCrossfader);
  crossfader.addEventListener('change', updateCrossfader);
  crossfader.addEventListener('dblclick', () => {
    crossfader.value = '0';
    applyCrossfader(0);
  });
  $('#masterVolume').addEventListener('input', (event) => masterGain.gain.setTargetAtTime(Number(event.target.value), audioContext.currentTime, 0.01));
  $('#masterA').addEventListener('click', () => setMasterDeck('A'));
  $('#masterB').addEventListener('click', () => setMasterDeck('B'));
  $('#waveZoomOut').addEventListener('click', () => setWaveformZoom(state.waveformWindowSeconds * 1.5));
  $('#waveZoomIn').addEventListener('click', () => setWaveformZoom(state.waveformWindowSeconds / 1.5));
  $('#waveZoomReset').addEventListener('click', () => setWaveformZoom(DEFAULT_WAVEFORM_WINDOW_SECONDS));

  $$('.reset-tempo').forEach((button) => button.addEventListener('click', () => {
    const deck = decks[button.dataset.deck];
    $(`#tempo${deck.id}`).value = '0';
    deck.setTempo(0);
  }));
  ui.searchInput.addEventListener('input', (event) => {
    state.search = event.target.value;
    renderTable();
  });

  $$('.source-item').forEach((button) => button.addEventListener('click', () => {
    state.source = button.dataset.source;
    $$('.source-item').forEach((item) => item.classList.toggle('active', item === button));
    const headings = { collection: 'Collection', recent: 'Recently Added', history: 'History' };
    ui.browserHeading.textContent = headings[state.source];
    renderPlaylistList();
    renderTable();
  }));

  $('#addPlaylist').addEventListener('click', async () => {
    const name = await requestDialog({ title: 'Create playlist', message: 'Name a new set, then drag tracks onto it from your Collection.', code: 'PLAYLIST CONTROL', label: 'PLAYLIST NAME', confirmText: 'CREATE PLAYLIST' });
    if (!name?.trim()) return;
    state.playlists.push({ id: crypto.randomUUID(), name: name.trim(), trackIds: [] });
    savePlaylists();
    renderPlaylistList();
    showToast(`${name.trim()} created — drag tracks onto it`);
  });

  $$('.track-table th[data-sort]').forEach((heading) => heading.addEventListener('click', () => {
    const field = heading.dataset.sort;
    if (state.sort.field === field) state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
    else state.sort = { field, direction: 'asc' };
    state.source = 'collection';
    ui.browserHeading.textContent = 'Collection';
    $$('.source-item').forEach((item) => item.classList.toggle('active', item.dataset.source === 'collection'));
    renderPlaylistList();
    renderTable();
  }));

  ui.trackTableBody.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-id]');
    if (!row) return;
    const remove = event.target.closest('[data-remove-track]');
    if (remove) {
      removeTrack(row.dataset.id).catch(console.error);
      return;
    }
    state.selectedTrackId = row.dataset.id;
    const load = event.target.closest('button[data-load]');
    if (load) loadTrackToDeck(row.dataset.id, load.dataset.load).catch(console.error);
    else renderTable();
  });

  ui.trackTableBody.addEventListener('dragstart', (event) => {
    const row = event.target.closest('tr[data-id]');
    if (!row) return;
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('text/track-id', row.dataset.id);
    event.dataTransfer.setData('text/plain', row.dataset.id);
    event.dataTransfer.effectAllowed = 'copy';
  });

  ui.trackTableBody.addEventListener('dblclick', async (event) => {
    const row = event.target.closest('tr[data-id]');
    if (!row) return;
    const editable = event.target.closest('[data-field]');
    const track = state.tracks.find((item) => item.id === row.dataset.id);
    if (editable && track) {
      if (editable.dataset.field === 'bpm') {
        const result = await requestDialog({ title: 'Edit track tempo', message: `Set the analysed tempo for “${track.title}”.`, code: 'TRACK METADATA', label: 'BPM · 40–260', value: track.bpm, type: 'number', min: 40, max: 260, step: 0.1, confirmText: 'SAVE BPM' });
        const value = Number(result);
        if (result === null) return;
        if (Number.isFinite(value) && value >= 40 && value <= 260) track.bpm = Math.round(value * 100) / 100;
      } else {
        const value = await requestDialog({ title: 'Edit musical key', message: `Set the key for “${track.title}” using Camelot or standard notation.`, code: 'TRACK METADATA', label: 'KEY · EXAMPLE 8A OR AM', value: track.key || '', confirmText: 'SAVE KEY' });
        if (value !== null) track.key = value.trim() || '--';
      }
      dbPut(track).catch(console.error);
      if (decks.A.track?.id === track.id) decks.A.updateTrackUi();
      if (decks.B.track?.id === track.id) decks.B.updateTrackUi();
      renderTable();
      return;
    }
    loadTrackToDeck(row.dataset.id, state.selectedDeck).catch(console.error);
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea, select') || document.querySelector('dialog[open]')) return;
    const deck = decks[state.selectedDeck];
    if (event.code === 'Digit1') return setSelectedDeck('A');
    if (event.code === 'Digit2') return setSelectedDeck('B');
    if (event.code === 'Space') { event.preventDefault(); return deck.playPause().catch(console.error); }
    if (event.key.toLowerCase() === 'c') return deck.cue();
    if (event.key.toLowerCase() === 's') return deck.syncTo(decks[state.masterDeck]);
    if (event.key.toLowerCase() === 'l') return setLibraryMaximized(!$('.workspace').classList.contains('library-maximized'));
    if (event.code === 'Escape' && $('.workspace').classList.contains('library-maximized')) return setLibraryMaximized(false);
    if (event.code === 'ArrowLeft' && deck.track) { event.preventDefault(); deck.audio.currentTime = Math.max(0, deck.audio.currentTime - 5); }
    if (event.code === 'ArrowRight' && deck.track) { event.preventDefault(); deck.audio.currentTime = Math.min(deck.audio.duration || 0, deck.audio.currentTime + 5); }
    if (event.code === 'Enter' && state.selectedTrackId) return loadTrackToDeck(state.selectedTrackId, state.selectedDeck).catch(console.error);
  });

  document.addEventListener('dragover', (event) => {
    if ([...event.dataTransfer.types].includes('Files')) event.preventDefault();
  });
  document.addEventListener('drop', (event) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    addFiles(event.dataTransfer.files).catch(console.error);
  });

  window.addEventListener('resize', () => {
    drawOverview(decks.A);
    drawOverview(decks.B);
  });
}

async function init() {
  state.db = await openDatabase();
  const storedTracks = await dbGetAll();
  state.tracks = storedTracks.map((track) => ({
    ...track,
    album: track.album || '',
    coverBlob: track.coverBlob || null,
    hotCues: normaliseHotCues(track.hotCues),
    buffer: null,
    peaks: null,
  }));
  bindDeckControls(decks.A);
  bindDeckControls(decks.B);
  setupInstallPrompt();
  bindEvents();
  refreshCueGates();
  updateNetworkStatus();
  setWaveformZoom(DEFAULT_WAVEFORM_WINDOW_SECONDS);
  applyCrossfader(0);
  setSelectedDeck('A');
  setMasterDeck('A');
  decks.A.updateTrackUi();
  decks.B.updateTrackUi();
  renderPlaylistList();
  renderTable();
  await updateStorageUi();
  registerServiceWorker().catch(console.error);

  const updateClock = () => {
    $('#clock').textContent = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date());
  };
  updateClock();
  setInterval(updateClock, 10000);
  requestAnimationFrame(animationLoop);
}

init().catch((error) => {
  console.error(error);
  showToast('Padawan DJ could not start — check browser console.');
});
