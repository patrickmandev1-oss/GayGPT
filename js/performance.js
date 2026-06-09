/* ═══════════════════════════════════════════════
   js/performance.js — MediaPipe Pose performance analysis
═══════════════════════════════════════════════ */

const PerfScanner = (() => {
  const DURATION = 8; // seconds

  let pose = null;
  let camera = null;
  let camStream = null;
  let running = false;
  let capturing = false;
  let done = false;

  /* Pose landmark indices (MediaPipe Pose) */
  const LM = {
    NOSE:         0,
    L_SHOULDER:  11, R_SHOULDER: 12,
    L_ELBOW:     13, R_ELBOW:    14,
    L_WRIST:     15, R_WRIST:    16,
    L_HIP:       23, R_HIP:      24,
    L_KNEE:      25, R_KNEE:     26,
    L_ANKLE:     27, R_ANKLE:    28,
    L_INDEX:     19, R_INDEX:    20,  // fingertip proxies
  };

  /* History for motion calculation */
  const WINDOW = 6;
  let lmHistory = [];       // array of landmark arrays
  let frameScores = [];     // per-frame drama scores
  let startTime = 0;

  const scores = {
    handSpd: 0,
    armExt:  0,
    body:    0,
    head:    0,
    enth:    0,
    drama:   0,
  };
  let perfScore = 0;

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function norm(val, min, max) { return clamp01((val - min) / (max - min)); }

  function dist2D(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Average velocity of a landmark across last N frames */
  function landmarkVelocity(history, idx) {
    if (history.length < 2) return 0;
    let totalDist = 0;
    const n = Math.min(history.length - 1, WINDOW);
    for (let i = history.length - n; i < history.length; i++) {
      const a = history[i - 1][idx];
      const b = history[i][idx];
      if (!a || !b || a.visibility < 0.3 || b.visibility < 0.3) continue;
      totalDist += dist2D(a, b);
    }
    return totalDist / n;
  }

  /** Arm extension: how far wrists are from shoulders (normalised by torso size) */
  function calcArmExtension(lm) {
    const torsoH = dist2D(lm[LM.L_SHOULDER], lm[LM.L_HIP]);
    if (!torsoH) return 0;

    const lExt = dist2D(lm[LM.L_SHOULDER], lm[LM.L_WRIST]);
    const rExt = dist2D(lm[LM.R_SHOULDER], lm[LM.R_WRIST]);
    const maxExt = Math.max(lExt, rExt);
    // Full extension ≈ 2x torso height
    return norm(maxExt / torsoH, 0.5, 1.8);
  }

  /** Body movement: velocity of hip center */
  function calcBodyMovement(history) {
    if (history.length < 2) return 0;
    let vel = 0;
    const n = Math.min(history.length - 1, WINDOW);
    for (let i = history.length - n; i < history.length; i++) {
      const a = history[i - 1];
      const b = history[i];
      const aHip = { x: (a[LM.L_HIP].x + a[LM.R_HIP].x) / 2, y: (a[LM.L_HIP].y + a[LM.R_HIP].y) / 2 };
      const bHip = { x: (b[LM.L_HIP].x + b[LM.R_HIP].x) / 2, y: (b[LM.L_HIP].y + b[LM.R_HIP].y) / 2 };
      vel += dist2D(aHip, bHip);
    }
    return norm(vel / n, 0.002, 0.05);
  }

  /** Head movement: nose velocity */
  function calcHeadMovement(history) {
    return norm(landmarkVelocity(history, LM.NOSE), 0.005, 0.06);
  }

  /** Hand speed: max wrist velocity */
  function calcHandSpeed(history) {
    const lVel = landmarkVelocity(history, LM.L_WRIST);
    const rVel = landmarkVelocity(history, LM.R_WRIST);
    return norm(Math.max(lVel, rVel), 0.01, 0.12);
  }

  /** Enthusiasm: overall movement across all landmarks */
  function calcEnthusiasm(history) {
    if (history.length < 2) return 0;
    const key = [LM.NOSE, LM.L_WRIST, LM.R_WRIST, LM.L_ELBOW, LM.R_ELBOW];
    let total = 0;
    key.forEach(idx => { total += landmarkVelocity(history, idx); });
    return norm(total / key.length, 0.005, 0.06);
  }

  /** Drama index: peak-to-average ratio of wrist velocities */
  function calcDramaIndex() {
    if (frameScores.length < 3) return 0;
    const peak = Math.max(...frameScores);
    const avg = frameScores.reduce((a, b) => a + b, 0) / frameScores.length;
    return norm(peak / (avg + 0.001), 1, 4);
  }

  function calcPerfScore() {
    return clamp01(
      scores.handSpd * 0.22 +
      scores.armExt  * 0.18 +
      scores.body    * 0.18 +
      scores.head    * 0.15 +
      scores.enth    * 0.17 +
      scores.drama   * 0.10
    );
  }

  /* ── Drawing ────────────────────────────────────── */
  function drawPoseOverlay(canvas, lm) {
    if (!lm) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const W = canvas.width, H = canvas.height;

    const connections = [
      [LM.L_SHOULDER, LM.R_SHOULDER],
      [LM.L_SHOULDER, LM.L_ELBOW], [LM.L_ELBOW, LM.L_WRIST],
      [LM.R_SHOULDER, LM.R_ELBOW], [LM.R_ELBOW, LM.R_WRIST],
      [LM.L_SHOULDER, LM.L_HIP], [LM.R_SHOULDER, LM.R_HIP],
      [LM.L_HIP, LM.R_HIP],
      [LM.L_HIP, LM.L_KNEE], [LM.L_KNEE, LM.L_ANKLE],
      [LM.R_HIP, LM.R_KNEE], [LM.R_KNEE, LM.R_ANKLE],
    ];

    connections.forEach(([a, b]) => {
      if (!lm[a] || !lm[b]) return;
      if (lm[a].visibility < 0.4 || lm[b].visibility < 0.4) return;
      const gradient = ctx.createLinearGradient(
        lm[a].x * W, lm[a].y * H, lm[b].x * W, lm[b].y * H
      );
      gradient.addColorStop(0, 'rgba(255,39,119,0.7)');
      gradient.addColorStop(1, 'rgba(0,229,255,0.7)');
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ff2777';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(lm[a].x * W, lm[a].y * H);
      ctx.lineTo(lm[b].x * W, lm[b].y * H);
      ctx.stroke();
      ctx.shadowBlur = 0;
    });

    // Joints
    Object.values(LM).forEach(idx => {
      const p = lm[idx];
      if (!p || p.visibility < 0.4) return;
      ctx.fillStyle = 'rgba(180,75,255,0.9)';
      ctx.shadowColor = '#b44bff';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // Score display
    const pct = Math.round(perfScore * 100);
    ctx.font = 'bold 15px Syne, sans-serif';
    ctx.fillStyle = 'rgba(0,229,255,0.85)';
    ctx.fillText(`💃 ${pct}%`, 10, H - 10);
  }

  function updateUI() {
    const pct = v => Math.round(v * 100) + '%';
    const setBar = (id, v) => { const el = document.getElementById(id); if (el) el.style.width = (Math.min(1, v) * 100) + '%'; };
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = pct(v); };

    setBar('bar-handspd', scores.handSpd); setVal('val-handspd', scores.handSpd);
    setBar('bar-armext',  scores.armExt);  setVal('val-armext',  scores.armExt);
    setBar('bar-body',    scores.body);    setVal('val-body',     scores.body);
    setBar('bar-head',    scores.head);    setVal('val-head',     scores.head);
    setBar('bar-enth',    scores.enth);    setVal('val-enth',     scores.enth);
    setBar('bar-drmidx',  scores.drama);   setVal('val-drmidx',   scores.drama);

    const liveEl = document.getElementById('perf-score-live');
    if (liveEl) liveEl.textContent = Math.round(perfScore * 100) + '%';
  }

  /* ── Init MediaPipe Pose ─────────────────────────── */
  async function initPose() {
    const video = document.getElementById('perf-video');
    const canvas = document.getElementById('perf-canvas');
    const hint = document.getElementById('perf-hint');

    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      video.srcObject = camStream;
      await video.play();
    } catch (e) {
      if (hint) hint.textContent = '⚠ Camera denied — score estimated';
      return false;
    }

    video.addEventListener('loadedmetadata', () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    });

    if (hint) hint.textContent = 'Loading Pose model…';

    pose = new Pose({
      locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
    });

    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    pose.onResults(results => {
      const canvas = document.getElementById('perf-canvas');
      if (!canvas) return;

      if (results.poseLandmarks) {
        lmHistory.push(results.poseLandmarks);
        if (lmHistory.length > 20) lmHistory.shift();

        if (capturing) {
          // Compute frame drama (wrist speeds)
          const lVel = landmarkVelocity(lmHistory, LM.L_WRIST);
          const rVel = landmarkVelocity(lmHistory, LM.R_WRIST);
          frameScores.push(Math.max(lVel, rVel));

          const lm = results.poseLandmarks;
          scores.handSpd = calcHandSpeed(lmHistory);
          scores.armExt  = calcArmExtension(lm);
          scores.body    = calcBodyMovement(lmHistory);
          scores.head    = calcHeadMovement(lmHistory);
          scores.enth    = calcEnthusiasm(lmHistory);
          scores.drama   = calcDramaIndex();
          perfScore = calcPerfScore();
        }

        if (capturing || lmHistory.length > 0) {
          drawPoseOverlay(canvas, results.poseLandmarks);
        }
      }

      if (capturing) updateUI();
    });

    camera = new Camera(video, {
      onFrame: async () => {
        if (pose) await pose.send({ image: video });
      },
      width: 640, height: 480,
    });

    await camera.start();
    running = true;
    if (hint) hint.textContent = 'Step back — get your whole body in frame';
    return true;
  }

  /* ── Run the challenge ──────────────────────────── */
  function startChallenge() {
    if (!running) return;
    const btn = document.getElementById('btn-perf-start');
    const timerOverlay = document.getElementById('perf-timer-overlay');
    const timerNum = document.getElementById('perf-timer-num');
    const hint = document.getElementById('perf-hint');

    if (btn) btn.setAttribute('disabled', true);

    // Countdown 3-2-1 before capture
    let preCount = 3;
    if (timerOverlay) { timerOverlay.style.display = 'flex'; timerNum.textContent = preCount; }

    const preInterval = setInterval(() => {
      preCount--;
      if (timerNum) timerNum.textContent = preCount || 'GO!';
      if (preCount <= 0) {
        clearInterval(preInterval);
        beginCapture();
      }
    }, 1000);
  }

  function beginCapture() {
    const timerNum = document.getElementById('perf-timer-num');
    const hint = document.getElementById('perf-hint');
    if (hint) hint.textContent = 'Maximum drama! Go!';

    capturing = true;
    startTime = Date.now();
    lmHistory = [];
    frameScores = [];

    let remaining = DURATION;
    if (timerNum) timerNum.textContent = remaining;

    const captureInterval = setInterval(() => {
      remaining--;
      if (timerNum) timerNum.textContent = remaining;
      if (remaining <= 0) {
        clearInterval(captureInterval);
        finishCapture();
      }
    }, 1000);
  }

  function finishCapture() {
    capturing = false;
    done = true;

    const timerOverlay = document.getElementById('perf-timer-overlay');
    if (timerOverlay) timerOverlay.style.display = 'none';

    // Final score — minimum 25 for entertainment
    perfScore = Math.max(0.25, calcPerfScore());
    updateUI();

    const hint = document.getElementById('perf-hint');
    if (hint) hint.textContent = `✓ Performance captured — ${Math.round(perfScore * 100)}% energy`;

    if (camera) { try { camera.stop(); } catch(_) {} }
    if (camStream) camStream.getTracks().forEach(t => t.stop());

    setTimeout(() => { if (window.AppController) AppController.perfDone(); }, 600);
  }

  function startFallback() {
    done = true;
    scores.handSpd = 0.40 + Math.random() * 0.45;
    scores.armExt  = 0.35 + Math.random() * 0.45;
    scores.body    = 0.30 + Math.random() * 0.50;
    scores.head    = 0.40 + Math.random() * 0.40;
    scores.enth    = 0.35 + Math.random() * 0.45;
    scores.drama   = 0.38 + Math.random() * 0.45;
    perfScore = calcPerfScore();
    updateUI();
    setTimeout(() => { if (window.AppController) AppController.perfDone(); }, 1500);
  }

  /* ── Public API ─────────────────────────────────── */
  async function start() {
    const ok = await initPose();
    if (!ok) startFallback();
  }

  function triggerChallenge() {
    startChallenge();
  }

  function getPerfScore() {
    return Math.max(25, Math.round(perfScore * 100));
  }

  function getSubScores() {
    return {
      handSpd: Math.round(scores.handSpd * 100),
      armExt:  Math.round(scores.armExt  * 100),
      body:    Math.round(scores.body    * 100),
      head:    Math.round(scores.head    * 100),
      enth:    Math.round(scores.enth    * 100),
      drama:   Math.round(scores.drama   * 100),
    };
  }

  return { start, triggerChallenge, getPerfScore, getSubScores };
})();
