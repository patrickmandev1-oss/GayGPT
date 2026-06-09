/* ═══════════════════════════════════════════════
   js/results.js — Results screen rendering
═══════════════════════════════════════════════ */

const ResultsDisplay = (() => {

  function animateCount(el, target, duration = 1200) {
    let start = 0;
    const step = Math.ceil(target / (duration / 30));
    const interval = setInterval(() => {
      start = Math.min(start + step, target);
      el.textContent = start + '%';
      if (start >= target) clearInterval(interval);
    }, 30);
  }

  function animateBar(el, target, delay = 0) {
    setTimeout(() => { el.style.width = target + '%'; }, delay);
  }

  function animateRing(ringEl, score, circumference) {
    const offset = circumference * (1 - score / 100);
    setTimeout(() => {
      ringEl.style.strokeDashoffset = offset.toString();
    }, 300);
  }

  function render(faceScore, voiceScore, perfScore) {
    // Final combined score
    const total = Math.round(faceScore * 0.40 + voiceScore * 0.30 + perfScore * 0.30);

    // ── Main ring & score ──
    const ringEl = document.getElementById('ring-fill-big');
    const pctEl  = document.getElementById('results-pct');
    if (ringEl) animateRing(ringEl, total, 552.9);
    if (pctEl)  setTimeout(() => animateCount(pctEl, total), 400);

    // ── Breakdown bars ──
    const faceBarEl  = document.getElementById('res-face-bar');
    const voiceBarEl = document.getElementById('res-voice-bar');
    const perfBarEl  = document.getElementById('res-perf-bar');

    if (faceBarEl)  animateBar(faceBarEl,  faceScore,  500);
    if (voiceBarEl) animateBar(voiceBarEl, voiceScore, 650);
    if (perfBarEl)  animateBar(perfBarEl,  perfScore,  800);

    // ── Breakdown scores ──
    const faceScoreEl  = document.getElementById('res-face-score');
    const voiceScoreEl = document.getElementById('res-voice-score');
    const perfScoreEl  = document.getElementById('res-perf-score');

    if (faceScoreEl)  { faceScoreEl.textContent  = faceScore  + '%'; faceScoreEl.style.color  = 'var(--pink)'; }
    if (voiceScoreEl) { voiceScoreEl.textContent = voiceScore + '%'; voiceScoreEl.style.color = 'var(--purple)'; }
    if (perfScoreEl)  { perfScoreEl.textContent  = perfScore  + '%'; perfScoreEl.style.color  = 'var(--blue)'; }

    // ── Breakdown notes ──
    const faceNotesEl  = document.getElementById('res-face-notes');
    const voiceNotesEl = document.getElementById('res-voice-notes');
    const perfNotesEl  = document.getElementById('res-perf-notes');

    if (faceNotesEl)  faceNotesEl.textContent  = faceNote(faceScore);
    if (voiceNotesEl) voiceNotesEl.textContent = voiceNote(voiceScore);
    if (perfNotesEl)  perfNotesEl.textContent  = perfNote(perfScore);

    // ── Verdict ──
    const verdict = getVerdict(total);
    const emojiEl = document.getElementById('verdict-emoji');
    const textEl  = document.getElementById('verdict-text');
    if (emojiEl) emojiEl.textContent = verdict.emoji;
    if (textEl)  textEl.textContent  = verdict.text;

    // ── Roasts ──
    const roastList = document.getElementById('roast-list');
    if (roastList) {
      roastList.innerHTML = '';
      pickRoasts(total, 7).forEach((r, i) => {
        const el = document.createElement('div');
        el.className = 'roast-item';
        el.style.animationDelay = (0.3 + i * 0.08) + 's';
        el.textContent = '· ' + r;
        roastList.appendChild(el);
      });
    }

    // ── Share card ──
    const scScore   = document.getElementById('sc-score');
    const scFace    = document.getElementById('sc-face');
    const scVoice   = document.getElementById('sc-voice');
    const scPerf    = document.getElementById('sc-perf');
    const scVerdict = document.getElementById('sc-verdict');

    if (scScore)   scScore.textContent   = total + '%';
    if (scFace)    scFace.textContent    = faceScore + '%';
    if (scVoice)   scVoice.textContent   = voiceScore + '%';
    if (scPerf)    scPerf.textContent    = perfScore + '%';
    if (scVerdict) scVerdict.textContent = '"' + verdict.text + '"';

    // ── Copy button ──
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

Try it yourself • For entertainment only`;
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
