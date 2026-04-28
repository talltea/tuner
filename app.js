import { PitchDetector } from './vendor/pitchy.js';

const STRINGS = [
  { name: 'E2', midi: 40, hz: 82.4069 },
  { name: 'A2', midi: 45, hz: 110.000 },
  { name: 'D3', midi: 50, hz: 146.832 },
  { name: 'G3', midi: 55, hz: 195.998 },
  { name: 'B3', midi: 59, hz: 246.942 },
  { name: 'E4', midi: 64, hz: 329.628 },
];

const CLARITY_MIN = 0.92;
const RMS_MIN = 0.01;
const SMOOTH_ALPHA = 0.25;
const LOCK_CENTS = 5;
const LOCK_HOLD_MS = 300;
const NEEDLE_MAX_DEG = 45;
const CENTS_RANGE = 50;

const app = document.getElementById('app');
const noteEl = document.getElementById('note');
const hzEl = document.getElementById('hz');
const centsEl = document.getElementById('cents');
const needleEl = document.getElementById('needle');
const startBtn = document.getElementById('start');
const hintEl = document.getElementById('hint');
const stringsNav = document.getElementById('strings');
const stringBtns = [...stringsNav.querySelectorAll('button')];

let manualLockIdx = null;
let smoothedDeg = 0;
let lockSince = 0;

stringBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const idx = Number(btn.dataset.string);
    manualLockIdx = manualLockIdx === idx ? null : idx;
    updateStringButtons(null);
  });
});

function updateStringButtons(detectedIdx) {
  stringBtns.forEach((btn, i) => {
    btn.classList.toggle('locked-target', manualLockIdx === i);
    btn.classList.toggle('detected', manualLockIdx === null && detectedIdx === i);
  });
}

function nearestStringIdx(hz) {
  const semitonesFromA4 = 12 * Math.log2(hz / 440);
  const midi = Math.round(semitonesFromA4) + 69;
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < STRINGS.length; i++) {
    const d = Math.abs(STRINGS[i].midi - midi);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

function rms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

async function start() {
  startBtn.disabled = true;
  startBtn.textContent = 'Starting…';

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (err) {
    showError(`Microphone unavailable: ${err.message || err.name}`);
    startBtn.disabled = false;
    startBtn.textContent = 'Tap to start';
    return;
  }

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') await ctx.resume();

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);

  const buf = new Float32Array(analyser.fftSize);
  const detector = PitchDetector.forFloat32Array(analyser.fftSize);
  detector.clarityThreshold = CLARITY_MIN;

  app.classList.add('live');

  let lastUpdate = 0;
  function tick(now) {
    analyser.getFloatTimeDomainData(buf);
    const level = rms(buf);

    if (level >= RMS_MIN) {
      const [hz, clarity] = detector.findPitch(buf, ctx.sampleRate);
      if (hz > 0 && clarity >= CLARITY_MIN && hz >= 60 && hz <= 1200) {
        const detectedIdx = nearestStringIdx(hz);
        const targetIdx = manualLockIdx ?? detectedIdx;
        const target = STRINGS[targetIdx];
        const cents = 1200 * Math.log2(hz / target.hz);

        const targetDeg = clamp(cents, -CENTS_RANGE, CENTS_RANGE) / CENTS_RANGE * NEEDLE_MAX_DEG;
        smoothedDeg = smoothedDeg + SMOOTH_ALPHA * (targetDeg - smoothedDeg);
        needleEl.style.transform = `rotate(${smoothedDeg.toFixed(2)}deg)`;

        noteEl.textContent = target.name;
        hzEl.textContent = hz.toFixed(1);
        centsEl.textContent = (cents >= 0 ? '+' : '') + cents.toFixed(0);

        updateStringButtons(detectedIdx);

        if (Math.abs(cents) <= LOCK_CENTS) {
          if (lockSince === 0) lockSince = now;
          if (now - lockSince >= LOCK_HOLD_MS) app.classList.add('locked');
        } else {
          lockSince = 0;
          app.classList.remove('locked');
        }

        lastUpdate = now;
      }
    } else {
      lockSince = 0;
      app.classList.remove('locked');
    }

    if (now - lastUpdate > 800) {
      smoothedDeg = smoothedDeg + 0.15 * (0 - smoothedDeg);
      needleEl.style.transform = `rotate(${smoothedDeg.toFixed(2)}deg)`;
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function showError(msg) {
  hintEl.textContent = msg;
  hintEl.classList.add('error');
}

startBtn.addEventListener('click', start);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('SW registration failed', err);
    });
  });
}
