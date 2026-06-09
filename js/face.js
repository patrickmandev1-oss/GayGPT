/* ═══════════════════════════════════════════════
   js/face.js — MediaPipe FaceMesh live face analysis
═══════════════════════════════════════════════ */

const FaceScanner = (() => {
  let faceMesh = null;
  let camera = null;
  let camStream = null;
  let running = false;
  let locked = false;

  /* rolling average window for stability */
  const WINDOW = 8;
  const hist = { smile: [], brow: [], eye: [], tilt: [], asym: [], expr: [] };

  /* current live scores */
  const scores = { smile: 0, brow: 0, eye: 0, tilt: 0, asym: 0, expr: 0 };
  let faceScore = 0;
  let framesWithFace = 0;
  let totalFrames = 0;

  /* ── MediaPipe landmark indices ─────────────────── */
  // Mouth corners
  const L_MOUTH = 61, R_MOUTH = 291;
  const MOUTH_TOP = 13, MOUTH_BOT = 14;
  // Eyebrows inner/outer
  const L_BROW_INNER = 107, L_BROW_OUTER = 55;
  const R_BROW_INNER = 336, R_BROW_OUTER = 285;
  // Eye landmarks (upper/lower lids)
  const L_EYE_TOP = 159, L_EYE_BOT = 145, L_EYE_L = 33, L_EYE_R = 133;
  const R_EYE_TOP = 386, R_EYE_BOT = 374, R_EYE_L = 362, R_EYE_R = 263;
  // Nose tip + face bounds
  const NOSE_TIP = 1;
  const FOREHEAD = 10; // top of face
  const CHIN = 152;    // bottom of face

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function rollingAvg(arr, val) {
    arr.push(val);
    if (arr.length > WINDOW) arr.shift();
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /* ── Score calculations ─────────────────────────── */

  /** Smile: ratio of mouth width to face height */
  function calcSmile(lm) {
    const mouthW = dist(lm[L_MOUTH], lm[R_MOUTH]);
    const faceH = dist(lm[FOREHEAD], lm[CHIN]);
    if (!faceH) return 0;
    // baseline neutral ~0.35, big smile ~0.5+
    const raw = (mouthW / faceH - 0.30) / 0.20;
    return clamp01(raw);
  }

  /** Eyebrow raise: distance of brow landmarks above eye */
  function calcBrow(lm) {
    const faceH = dist(lm[FOREHEAD], lm[CHIN]);
    if (!faceH) return 0;
    const lBrowY = (lm[L_BROW_INNER].y + lm[L_BROW_OUTER].y) / 2;
    const rBrowY = (lm[R_BROW_INNER].y + lm[R_BROW_OUTER].y) / 2;
    const lEyeY = (lm[L_EYE_TOP].y + lm[L_EYE_BOT].y) / 2;
    const rEyeY = (lm[R_EYE_TOP].y + lm[R_EYE_BOT].y) / 2;
    const lGap = (lEyeY - lBrowY) / faceH;
    const rGap = (rEyeY - rBrowY) / faceH;
    const avg = (lGap + rGap) / 2;
    // neutral ~0.06, raised ~0.10+
    const raw = (avg - 0.05) / 0.06;
    return clamp01(raw);
  }

  /** Eye openness: vertical eye opening relative to horizontal width */
  function calcEyeOpen(lm) {
    const lH = dist(lm[L_EYE_TOP], lm[L_EYE_BOT]);
    const lW = dist(lm[L_EYE_L], lm[L_EYE_R]);
    const rH = dist(lm[R_EYE_TOP], lm[R_EYE_BOT]);
    const rW = dist(lm[R_EYE_L], lm[R_EYE_R]);
    if (!lW || !rW) return 0;
    const lRatio = lH / lW;
    const rRatio = rH / rW;
    const avg = (lRatio + rRatio) / 2;
    // normal ~0.28, wide-eyed ~0.40+
    const raw = (avg - 0.22) / 0.18;
    return clamp01(raw);
  }

  /** Head tilt: angle of line between eyes vs horizontal */
  function calcHeadTilt(lm) {
    const lEye = { x: (lm[L_EYE_L].x + lm[L_EYE_R].x) / 2, y: (lm[L_EYE_L].y + lm[L_EYE_R].y) / 2 };
    const rEye = { x: (lm[R_EYE_L].x + lm[R_EYE_R].x) / 2, y: (lm[R_EYE_L].y + lm[R_EYE_R].y) / 2 };
    const angle = Math.abs(Math.atan2(rEye.y - lEye.y, rEye.x - lEye.x) * 180 / Math.PI);
    // 0° = perfectly level; fun tilt ~8-20°
    const raw = angle / 18;
    return clamp01(raw);
  }

  /** Facial asymmetry: difference between left/right smile and brow */
  function calcAsymmetry(lm) {
    const faceH = dist(lm[FOREHEAD], lm[CHIN]);
    if (!faceH) return 0;
    // compare left vs right mouth corner heights
    const mouthDiff = Math.abs(lm[L_MOUTH].y - lm[R_MOUTH].y) / faceH;
    // compare left vs right brow heights
    const lBrowY = (lm[L_BROW_INNER].y + lm[L_BROW_OUTER].y) / 2;
    const rBrowY = (lm[R_BROW_INNER].y + lm[R_BROW_OUTER].y) / 2;
    const browDiff = Math.abs(lBrowY - rBrowY) / faceH;
    const raw = (mouthDiff + browDiff * 2) / 0.06;
    return clamp01(raw);
  }

  /**
   * Expressiveness: compound: high values of any sub-metric
   * means the face is doing something interesting
   */
  function calcExpressiveness(smile, brow, eye, tilt, asym) {
    // Weighted combination of sub-scores — faces that are animated score high
    return clamp01(smile * 0.25 + brow * 0.25 + eye * 0.20 + tilt * 0.15 + asym * 0.15);
  }

  /** Final face energy score */
  function calcFaceScore(smile, brow, eye, tilt, asym, expr) {
    // Weight tuned to give interesting range
    const raw = (
      smile * 0.25 +
      brow  * 0.18 +
      eye   * 0.15 +
      tilt  * 0.12 +
      asym  * 0.10 +
      expr  * 0.20
    );
    // Add small noise so score feels alive
    const noise = (Math.random() - 0.5) * 0.02;
    return clamp01(raw + noise);
  }

  /* ── Drawing helpers ────────────────────────────── */
  function drawOverlay(canvas, lm, scoreVal) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!lm || !lm.length) return;

    const W = canvas.width, H = canvas.height;

    // Draw face mesh (sparse subset for performance)
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.18)';
    ctx.lineWidth = 0.7;
    const FACE_OUTLINE = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,10];
    ctx.beginPath();
    FACE_OUTLINE.forEach((i, idx) => {
      if (!lm[i]) return;
      const x = lm[i].x * W;
      const y = lm[i].y * H;
      idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();

    // Eye highlights
    [[L_EYE_L, L_EYE_R, L_EYE_TOP, L_EYE_BOT], [R_EYE_L, R_EYE_R, R_EYE_TOP, R_EYE_BOT]].forEach(pts => {
      ctx.strokeStyle = 'rgba(61, 228, 255, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach((i, idx) => {
        const x = lm[i].x * W, y = lm[i].y * H;
        idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    });

    // Score overlay text on canvas
    const pct = Math.round(scoreVal * 100);
    ctx.font = 'bold 15px Syne, sans-serif';
    ctx.fillStyle = 'rgba(0,229,255,0.85)';
    ctx.fillText(`⚡ ${pct}%`, 10, H - 10);
  }

  /* ── Public API ─────────────────────────────────── */
  function updateUI() {
    const pct = v => Math.round(v * 100);
    const setBar = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.style.width = (v * 100) + '%';
    };
    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = pct(v) + '%';
    };

    setBar('bar-smile', scores.smile); setVal('val-smile', scores.smile);
    setBar('bar-brow',  scores.brow);  setVal('val-brow',  scores.brow);
    setBar('bar-eye',   scores.eye);   setVal('val-eye',   scores.eye);
    setBar('bar-tilt',  scores.tilt);  setVal('val-tilt',  scores.tilt);
    setBar('bar-asym',  scores.asym);  setVal('val-asym',  scores.asym);
    setBar('bar-expr',  scores.expr);  setVal('val-expr',  scores.expr);

    const scoreEl = document.getElementById('face-score-live');
    if (scoreEl) scoreEl.textContent = Math.round(faceScore * 100) + '%';

    // Enable lock button once we have a face
    const lockBtn = document.getElementById('btn-lock-face');
    if (lockBtn && framesWithFace > 5) {
      lockBtn.removeAttribute('disabled');
    }
  }

  async function start() {
    const video = document.getElementById('face-video');
    const canvas = document.getElementById('face-canvas');
    const hint = document.getElementById('face-hint');

    if (hint) hint.textContent = 'Requesting camera…';

    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      video.srcObject = camStream;
      await video.play();
    } catch (e) {
      if (hint) hint.textContent = '⚠ Camera denied — score estimated';
      startFallback();
      return;
    }

    // Match canvas size to video
    video.addEventListener('loadedmetadata', () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    });

    if (hint) hint.textContent = 'Loading FaceMesh model…';

    faceMesh = new FaceMesh({
      locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    faceMesh.onResults(results => {
      if (locked) return;
      totalFrames++;

      const canvas = document.getElementById('face-canvas');
      if (!canvas) return;

      if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        framesWithFace++;
        const lm = results.multiFaceLandmarks[0];

        const smileRaw = calcSmile(lm);
        const browRaw  = calcBrow(lm);
        const eyeRaw   = calcEyeOpen(lm);
        const tiltRaw  = calcHeadTilt(lm);
        const asymRaw  = calcAsymmetry(lm);
        const exprRaw  = calcExpressiveness(smileRaw, browRaw, eyeRaw, tiltRaw, asymRaw);

        scores.smile = rollingAvg(hist.smile, smileRaw);
        scores.brow  = rollingAvg(hist.brow, browRaw);
        scores.eye   = rollingAvg(hist.eye, eyeRaw);
        scores.tilt  = rollingAvg(hist.tilt, tiltRaw);
        scores.asym  = rollingAvg(hist.asym, asymRaw);
        scores.expr  = rollingAvg(hist.expr, exprRaw);

        faceScore = calcFaceScore(scores.smile, scores.brow, scores.eye, scores.tilt, scores.asym, scores.expr);

        drawOverlay(canvas, lm, faceScore);

        if (hint) hint.textContent = `Analyzing… ${Math.round(faceScore * 100)}% face energy`;
      } else {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (hint) hint.textContent = 'No face detected — centre your face';
      }

      updateUI();
    });

    camera = new Camera(video, {
      onFrame: async () => { if (!locked) await faceMesh.send({ image: video }); },
      width: 640, height: 480,
    });

    camera.start().then(() => {
      if (hint) hint.textContent = 'Scanning… express yourself!';
      running = true;
    });
  }

  /* Fallback when no camera */
  function startFallback() {
    running = true;
    const interval = setInterval(() => {
      if (locked) { clearInterval(interval); return; }
      scores.smile = rollingAvg(hist.smile, 0.45 + Math.random() * 0.3);
      scores.brow  = rollingAvg(hist.brow,  0.40 + Math.random() * 0.35);
      scores.eye   = rollingAvg(hist.eye,   0.35 + Math.random() * 0.4);
      scores.tilt  = rollingAvg(hist.tilt,  0.30 + Math.random() * 0.4);
      scores.asym  = rollingAvg(hist.asym,  0.25 + Math.random() * 0.45);
      scores.expr  = rollingAvg(hist.expr,  0.40 + Math.random() * 0.35);
      faceScore = calcFaceScore(scores.smile, scores.brow, scores.eye, scores.tilt, scores.asym, scores.expr);
      framesWithFace = 10;
      updateUI();
    }, 200);
  }

  function stop() {
    locked = true;
    if (camera) { try { camera.stop(); } catch(_) {} }
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); }
    if (faceMesh) { try { faceMesh.close(); } catch(_) {} }
  }

  function getFaceScore() {
    // Return 0-100 integer, minimum 30 for fun
    return Math.max(30, Math.round(faceScore * 100));
  }

  function getSubScores() {
    return {
      smile: Math.round(scores.smile * 100),
      brow:  Math.round(scores.brow  * 100),
      eye:   Math.round(scores.eye   * 100),
      tilt:  Math.round(scores.tilt  * 100),
      asym:  Math.round(scores.asym  * 100),
      expr:  Math.round(scores.expr  * 100),
    };
  }

  return { start, stop, getFaceScore, getSubScores };
})();
