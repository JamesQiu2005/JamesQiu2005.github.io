/* ============================================================
   邱瀚泽 · 个人作品集 — main.js
   RFC-001 §6.1：原生 JS，无依赖。
   滚动渐入（IO）· G-D-A-E 调弦模式
   ============================================================ */

(function () {
  'use strict';

  /* ---------- 1. 滚动渐入 ---------- */

  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry, i) {
        if (entry.isIntersecting) {
          // stagger ≤ 120ms（RFC §5.3）
          entry.target.style.transitionDelay = Math.min(i * 60, 120) + 'ms';
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- 2. 彩蛋：依次按 G-D-A-E 进入调弦模式 10 秒 ---------- */

  var seq = [];
  var target = ['g', 'd', 'a', 'e'];
  var tuningTimer = null;

  window.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    seq.push(e.key.toLowerCase());
    if (seq.length > target.length) seq.shift();
    if (seq.join('') === target.join('')) {
      document.body.classList.add('tuning-mode');
      clearTimeout(tuningTimer);
      tuningTimer = setTimeout(function () {
        document.body.classList.remove('tuning-mode');
      }, 10000);
      seq = [];
    }
  });

  /* ---------- 3. 琴弦波形 hover 振幅（抽象视觉） ---------- */

  var wave = document.querySelector('.string-wave path');
  if (wave) {
    var calm = wave.getAttribute('d');
    var excited = wave.getAttribute('data-excited');
    var wrap = wave.parentElement;
    if (excited && wrap) {
      wrap.addEventListener('mouseenter', function () { wave.setAttribute('d', excited); });
      wrap.addEventListener('mouseleave', function () { wave.setAttribute('d', calm); });
    }
  }
})();
