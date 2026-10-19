/* ===========================================================================
   FiberOS - realistic 3D orientation + smooth motion enhancer
   ---------------------------------------------------------------------------
   CSP-safe: uses classList, setAttribute and the CSSOM only. No eval, no new
   Function, no inline markup, no network access. If any capability is missing
   the corresponding feature is skipped and the stylesheet keeps its static,
   fully usable presentation.

   Responsibilities
     * pointer-tracked tilt + specular position on 3D surfaces (fine pointers)
     * scroll reveal fallback where CSS scroll timelines are unavailable
     * View Transitions for in-page section navigation
     * re-binding for server-rendered and late-injected content
   Everything is inert under prefers-reduced-motion: reduce.
   =========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var SURFACES = '.panel, .card, .metric, .fo-surface';
  var TILT_DEG = 4.2;
  var REVEAL_SAFETY_MS = 2600;

  function mq(query) {
    return window.matchMedia ? window.matchMedia(query) : null;
  }
  var reduceMq = mq('(prefers-reduced-motion: reduce)');
  var fineMq = mq('(hover: hover) and (pointer: fine)');

  function reduced() { return !!(reduceMq && reduceMq.matches); }
  function finePointer() { return !!(fineMq && fineMq.matches); }
  function clamp(value, low, high) {
    return value < low ? low : (value > high ? high : value);
  }

  root.classList.add('fo-js');

  /* -- 1. Pointer-tracked orientation and specular position -------------- */
  function onPointerMove(ev) {
    if (reduced() || !finePointer()) return;
    var el = ev.currentTarget;
    var box = el.getBoundingClientRect();
    if (!box.width || !box.height) return;
    var px = clamp((ev.clientX - box.left) / box.width, 0, 1);
    var py = clamp((ev.clientY - box.top) / box.height, 0, 1);
    var style = el.style;
    style.setProperty('--fo-mx', (px * 100).toFixed(2) + '%');
    style.setProperty('--fo-my', (py * 100).toFixed(2) + '%');
    style.setProperty('--fo-ry', ((px - 0.5) * 2 * TILT_DEG).toFixed(2) + 'deg');
    style.setProperty('--fo-rx', ((0.5 - py) * 2 * TILT_DEG).toFixed(2) + 'deg');
  }

  function resetSurface(ev) {
    var style = ev.currentTarget.style;
    style.removeProperty('--fo-rx');
    style.removeProperty('--fo-ry');
    style.removeProperty('--fo-mx');
    style.removeProperty('--fo-my');
  }

  function trackSurface(el) {
    if (el.getAttribute('data-fo-3d') === '1') return;
    el.setAttribute('data-fo-3d', '1');
    el.classList.add('fo-3d');
    el.addEventListener('pointermove', onPointerMove, { passive: true });
    el.addEventListener('pointerleave', resetSurface, { passive: true });
    el.addEventListener('pointercancel', resetSurface, { passive: true });
  }

  function bindSurfaces() {
    if (reduced() || !finePointer()) return;
    var nodes = doc.querySelectorAll(SURFACES);
    for (var i = 0; i < nodes.length; i += 1) trackSurface(nodes[i]);
  }

  /* -- 2. Scroll reveal fallback ----------------------------------------- */
  var revealObserver = null;

  function scrollTimelineSupported() {
    return !!(window.CSS && window.CSS.supports &&
      window.CSS.supports('animation-timeline: view()'));
  }

  function forceReveal() {
    var pending = doc.querySelectorAll('.fo-reveal:not(.fo-in)');
    for (var i = 0; i < pending.length; i += 1) pending[i].classList.add('fo-in');
  }

  function bindReveal() {
    if (reduced() || scrollTimelineSupported()) return;
    if (!('IntersectionObserver' in window)) return;
    if (!revealObserver) {
      revealObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i += 1) {
          var entry = entries[i];
          if (entry.isIntersecting) {
            entry.target.classList.add('fo-in');
            revealObserver.unobserve(entry.target);
          }
        }
      }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    }
    var nodes = doc.querySelectorAll('.section, .panel, .card, .metric');
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.classList.contains('fo-reveal')) continue;
      node.classList.add('fo-reveal');
      revealObserver.observe(node);
    }
    window.setTimeout(forceReveal, REVEAL_SAFETY_MS);
  }

  /* -- 3. View Transitions for in-page navigation ------------------------ */
  function bindViewTransitions() {
    if (reduced()) return;
    if (typeof doc.startViewTransition !== 'function') return;
    doc.addEventListener('click', function (ev) {
      if (ev.defaultPrevented || ev.button !== 0) return;
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      var node = ev.target;
      var link = node && node.closest ? node.closest('a[href^="#"]') : null;
      if (!link) return;
      var hash = link.getAttribute('href');
      if (!hash || hash === '#' || hash.length < 2) return;
      var target = doc.querySelector(hash);
      if (!target) return;
      ev.preventDefault();
      doc.startViewTransition(function () {
        target.scrollIntoView({ block: 'start' });
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', hash);
        }
      });
    }, false);
  }

  /* -- 4. Re-bind for late-injected content ------------------------------ */
  var rebindQueued = false;

  function scheduleRebind() {
    if (rebindQueued) return;
    rebindQueued = true;
    window.requestAnimationFrame(function () {
      rebindQueued = false;
      bindSurfaces();
      bindReveal();
    });
  }

  function observeDom() {
    if (!('MutationObserver' in window) || !doc.body) return;
    var observer = new MutationObserver(scheduleRebind);
    observer.observe(doc.body, { childList: true, subtree: true });
  }

  function boot() {
    bindSurfaces();
    bindReveal();
    bindViewTransitions();
    observeDom();
    window.setTimeout(scheduleRebind, 400);
    window.setTimeout(scheduleRebind, 1600);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  if (reduceMq && reduceMq.addEventListener) {
    reduceMq.addEventListener('change', function () {
      if (reduced()) { forceReveal(); } else { scheduleRebind(); }
    });
  }

  window.FiberOS3D = { refresh: scheduleRebind, forceReveal: forceReveal };
}());
