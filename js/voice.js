/* ═══════════════════════════════════════════════
   js/voice.js — Web Audio API voice analysis (5s)
═══════════════════════════════════════════════ */

const VoiceScanner = (() => {
  const DURATION = 5; // reduced to 5 seconds

  let audioCtx = null;
  let analyserNode = null;
  let sourceNode = null;
  let micStream = null;
  let recording = false;
  let done = false;
  let animFrameId = null;

  let pitchSamples = [];
  let volumeSamples = [];
  let energyBursts = 0;
  let prevVolume = 0;
  let startTime = 0;
  let sampleInterval = null;

  let smoothedScore = 0;

  const scores = {
    pitch: 0, pitchVar: 0, volVar: 0,
    rate: 0, drama: 0, burst: 0,
  };
  let voiceScore = 0;

  /* ── Live feedback messages ─────────────────── */
  const VOICE_MSGS = [
    'Pitch variation detected',
    'Energy increasing',
    'Expressiveness rising',
    'Strong articulation detected',
    'Vocal drama logged',
    'Melodic delivery analysed',
    'Volume dynamics captured',
    'Emphasis patterns detected',
    'Charisma coefficient rising',
    'Speech rate analysed',
  ];
  let lastVoiceMsg = -1;
  let voiceFeedbackTimer = 0;

  function rotateFeedback() {
    voiceFeedbackTimer++;
    if (voiceFeedbackTimer % 8 !== 0) return;
    let idx;
    do { idx = Math.floor(Math.random() * VOICE_MSGS.length); } while (idx === lastVoiceMsg);
    lastVoiceMsg = idx;
    const el = document.getElementById('voice-live-feedback');
    if (el) {
      el.style.animation = 'none';
      el.offsetHeight;
      el.style.animation = '';
      el.textContent = VOICE_MSGS[idx];
    }
  }

  /* ── Pitch detection (autocorrelation) ──────── */
  function detectPitch(buffer, sampleRate) {
    const SIZE = buffer.length;
    const MAX_SAMPLES = Math.floor(SIZE / 2);
    const threshold = 0.2;
    const corr = new Float32Array(MAX_SAMPLES);
    for (let i = 0; i < MAX_SAMPLES; i++) {
      let sum = 0;
      for (let j = 0; j < MAX_SAMPLES; j++) sum += buffer[j] * buffer[j + i];
      corr[i] = sum;
    }
    let valley = 0;
    for (let i = 1; i < MAX_SAMPLES; i++) {
      if (corr[i] < corr[i - 1]) { valley = i; break; }
    }
    let peakIdx = -1, peakVal = threshold;
    for (let i = valley; i < MAX_SAMPLES; i++) {
      if (corr[i] > peakVal) { peakVal = corr[i]; peakIdx = i; }
    }
    if (peakIdx === -1) return -1;
    const x0 = peakIdx > 0 ? corr[peakIdx - 1] : corr[peakIdx];
    const x1 = corr[peakIdx];
    const x2 = peakIdx + 1 < MAX_SAMPLES ? corr[peakIdx + 1] : corr[peakIdx];
    const refined = peakIdx + 0.5 * (x0 - x2) / (x0 - 2 * x1 + x2 + 1e-9);
    const freq = sampleRate / refined;
    if (freq < 50 || freq > 1200) return -1;
    return freq;
  }

  function rmsVolume(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    return Math.sqrt(sum / buffer.length);
  }

  function stdDev(arr) {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
  }

  function norm(val, min, max) { return Math.max(0, Math.min(1, (val - min) / (max - min))); }

  /* ── Waveform drawing ───────────────────────── */
  function drawWave() {
    const canvas = document.getElementById('wave-canvas');
    if (!canvas || !analyserNode) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const bufLen = analyserNode.fftSize;
    const dataArr = new Uint8Array(bufLen);
    analyserNode.getByteTimeDomainData(dataArr);

    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (H / 4) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    const gradient = ctx.createLinearGradient(0, 0, W, 0);
    gradient.addColorStop(0, '#ff2777');
    gradient.addColorStop(0.5, '#b44bff');
    gradient.addColorStop(1, '#00e5ff');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    ctx.shadowColor = '#ff2777'; ctx.shadowBlur = 6;
    ctx.beginPath();
    const sliceW = W / bufLen;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const v = dataArr[i] / 128.0;
      const y = (v * H) / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += sliceW;
    }
    ctx.lineTo(W, H / 2); ctx.stroke(); ctx.shadowBlur = 0;
    animFrameId = requestAnimationFrame(drawWave);
  }

  /* ── Collect samples ────────────────────────── */
  function collectSample() {
    if (!analyserNode || !recording) return;
    const fftSize = analyserNode.fftSize;
    const timeData = new Float32Array(fftSize);
    analyserNode.getFloatTimeDomainData(timeData);

    const pitch = detectPitch(timeData, audioCtx.sampleRate);
    if (pitch > 0) pitchSamples.push(pitch);

    const vol = rmsVolume(timeData);
    volumeSamples.push(vol);

    if (vol > prevVolume * 1.8 && vol > 0.03) energyBursts++;
    prevVolume = vol;

    deriveLiveScores();
    updateUI();
    rotateFeedback();
  }

  function deriveLiveScores() {
    const avgPitch = pitchSamples.length
      ? pitchSamples.reduce((a, b) => a + b, 0) / pitchSamples.length : 0;
    scores.pitch    = norm(avgPitch, 80, 320);
    scores.pitchVar = norm(stdDev(pitchSamples), 5, 80);
    scores.volVar   = norm(stdDev(volumeSamples), 0.002, 0.06);
    const elapsed = (Date.now() - startTime) / 1000 || 1;
    scores.rate  = norm(pitchSamples.length / elapsed, 1, 12);
    scores.drama = Math.min(1, (scores.pitchVar * 0.5 + scores.volVar * 0.5) * 1.3);
    scores.burst = norm(energyBursts, 0, 8); // adjusted for 5s window

    const raw =
      scores.pitch    * 0.18 +
      scores.pitchVar * 0.22 +
      scores.volVar   * 0.18 +
      scores.rate     * 0.15 +
      scores.drama    * 0.17 +
      scores.burst    * 0.10;

    // EMA smoothing
    const prev = smoothedScore;
    let next = prev * 0.8 + Math.min(1, raw) * 0.2;
    const delta = next - prev;
    next = prev + Math.max(-0.03, Math.min(0.03, delta));
    smoothedScore = Math.max(0, Math.min(1, next));
    voiceScore = smoothedScore;
  }

  function updateUI() {
    const liveEl = document.getElementById('voice-score-live');
    if (liveEl) liveEl.textContent = Math.round(voiceScore * 100) + '%';
    const bar = document.getElementById('voice-progress-bar');
    if (bar) bar.style.width = Math.round(voiceScore * 100) + '%';
  }

  /* ── Countdown ring animation ───────────────── */
  function startCountdownRing(durationSec) {
    const wrap  = document.getElementById('voice-countdown');
    const numEl = document.getElementById('countdown-num');
    const ring  = document.getElementById('ring-fill');
    if (!wrap || !ring) return;
    wrap.style.display = 'flex';
    const circumference = 213.6;
    let remaining = durationSec;
    ring.style.strokeDashoffset = '0';
    const interval = setInterval(() => {
      remaining--;
      if (numEl) numEl.textContent = remaining;
      const progress = 1 - remaining / durationSec;
      ring.style.strokeDashoffset = (circumference * progress).toString();
      if (remaining <= 0) { clearInterval(interval); wrap.style.display = 'none'; }
    }, 1000);
  }

  /* ── Public API ─────────────────────────────── */
  async function start() {
    const hint = document.getElementById('voice-hint');
    const btn  = document.getElementById('btn-record');
    const overlay = document.getElementById('wave-overlay');

    if (btn) { btn.setAttribute('disabled', true); btn.textContent = '⏳ Starting…'; }

    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      if (hint) hint.textContent = '⚠ Mic denied — score estimated';
      if (btn) btn.removeAttribute('disabled');
      startFallback(); return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.5;
    sourceNode = audioCtx.createMediaStreamSource(micStream);
    sourceNode.connect(analyserNode);

    if (overlay) overlay.classList.add('hidden');
    if (hint) hint.textContent = 'Recording… say the phrase!';
    if (btn)  btn.textContent  = '🔴 Recording…';

    recording = true;
    startTime = Date.now();
    pitchSamples = []; volumeSamples = []; energyBursts = 0; prevVolume = 0;

    drawWave();
    sampleInterval = setInterval(() => {
      if (!recording) { clearInterval(sampleInterval); return; }
      collectSample();
    }, 100);

    startCountdownRing(DURATION);

    setTimeout(() => { stop(hint, btn); }, DURATION * 1000);
  }

  function stop(hint, btn) {
    if (done) return;
    done = true; recording = false;
    if (sampleInterval) clearInterval(sampleInterval);
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    if (audioCtx) audioCtx.close();

    deriveLiveScores();
    voiceScore = Math.max(0.28, voiceScore);
    updateUI();

    if (hint) hint.textContent = `✓ Voice locked — ${Math.round(voiceScore * 100)}% energy`;
    if (btn)  { btn.textContent = '✓ Recorded'; btn.setAttribute('disabled', true); }

    setTimeout(() => { if (window.AppController) AppController.voiceDone(); }, 600);
  }

  function startFallback() {
    done = true;
    scores.pitch    = 0.35 + Math.random() * 0.45;
    scores.pitchVar = 0.40 + Math.random() * 0.40;
    scores.volVar   = 0.30 + Math.random() * 0.45;
    scores.rate     = 0.40 + Math.random() * 0.35;
    scores.drama    = 0.40 + Math.random() * 0.40;
    scores.burst    = 0.30 + Math.random() * 0.45;
    voiceScore = Math.max(0.28,
      scores.pitch * 0.18 + scores.pitchVar * 0.22 + scores.volVar * 0.18 +
      scores.rate  * 0.15 + scores.drama    * 0.17 + scores.burst  * 0.10);
    smoothedScore = voiceScore;
    updateUI();
    setTimeout(() => { if (window.AppController) AppController.voiceDone(); }, 1200);
  }

  function getVoiceScore() {
    return Math.max(28, Math.round(voiceScore * 100));
  }

  function getTopInsights() {
    const insights = [
      { label: 'High vocal expressiveness',    val: scores.drama    },
      { label: 'Strong pitch variation',        val: scores.pitchVar },
      { label: 'Animated delivery detected',    val: scores.burst    },
      { label: 'Elevated average pitch',        val: scores.pitch    },
      { label: 'Dynamic volume range',          val: scores.volVar   },
      { label: 'Rapid speech energy detected',  val: scores.rate     },
    ];
    insights.sort((a, b) => b.val - a.val);
    return insights.slice(0, 3).map(i => i.label);
  }

  function getSubScores() {
    return {
      pitch:    Math.round(scores.pitch    * 100),
      pitchVar: Math.round(scores.pitchVar * 100),
      volVar:   Math.round(scores.volVar   * 100),
      rate:     Math.round(scores.rate     * 100),
      drama:    Math.round(scores.drama    * 100),
      burst:    Math.round(scores.burst    * 100),
    };
  }

  return { start, getVoiceScore, getSubScores, getTopInsights };
})();
