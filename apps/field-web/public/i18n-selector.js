/* FiberOS locale selector. Catalog availability and review status are explicit. */
(function () {
  'use strict';

  var STORAGE_KEY = 'fiberos_locale';
  var DEFAULT_LOCALE = 'ar';
  var SELECTOR_ID = 'fiberos-external-locale-selector';
  var AVAILABLE_STATUSES = { verified: true, 'machine-draft': true };

  function safeStorageGet() {
    try { return window.localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
  }

  function safeStorageSet(value) {
    try { window.localStorage.setItem(STORAGE_KEY, value); } catch (_) { /* storage may be unavailable */ }
  }

  function isRtl(code, rtl) {
    return Array.isArray(rtl) && rtl.indexOf(code) !== -1;
  }

  function applyLocale(code, rtl) {
    document.documentElement.lang = code;
    document.documentElement.dir = isRtl(code, rtl) ? 'rtl' : 'ltr';
    window.dispatchEvent(new CustomEvent('fiberos:locale-changed', { detail: { code: code } }));
  }

  function ensureStylesheet() {
    if (document.querySelector('link[rel="stylesheet"][href="/i18n-selector.css"]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/i18n-selector.css';
    document.head.appendChild(link);
  }

  function build(data) {
    if (!data || data.schema !== 'fiberos.r14.1.locale-selector.v2' || data.total !== 114 ||
        !Array.isArray(data.languages) || data.languages.length !== 114 ||
        !Number.isInteger(data.availableCount) || data.availableCount < 1 || data.availableCount > 114) {
      throw new Error('INVALID_LOCALE_CATALOG');
    }

    var seen = Object.create(null);
    var valid = [];
    data.languages.forEach(function (item) {
      if (!item || typeof item.code !== 'string' || !item.code || seen[item.code]) return;
      if (typeof item.name !== 'string' || typeof item.native !== 'string' || typeof item.region !== 'string') return;
      if (!AVAILABLE_STATUSES[item.status] || item.available !== true) return;
      seen[item.code] = true;
      valid.push(item);
    });
    if (valid.length !== data.availableCount || !seen[data.default || DEFAULT_LOCALE]) throw new Error('INVALID_LOCALE_CATALOG');
    ensureStylesheet();

    var codes = Object.create(null);
    valid.forEach(function (item) { codes[item.code] = true; });
    var saved = safeStorageGet();
    var current = codes[saved] ? saved : (codes[data.default] ? data.default : DEFAULT_LOCALE);
    applyLocale(current, data.direction && data.direction.rtl);

    var old = document.getElementById(SELECTOR_ID);
    if (old) old.remove();

    var wrap = document.createElement('aside');
    wrap.id = SELECTOR_ID;
    wrap.className = 'fiberos-locale-selector';
    wrap.setAttribute('aria-label', 'Language selector');

    var label = document.createElement('label');
    label.className = 'fiberos-locale-selector__label';
    label.textContent = 'Language — catalog review status shown';

    var select = document.createElement('select');
    select.id = SELECTOR_ID + '-select';
    select.className = 'fiberos-locale-selector__select';
    select.setAttribute('aria-label', 'Language and translation review status');

    var regions = Object.create(null);
    valid.forEach(function (item) {
      if (!regions[item.region]) regions[item.region] = [];
      regions[item.region].push(item);
    });

    Object.keys(regions).sort().forEach(function (region) {
      var group = document.createElement('optgroup');
      group.label = region;
      regions[region].forEach(function (item) {
        var option = document.createElement('option');
        option.value = item.code;
        var reviewLabel = item.status === 'verified' ? 'verified' : 'machine draft — unreviewed';
        var formattingLabel = item.formattingSupported === false
          ? ' — English date/number-format fallback'
          : '';
        option.textContent = item.native + ' (' + item.name + ') — ' + reviewLabel + formattingLabel;
        option.selected = item.code === current;
        group.appendChild(option);
      });
      select.appendChild(group);
    });

    select.addEventListener('change', function () {
      var code = select.value;
      if (!codes[code]) return;
      safeStorageSet(code);
      applyLocale(code, data.direction && data.direction.rtl);
    });

    var notice = document.createElement('p');
    notice.className = 'fiberos-locale-selector__notice';
    notice.setAttribute('role', 'note');
    notice.textContent = 'Machine drafts are unreviewed and may be inaccurate. ' +
      (data.formattingFallbackCount
        ? 'English date/number formatting is used for ' + data.formattingFallbackCount + ' available locale(s).'
        : 'Date and number-format support is available for the listed locales.');

    wrap.appendChild(label);
    wrap.appendChild(select);
    wrap.appendChild(notice);
    document.body.appendChild(wrap);
  }

  function init() {
    fetch('/locales-114.json', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('LOCALES_LOAD_FAILED');
        return response.json();
      })
      .then(build)
      .catch(function () {
        /* Locale selector is optional UI; never break FiberOS core if its catalog is unavailable. */
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
