/* ═══════════════════════════════════════════════
   js/results.js — Results screen rendering
   Weighting: Face 40%, Voice 25%, Perf 35%
═══════════════════════════════════════════════ */

const ResultsDisplay = (() => {

  /* ── Verdict system ─────────────────────────── */
  function getVerdict(score) {
    if (score <= 20) return { emoji: '🏈', text: 'Certified Straight' };
    if (score <= 40) return { emoji: '🤔', text: 'Mostly Straight' };
    if (score <= 60) return { emoji: '🌀', text: 'Questioning Arc Detected' };
    if (score <= 80) return { emoji: '🌈', text: 'Suspicious Levels Detected' };
    return { emoji: '✨', text: 'Rainbow Energy Maximum' };
  }

  /* ── Note lines (kept generic) ──────────────── */
  function faceNote(s)  {
    if (s >= 75) return 'Exceptional facial energy recorded.';
    if (s >= 55) return 'Above-average presentation metrics.';
    if (s >= 35) return 'Moderate face energy detected.';
    return 'Low facial energy — try smiling next time.';
  }
  function voiceNote(s) {
    if (s >= 75) return 'Highly expressive vocal delivery.';
    if (s >= 55) return 'Above-average voice energy.';
    if (s >= 35) return 'Moderate vocal expression detected.';
    return 'Low voice energy — more drama needed.';
  }
  function perfNote(s) {
    if (s >= 75) return 'Exceptional performance captured.';
    if (s >= 55) return 'Strong performance energy logged.';
    if (s >= 35) return 'Moderate performance detected.';
    return 'Low performance — more banana energy needed.';
  }

  /* ── Animations ─────────────────────────────── */
  function animateCount(el, target, duration) {
    duration = duration || 1200;
    let start = 0;
    const step = Math.ceil(target / (duration / 30));
    const interval = setInterval(() => {
      start = Math.min(start + step, target);
      el.textContent = start + '%';
      if (start >= target) clearInterval(interval);
    }, 30);
  }

  function animateBar(el, target, delay) {
    setTimeout(() => { el.style.width = target + '%'; }, delay || 0);
  }

  function animateRing(ringEl, score, circumference) {
    const offset = circumference * (1 - score / 100);
    setTimeout(() => { ringEl.style.strokeDashoffset = offset.toString(); }, 300);
  }

  /* ── Confetti ───────────────────────────────── */
  function launchConfetti() {
    const container = document.getElementById('confetti-container');
    if (!container) return;
    const colors = ['#ff2777','#b44bff','#00e5ff','#ffe556','#39ff9a','#ff9900'];
    for (let i = 0; i < 90; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.width  = (6 + Math.random() * 8) + 'px';
      piece.style.height = (6 + Math.random() * 8) + 'px';
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      const duration = 2.5 + Math.random() * 2;
      const delay = Math.random() * 1.5;
      piece.style.animation = `confettiFall ${duration}s ${delay}s linear forwards`;
      container.appendChild(piece);
      setTimeout(() => piece.remove(), (duration + delay + 0.2) * 1000);
    }
  }

  /* ── Insights list ──────────────────────────── */
  function renderInsights(containerId, insights) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    insights.forEach(text => {
      const el = document.createElement('div');
      el.className = 'insight-item';
      el.textContent = text;
      container.appendChild(el);
    });
  }

  /* ── Share card via Canvas ──────────────────── */
  function buildShareCard(total, faceScore, voiceScore, perfScore, verdict) {
    const canvas = document.getElementById('share-canvas');
    if (!canvas) return null;

    const W = 560, H = 320;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#080810';
    ctx.fillRect(0, 0, W, H);

    // Gradient overlay
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, 'rgba(255,39,119,0.12)');
    bg.addColorStop(0.5, 'rgba(180,75,255,0.08)');
    bg.addColorStop(1, 'rgba(0,229,255,0.10)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, W-2, H-2);

    // Logo
    const logoGrad = ctx.createLinearGradient(0, 0, 200, 0);
    logoGrad.addColorStop(0, '#ff2777');
    logoGrad.addColorStop(0.5, '#b44bff');
    logoGrad.addColorStop(1, '#00e5ff');
    ctx.fillStyle = logoGrad;
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('GayGPT™', 30, 48);

    ctx.fillStyle = 'rgba(240,238,255,0.4)';
    ctx.font = '12px monospace';
    ctx.fillText('ADVANCED GAYDAR SCANNER', 30, 66);

    // Big score
    const scoreGrad = ctx.createLinearGradient(300, 20, 530, 100);
    scoreGrad.addColorStop(0, '#ff2777');
    scoreGrad.addColorStop(1, '#b44bff');
    ctx.fillStyle = scoreGrad;
    ctx.font = 'bold 72px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(total + '%', W - 30, 90);
    ctx.fillStyle = 'rgba(240,238,255,0.5)';
    ctx.font = '12px monospace';
    ctx.fillText('GAYGPT SCORE', W - 30, 108);
    ctx.textAlign = 'left';

    // Divider
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(30, 120); ctx.lineTo(W-30, 120); ctx.stroke();

    // Sub scores
    const subs = [
      { label: 'Face Energy',   val: faceScore  + '%', color: '#ff2777' },
      { label: 'Voice Energy',  val: voiceScore + '%', color: '#b44bff' },
      { label: 'Performance',   val: perfScore  + '%', color: '#00e5ff' },
    ];
    subs.forEach((s, i) => {
      const x = 30 + i * 170;
      ctx.fillStyle = s.color;
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(s.val, x, 160);
      ctx.fillStyle = 'rgba(240,238,255,0.45)';
      ctx.font = '11px monospace';
      ctx.fillText(s.label.toUpperCase(), x, 178);
    });

    // Verdict
    ctx.fillStyle = '#ffe556';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('"' + verdict.text + '"', 30, 220);

    // Verdict emoji
    ctx.font = '24px serif';
    ctx.fillText(verdict.emoji, W - 70, 220);

    // Divider
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.moveTo(30, 240); ctx.lineTo(W-30, 240); ctx.stroke();

    // Footer
    ctx.fillStyle = 'rgba(240,238,255,0.35)';
    ctx.font = '12px monospace';
    ctx.fillText('Test yourself at: https://gaygpt.com  •  Entertainment only', 30, 265);

    return canvas;
  }

  /* ── Main render ────────────────────────────── */
  function render(faceScore, voiceScore, perfScore) {
    // Weighting: Face 40%, Voice 25%, Performance 35%
    const total = Math.round(faceScore * 0.40 + voiceScore * 0.25 + perfScore * 0.35);

    // Ring + score counter
    const ringEl = document.getElementById('ring-fill-big');
    const pctEl  = document.getElementById('results-pct');
    if (ringEl) animateRing(ringEl, total, 552.9);
    if (pctEl)  setTimeout(() => animateCount(pctEl, total), 400);

    // Breakdown bars + scores
    [
      ['res-face-bar',  faceScore,  500, 'var(--pink)'],
      ['res-voice-bar', voiceScore, 650, 'var(--purple)'],
      ['res-perf-bar',  perfScore,  800, 'var(--blue)'],
    ].forEach(([id, val, delay]) => animateBar(document.getElementById(id), val, delay));

    const faceScoreEl  = document.getElementById('res-face-score');
    const voiceScoreEl = document.getElementById('res-voice-score');
    const perfScoreEl  = document.getElementById('res-perf-score');
    if (faceScoreEl)  { faceScoreEl.textContent  = faceScore  + '%'; faceScoreEl.style.color  = 'var(--pink)'; }
    if (voiceScoreEl) { voiceScoreEl.textContent = voiceScore + '%'; voiceScoreEl.style.color = 'var(--purple)'; }
    if (perfScoreEl)  { perfScoreEl.textContent  = perfScore  + '%'; perfScoreEl.style.color  = 'var(--blue)'; }

    // Top insights (from scanners)
    const faceInsights  = window.FaceScanner  ? FaceScanner.getTopInsights()  : ['Strong facial symmetry','Expressive smile','High eye contact'];
    const voiceInsights = window.VoiceScanner ? VoiceScanner.getTopInsights() : ['High vocal expressiveness','Strong pitch variation','Animated delivery'];
    const perfInsights  = window.PerfScanner  ? PerfScanner.getTopInsights()  : ['Excellent gesture usage','Strong facial expressiveness','High confidence score'];

    renderInsights('res-face-insights',  faceInsights);
    renderInsights('res-voice-insights', voiceInsights);
    renderInsights('res-perf-insights',  perfInsights);

    // Verdict
    const verdict = getVerdict(total);
    const emojiEl = document.getElementById('verdict-emoji');
    const textEl  = document.getElementById('verdict-text');
    if (emojiEl) emojiEl.textContent = verdict.emoji;
    if (textEl)  textEl.textContent  = verdict.text;

    // Confetti if >80%
    if (total > 80) setTimeout(launchConfetti, 800);

    // Roasts
    const roastList = document.getElementById('roast-list');
    if (roastList) {
      roastList.innerHTML = '';
      pickRoasts(total, 6).forEach((r, i) => {
        const el = document.createElement('div');
        el.className = 'roast-item';
        el.style.animationDelay = (0.3 + i * 0.08) + 's';
        el.textContent = '· ' + r;
        roastList.appendChild(el);
      });
    }

    // Build share card (hidden canvas)
    const shareCanvas = buildShareCard(total, faceScore, voiceScore, perfScore, verdict);

    // Share URL suffix
    const SITE_URL = 'https://gaygpt.com';

    // Download card button
    const dlBtn = document.getElementById('btn-download-card');
    if (dlBtn && shareCanvas) {
      dlBtn.addEventListener('click', () => {
        shareCanvas.toBlob(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'gaygpt-result.png'; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
      });
    }

    // Copy results
    const copyBtn = document.getElementById('btn-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const text =
`🏳️‍🌈 GAYDAR SCANNER™ v2 RESULTS

GayGPT Score: ${total}%

Face Energy:        ${faceScore}%
Voice Energy:       ${voiceScore}%
Performance Energy: ${perfScore}%

Verdict: "${verdict.text}"

Test yourself at: ${SITE_URL}
For entertainment only`;
        navigator.clipboard?.writeText(text).then(() => {
          const orig = copyBtn.textContent;
          copyBtn.textContent = '✅ Copied!';
          setTimeout(() => { copyBtn.textContent = orig; }, 2000);
        }).catch(() => { alert(text); });
      });
    }

    return total;
  }

  return { render };
})();
