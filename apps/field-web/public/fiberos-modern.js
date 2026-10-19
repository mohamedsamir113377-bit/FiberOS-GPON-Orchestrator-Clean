/*
 * FiberOS Modern Interaction Layer
 * Native browser primitives only. No network calls, no synthetic data.
 * The palette derives commands from real navigation/operations already
 * rendered by the current surface.
 */
(() => {
  'use strict';

  const palette = document.getElementById('foCommandPalette');
  const trigger = document.getElementById('foPaletteButton');

  if (!palette || !trigger) {
    performance.mark?.('fiberos-modern-ready');
    return;
  }

  const input = palette.querySelector('.fo-palette-input');
  const list = palette.querySelector('.fo-palette-list');
  const close = palette.querySelector('.fo-palette-close');
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let commands = [];
  let activeIndex = 0;
  let sectionObserver = null;

  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();

  function sameDocumentHash(url) {
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.origin === window.location.origin &&
        parsed.pathname === window.location.pathname &&
        Boolean(parsed.hash);
    } catch {
      return false;
    }
  }

  function navigate(link) {
    const href = link.getAttribute('href') || '';
    if (!href) return;

    if (sameDocumentHash(href)) {
      const parsed = new URL(href, window.location.href);
      const target = document.querySelector(parsed.hash);
      if (!target) return;
      const commit = () => {
        target.scrollIntoView({
          block: 'start',
          behavior: reduceMotion?.matches ? 'auto' : 'smooth'
        });
        window.history.replaceState(null, '', parsed.hash);
      };
      if (!reduceMotion?.matches && typeof document.startViewTransition === 'function') {
        document.startViewTransition(commit);
      } else {
        commit();
      }
      return;
    }

    window.location.assign(href);
  }

  function addCommand(label, hint, action, key) {
    const cleanLabel = normalize(label);
    if (!cleanLabel) return;
    commands.push({
      label: cleanLabel,
      hint: normalize(hint),
      action,
      key: key || ''
    });
  }

  function collectCommands() {
    commands = [];

    document.querySelectorAll('a[href^="#"]').forEach((link, index) => {
      if (link.closest('dialog') || link.hidden || link.getAttribute('aria-hidden') === 'true') return;
      const label = link.getAttribute('aria-label') || normalize(link.textContent);
      const href = link.getAttribute('href') || '';
      const target = href.length > 1 ? document.querySelector(href) : null;
      addCommand(
        label,
        target?.querySelector('.eyebrow')?.textContent || 'Current page section',
        () => navigate(link),
        String(index + 1)
      );
    });

    document.querySelectorAll('button[data-action="show"][data-target], button[data-command-safe="true"]').forEach(button => {
      if (button.closest('dialog') || button.disabled) return;
      addCommand(normalize(button.textContent), 'Operations view', () => button.click(), '');
    });

    document.querySelectorAll('a[href]:not([href^="#"])').forEach(link => {
      try {
        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin || link.target === '_blank') return;
        addCommand(
          link.getAttribute('aria-label') || normalize(link.textContent),
          url.pathname,
          () => navigate(link),
          ''
        );
      } catch (_) {
        /* Ignore malformed links; browser navigation remains unaffected. */
      }
    });

    const seen = new Set();
    commands = commands.filter(command => {
      const key = command.label + '|' + command.hint;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function visibleCommands() {
    const needle = normalize(input.value).toLowerCase();
    return commands.filter(command =>
      !needle || (command.label + ' ' + command.hint).toLowerCase().includes(needle)
    );
  }

  function render() {
    const visible = visibleCommands();
    activeIndex = Math.min(activeIndex, Math.max(0, visible.length - 1));
    list.replaceChildren();

    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'fo-palette-empty';
      empty.textContent = 'No matching command on this surface.';
      list.append(empty);
      return;
    }

    visible.forEach((command, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fo-palette-item';
      button.dataset.active = String(index === activeIndex);

      const ordinal = document.createElement('span');
      ordinal.className = 'fo-palette-index';
      ordinal.textContent = String(index + 1).padStart(2, '0');

      const copy = document.createElement('span');
      const label = document.createElement('strong');
      label.textContent = command.label;
      copy.append(label);

      if (command.hint) {
        const hint = document.createElement('small');
        hint.textContent = command.hint;
        copy.append(hint);
      }

      const key = document.createElement('span');
      key.className = 'fo-palette-key';
      key.textContent = command.key ? command.key : 'ENTER';

      button.append(ordinal, copy, key);
      button.addEventListener('click', () => {
        closePalette();
        command.action();
      });
      list.append(button);
    });
  }

  function openPalette() {
    collectCommands();
    activeIndex = 0;
    input.value = '';
    render();
    if (typeof palette.showModal === 'function') palette.showModal();
    else palette.setAttribute('open', '');
    queueMicrotask(() => input.focus());
  }

  function closePalette() {
    if (typeof palette.close === 'function' && palette.open) palette.close();
    else palette.removeAttribute('open');
  }

  function moveActive(delta) {
    const count = visibleCommands().length;
    if (!count) return;
    activeIndex = (activeIndex + delta + count) % count;
    render();
    list.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  function activateCurrent() {
    list.querySelector('[data-active="true"]')?.click();
  }

  trigger.addEventListener('click', openPalette);
  close?.addEventListener('click', closePalette);
  palette.addEventListener('click', event => {
    if (event.target === palette) closePalette();
  });

  input.addEventListener('input', () => {
    activeIndex = 0;
    render();
  });

  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activateCurrent();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
    }
  });

  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      palette.open ? closePalette() : openPalette();
      return;
    }
    if (
      event.key === '/' &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) &&
      !event.altKey && !event.ctrlKey && !event.metaKey
    ) {
      event.preventDefault();
      if (!palette.open) openPalette();
    }
  });

  function bindSectionObserver() {
    const sections = [...document.querySelectorAll('main [id], .view[id]')].filter(node =>
      node.tagName && !node.closest('dialog')
    );
    const navLinks = new Map();

    document.querySelectorAll('a[href^="#"]').forEach(link => {
      const href = link.getAttribute('href');
      if (href) navLinks.set(href.slice(1), link);
    });

    if (!sections.length || !navLinks.size || !('IntersectionObserver' in window)) return;

    sectionObserver?.disconnect();
    sectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const link = navLinks.get(entry.target.id);
        if (!link) return;
        link.classList.toggle(
          'fo-palette-active-section',
          entry.isIntersecting && entry.intersectionRatio > 0.16
        );
      });
    }, { rootMargin: '-18% 0px -68% 0px', threshold: [0, .16, .5] });

    sections.forEach(section => sectionObserver.observe(section));
  }

  function init() {
    bindSectionObserver();
    performance.mark?.('fiberos-modern-ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
