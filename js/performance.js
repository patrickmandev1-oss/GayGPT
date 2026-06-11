/* ═══════════════════════════════════════════════
   js/performance.js — Banana Challenge
   Full frame-by-frame recording (5 seconds active)
═══════════════════════════════════════════════ */

const PerfScanner = (() => {
  const CHALLENGE_DURATION = 5; // active recording seconds

  let pose = null;
  let faceMesh = null;
  let camera = null;
  let camStream = null;
  let running = false;
  let capturing = false;
  let done = false;

  /* MediaPipe Pose landmark indices */
  const LM = {
    NOSE:0, L_SHOULDER:11, R_SHOULDER:12,
    L_ELBOW:13, R_ELBOW:14, L_WRIST:15, R_WRIST:16,
    L_HIP:23, R_HIP:24, L_KNEE:25, R_KNEE:26, L_ANKLE:27, R_ANKLE:28,
    L_INDEX:19, R_INDEX:20,
  };

  /* ── Per-frame storage ──────────────────────── */
  let allFrames = []; // each: { poseLM, faceLM, timestamp }
  let smoothedScore = 0;
  let liveScore = 0;

  /* Running sub-scores across full recording */
  const scores = {
    handSpd: 0, armExt: 0, body: 0, head: 0,
    enth: 0, drama: 0, faceExpr: 0, mouthMvmt: 0,
    eyeWide: 0, confidence: 0,
  };
  let perfScore = 0;

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function norm(val, min, max) { return clamp01((val - min) / (max - min)); }
  function dist2D(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  /* ── Live feedback ──────────────────────────── */
  const PERF_MSGS = [
    'Gesture activity detected',
    'Confidence increasing',
    'Charisma boost detected',
    'Facial expressiveness rising',
    'Body motion captured',
    'Drama index spiking',
    'Head movement logged',
    'Energy burst recorded',
    'Maximum theatricality detected',
    'Spontaneity coefficient rising',
  ];
  let lastPerfMsg = -1;
  let perfFeedbackTimer = 0;

  function rotateFeedback() {
    perfFeedbackTimer++;
    if (perfFeedbackTimer % 15 !== 0) return;
    let idx;
    do { idx = Math.floor(Math.random() * PERF_MSGS.length); } while (idx === lastPerfMsg);
    lastPerfMsg = idx;
    const el = document.getElementById('perf-live-feedback');
    if (el) {
      el.style.animation = 'none';
      el.offsetHeight;
      el.style.animation = '';
      el.textContent = PERF_MSGS[idx];
    }
  }

  /* ── Pose-based metrics ─────────────────────── */
  function avgVelocity(frames, lmIdx) {
    if (frames.length < 2) return 0;
    let total = 0, count = 0;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i-1].poseLM;
      const b = frames[i].poseLM;
      if (!a || !b || !a[lmIdx] || !b[lmIdx]) continue;
      if (a[lmIdx].visibility < 0.3 || b[lmIdx].visibility < 0.3) continue;
      total += dist2D(a[lmIdx], b[lmIdx]);
      count++;
    }
    return count ? total / count : 0;
  }

  function maxVelocity(frames, lmIdx) {
    if (frames.length < 2) return 0;
    let max = 0;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i-1].poseLM, b = frames[i].poseLM;
      if (!a || !b || !a[lmIdx] || !b[lmIdx]) continue;
      if (a[lmIdx].visibility < 0.3 || b[lmIdx].visibility < 0.3) continue;
      max = Math.max(max, dist2D(a[lmIdx], b[lmIdx]));
    }
    return max;
  }

  function calcHandSpeed(frames) {
    const lAvg = avgVelocity(frames, LM.L_WRIST);
    const rAvg = avgVelocity(frames, LM.R_WRIST);
    const lMax = maxVelocity(frames, LM.L_WRIST);
    const rMax = maxVelocity(frames, LM.R_WRIST);
    const avg = Math.max(lAvg, rAvg);
    const peak = Math.max(lMax, rMax);
    return norm((avg * 0.5 + peak * 0.5), 0.005, 0.08);
  }

  function calcArmExtension(frames) {
    let maxExt = 0;
    frames.forEach(f => {
      if (!f.poseLM) return;
      const lm = f.poseLM;
      const torsoH = dist2D(lm[LM.L_SHOULDER], lm[LM.L_HIP]);
      if (!torsoH || lm[LM.L_SHOULDER].visibility < 0.4) return;
      const lExt = dist2D(lm[LM.L_SHOULDER], lm[LM.L_WRIST]);
      const rExt = dist2D(lm[LM.R_SHOULDER], lm[LM.R_WRIST]);
      maxExt = Math.max(maxExt, Math.max(lExt, rExt) / torsoH);
    });
    return norm(maxExt, 0.5, 1.8);
  }

  function calcBodyMovement(frames) {
    if (frames.length < 2) return 0;
    let total = 0, count = 0;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i-1].poseLM, b = frames[i].poseLM;
      if (!a || !b) continue;
      const aHip = { x:(a[LM.L_HIP].x+a[LM.R_HIP].x)/2, y:(a[LM.L_HIP].y+a[LM.R_HIP].y)/2 };
      const bHip = { x:(b[LM.L_HIP].x+b[LM.R_HIP].x)/2, y:(b[LM.L_HIP].y+b[LM.R_HIP].y)/2 };
      total += dist2D(aHip, bHip); count++;
    }
    const avg = count ? total / count : 0;
    return norm(avg, 0.001, 0.04);
  }

  function calcHeadMovement(frames) {
    const avg = avgVelocity(frames, LM.NOSE);
    const max = maxVelocity(frames, LM.NOSE);
    return norm(avg * 0.5 + max * 0.5, 0.003, 0.05);
  }

  function calcEnthusiasm(frames) {
    const keys = [LM.NOSE, LM.L_WRIST, LM.R_WRIST, LM.L_ELBOW, LM.R_ELBOW];
    let total = 0;
    keys.forEach(k => { total += avgVelocity(frames, k); });
    return norm(total / keys.length, 0.003, 0.05);
  }

  function calcDramaIndex(frames) {
    // Variability: peak / mean wrist velocity ratio
    if (frames.length < 3) return 0;
    const lVels = [], rVels = [];
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i-1].poseLM, b = frames[i].poseLM;
      if (!a || !b) continue;
      if (a[LM.L_WRIST] && b[LM.L_WRIST]) lVels.push(dist2D(a[LM.L_WRIST], b[LM.L_WRIST]));
      if (a[LM.R_WRIST] && b[LM.R_WRIST]) rVels.push(dist2D(a[LM.R_WRIST], b[LM.R_WRIST]));
    }
    const all = [...lVels, ...rVels];
    if (!all.length) return 0;
    const peak = Math.max(...all);
    const mean = all.reduce((a,b)=>a+b,0)/all.length;
    return norm(peak / (mean + 0.001), 1, 5);
  }

  /* ── Face mesh metrics during perf ─────────── */
  const L_MOUTH = 61, R_MOUTH = 291;
  const L_EYE_TOP = 159, L_EYE_BOT = 145, L_EYE_L = 33, L_EYE_R = 133;
  const R_EYE_TOP = 386, R_EYE_BOT = 374, R_EYE_L = 362, R_EYE_R = 263;
  const FOREHEAD = 10, CHIN = 152;
  const LIP_TOP_MID = 0, LIP_BOT_MID = 17;

  function calcFaceExpressiveness(frames) {
    if (!frames.length) return 0;
    let smileSum = 0, browSum = 0, count = 0;
    frames.forEach(f => {
      if (!f.faceLM) return;
      const lm = f.faceLM;
      const faceH = Math.hypot(lm[FOREHEAD].x - lm[CHIN].x, lm[FOREHEAD].y - lm[CHIN].y);
      if (!faceH) return;
      const mouthW = Math.hypot(lm[L_MOUTH].x - lm[R_MOUTH].x, lm[L_MOUTH].y - lm[R_MOUTH].y);
      smileSum += clamp01((mouthW / faceH - 0.28) / 0.22);
      count++;
    });
    return count ? clamp01(smileSum / count) : 0;
  }

  function calcMouthMovement(frames) {
    // Variability of mouth opening across frames
    if (frames.length < 2) return 0;
    const openings = frames.map(f => {
      if (!f.faceLM) return 0;
      const lm = f.faceLM;
      return Math.hypot(lm[LIP_TOP_MID].x - lm[LIP_BOT_MID].x,
                        lm[LIP_TOP_MID].y - lm[LIP_BOT_MID].y);
    });
    const mean = openings.reduce((a,b)=>a+b,0)/openings.length;
    const stddev = Math.sqrt(openings.reduce((a,b)=>a+(b-mean)**2,0)/openings.length);
    return norm(stddev, 0.001, 0.015);
  }

  function calcEyeWidening(frames) {
    if (!frames.length) return 0;
    let maxRatio = 0;
    frames.forEach(f => {
      if (!f.faceLM) return;
      const lm = f.faceLM;
      const lH = Math.hypot(lm[L_EYE_TOP].x-lm[L_EYE_BOT].x, lm[L_EYE_TOP].y-lm[L_EYE_BOT].y);
      const lW = Math.hypot(lm[L_EYE_L].x-lm[L_EYE_R].x, lm[L_EYE_L].y-lm[L_EYE_R].y);
      if (!lW) return;
      maxRatio = Math.max(maxRatio, lH/lW);
    });
    return norm(maxRatio, 0.2, 0.5);
  }

  /* ── Compute aggregate score ────────────────── */
  function computeAggregateScore(frames) {
    if (frames.length < 2) return 0;

    scores.handSpd   = calcHandSpeed(frames);
    scores.armExt    = calcArmExtension(frames);
    scores.body      = calcBodyMovement(frames);
    scores.head      = calcHeadMovement(frames);
    scores.enth      = calcEnthusiasm(frames);
    scores.drama     = calcDramaIndex(frames);
    scores.faceExpr  = calcFaceExpressiveness(frames);
    scores.mouthMvmt = calcMouthMovement(frames);
    scores.eyeWide   = calcEyeWidening(frames);
    // Confidence: combination of body + arm extension + enthusiasm
    scores.confidence = clamp01((scores.body + scores.armExt + scores.enth) / 3);

    const raw = (
      scores.handSpd   * 0.15 +
      scores.armExt    * 0.12 +
      scores.body      * 0.12 +
      scores.head      * 0.10 +
      scores.enth      * 0.15 +
      scores.drama     * 0.10 +
      scores.faceExpr  * 0.12 +
      scores.mouthMvmt * 0.07 +
      scores.eyeWide   * 0.07
    );

    return clamp01(raw + (Math.random() - 0.5) * 0.01);
  }

  /* ── EMA smooth ─────────────────────────────── */
  function updateSmoothed(raw) {
    const prev = smoothedScore;
    let next = prev * 0.8 + raw * 0.2;
    const delta = next - prev;
    next = prev + Math.max(-0.03, Math.min(0.03, delta));
    smoothedScore = clamp01(next);
    return smoothedScore;
  }

  /* ── Drawing ────────────────────────────────── */
  function drawPoseOverlay(canvas, lm) {
    if (!lm) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const W = canvas.width, H = canvas.height;

    const connections = [
      [LM.L_SHOULDER, LM.R_SHOULDER],
      [LM.L_SHOULDER, LM.L_ELBOW], [LM.L_ELBOW, LM.L_WRIST],
      [LM.R_SHOULDER, LM.R_ELBOW], [LM.R_ELBOW, LM.R_WRIST],
      [LM.L_SHOULDER, LM.L_HIP],   [LM.R_SHOULDER, LM.R_HIP],
      [LM.L_HIP, LM.R_HIP],
      [LM.L_HIP, LM.L_KNEE],       [LM.L_KNEE, LM.L_ANKLE],
      [LM.R_HIP, LM.R_KNEE],       [LM.R_KNEE, LM.R_ANKLE],
    ];

    const grad = ctx.createLinearGradient(0,0,W,H);
    grad.addColorStop(0,'rgba(255,39,119,0.7)');
    grad.addColorStop(1,'rgba(0,229,255,0.7)');

    connections.forEach(([a, b]) => {
      if (!lm[a] || !lm[b]) return;
      if (lm[a].visibility < 0.4 || lm[b].visibility < 0.4) return;
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lm[a].x * W, lm[a].y * H);
      ctx.lineTo(lm[b].x * W, lm[b].y * H);
      ctx.stroke();
    });

    // Joints
    const joints = [LM.L_SHOULDER,LM.R_SHOULDER,LM.L_ELBOW,LM.R_ELBOW,
                    LM.L_WRIST,LM.R_WRIST,LM.L_HIP,LM.R_HIP];
    joints.forEach(idx => {
      if (!lm[idx] || lm[idx].visibility < 0.4) return;
      ctx.beginPath();
      ctx.arc(lm[idx].x * W, lm[idx].y * H, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,229,255,0.8)';
      ctx.fill();
    });
  }

  function updateUI() {
    const pct = Math.round(smoothedScore * 100);
    const liveEl = document.getElementById('perf-score-live');
    if (liveEl) liveEl.textContent = pct + '%';
    const bar = document.getElementById('perf-progress-bar');
    if (bar) bar.style.width = pct + '%';
  }

  /* ── Init MediaPipe Pose (+ optional FaceMesh) ── */
  async function initPose() {
    const video  = document.getElementById('perf-video');
    const canvas = document.getElementById('perf-canvas');
    const hint   = document.getElementById('perf-hint');

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
      modelComplexity: 1, smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
    });

    // Also try to load FaceMesh for facial expression during banana challenge
    try {
      faceMesh = new FaceMesh({
        locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      });
      faceMesh.setOptions({
        maxNumFaces: 1, refineLandmarks: false,
        minDetectionConfidence: 0.4, minTrackingConfidence: 0.4,
      });
    } catch(e) { faceMesh = null; }

    let latestFaceLM = null;

    if (faceMesh) {
      faceMesh.onResults(res => {
        if (res.multiFaceLandmarks && res.multiFaceLandmarks.length > 0) {
          latestFaceLM = res.multiFaceLandmarks[0];
        }
      });
    }

    pose.onResults(results => {
      const canvas = document.getElementById('perf-canvas');
      if (!canvas) return;

      if (results.poseLandmarks) {
        if (capturing) {
          allFrames.push({
            poseLM: results.poseLandmarks,
            faceLM: latestFaceLM ? [...latestFaceLM] : null,
            timestamp: Date.now(),
          });

          // Live aggregate score (throttled: every 5 frames)
          if (allFrames.length % 5 === 0) {
            const raw = computeAggregateScore(allFrames);
            updateSmoothed(raw);
            updateUI();
            rotateFeedback();
          }
        }
        drawPoseOverlay(canvas, results.poseLandmarks);
      }
    });

    camera = new Camera(video, {
      onFrame: async () => {
        if (pose) await pose.send({ image: video });
        if (faceMesh && capturing) await faceMesh.send({ image: video });
      },
      width: 640, height: 480,
    });

    await camera.start();
    running = true;
    if (hint) hint.textContent = 'Step back — get your full body in frame';
    return true;
  }

  /* ── Challenge flow ─────────────────────────── */
  function startChallenge() {
    if (!running) return;
    const btn = document.getElementById('btn-perf-start');
    const timerOverlay = document.getElementById('perf-timer-overlay');
    const timerNum = document.getElementById('perf-timer-num');
    const hint = document.getElementById('perf-hint');
    const instructions = document.getElementById('perf-instructions');

    if (btn) btn.setAttribute('disabled', true);
    if (instructions) instructions.style.opacity = '0.5';

    // Countdown 3-2-1
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
    if (hint) hint.textContent = 'Maximum drama! React to the banana!';

    capturing = true;
    allFrames = [];
    smoothedScore = 0;
    liveScore = 0;

    let remaining = CHALLENGE_DURATION;
    if (timerNum) timerNum.textContent = remaining;

    const captureInterval = setInterval(() => {
      remaining--;
      if (timerNum) timerNum.textContent = remaining;
      if (remaining <= 0) { clearInterval(captureInterval); finishCapture(); }
    }, 1000);
  }

  function finishCapture() {
    capturing = false;
    done = true;

    const timerOverlay = document.getElementById('perf-timer-overlay');
    if (timerOverlay) timerOverlay.style.display = 'none';

    // Final aggregate score over all frames
    const finalRaw = computeAggregateScore(allFrames);
    smoothedScore = clamp01(finalRaw);
    perfScore = Math.max(0.25, smoothedScore);
    updateUI();

    const hint = document.getElementById('perf-hint');
    if (hint) hint.textContent = `✓ Performance captured — ${Math.round(perfScore * 100)}% energy`;

    if (camera) { try { camera.stop(); } catch(_) {} }
    if (camStream) camStream.getTracks().forEach(t => t.stop());

    setTimeout(() => { if (window.AppController) AppController.perfDone(); }, 600);
  }

  function startFallback() {
    done = true;
    scores.handSpd   = 0.40 + Math.random() * 0.45;
    scores.armExt    = 0.35 + Math.random() * 0.45;
    scores.body      = 0.30 + Math.random() * 0.50;
    scores.head      = 0.40 + Math.random() * 0.40;
    scores.enth      = 0.35 + Math.random() * 0.45;
    scores.drama     = 0.38 + Math.random() * 0.45;
    scores.faceExpr  = 0.40 + Math.random() * 0.40;
    scores.mouthMvmt = 0.35 + Math.random() * 0.45;
    scores.eyeWide   = 0.38 + Math.random() * 0.40;
    scores.confidence = 0.40 + Math.random() * 0.40;
    perfScore = clamp01(
      scores.handSpd * 0.15 + scores.armExt  * 0.12 + scores.body      * 0.12 +
      scores.head    * 0.10 + scores.enth     * 0.15 + scores.drama     * 0.10 +
      scores.faceExpr* 0.12 + scores.mouthMvmt * 0.07 + scores.eyeWide * 0.07
    );
    smoothedScore = perfScore;
    updateUI();
    setTimeout(() => { if (window.AppController) AppController.perfDone(); }, 1500);
  }

  /* ── Public API ─────────────────────────────── */
  async function start() {
    const ok = await initPose();
    if (!ok) startFallback();
  }

  function triggerChallenge() { startChallenge(); }

  function getPerfScore() {
    return Math.max(25, Math.round(perfScore * 100));
  }

  function getTopInsights() {
    const insights = [
      { label: 'Excellent gesture usage',         val: scores.handSpd   },
      { label: 'Strong facial expressiveness',     val: scores.faceExpr  },
      { label: 'High confidence score',            val: scores.confidence },
      { label: 'Dramatic arm extension detected',  val: scores.armExt    },
      { label: 'Energetic body movement',          val: scores.body      },
      { label: 'Animated head movement',           val: scores.head      },
      { label: 'Peak drama index recorded',        val: scores.drama     },
      { label: 'Wide-eyed reaction captured',      val: scores.eyeWide   },
      { label: 'Enthusiastic overall energy',      val: scores.enth      },
    ];
    insights.sort((a, b) => b.val - a.val);
    return insights.slice(0, 3).map(i => i.label);
  }

  function getSubScores() {
    return {
      handSpd:  Math.round(scores.handSpd   * 100),
      armExt:   Math.round(scores.armExt    * 100),
      body:     Math.round(scores.body      * 100),
      head:     Math.round(scores.head      * 100),
      enth:     Math.round(scores.enth      * 100),
      drama:    Math.round(scores.drama     * 100),
    };
  }

  return { start, triggerChallenge, getPerfScore, getSubScores, getTopInsights };
})();
