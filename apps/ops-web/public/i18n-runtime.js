/* FiberOS external i18n runtime.
 * Governance: only verified catalogs are silently activated. Draft/reviewed catalogs are visibly marked;
 * untranslated/invalid catalogs fall back to the canonical Arabic catalog. Technical keys are never translated.
 */
(function () {
  'use strict';
  var ROOT = '/i18n/';
  var STORAGE_KEY = 'fiberos_locale';
  var source = null;
  var sourceToKey = Object.create(null);
  var manifest = null;
  var STATUS_WARNING = { 'machine-draft': true, 'review-required': true, 'human-reviewed': true };

  function norm(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function getLocale() { try { return localStorage.getItem(STORAGE_KEY) || 'ar'; } catch (_) { return 'ar'; } }
  function loadJson(path) {
    return fetch(ROOT + path, { credentials:'same-origin', cache:'no-store' })
      .then(function (r) { if (!r.ok) { var e=new Error('I18N_LOAD_FAILED'); e.status=r.status; throw e; } return r.json(); });
  }
  function baseName(locale) {
    try { return new Intl.Locale(String(locale)).baseName; } catch (_) { return String(locale || ''); }
  }
  function formattingSupported(locale) {
    try {
      return Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0 &&
        Intl.NumberFormat.supportedLocalesOf([locale]).length > 0;
    } catch (_) { return false; }
  }
  function fallbackChain(locale, defaultLocale) {
    var raw=baseName(locale);
    var out=[];
    function add(v){ if(v && out.indexOf(v)===-1) out.push(v); }
    add(raw);
    var parts=raw.split('-');
    while(parts.length>1){
      var last=parts[parts.length-1];
      if(/^[A-Z]{2}$/.test(last) || /^\d{3}$/.test(last) || /^[A-Za-z]{4}$/.test(last)) parts.pop();
      else break;
      add(parts.join('-'));
    }
    add(baseName(defaultLocale || 'ar') || 'ar');
    return out;
  }
  function loadCatalogWithFallback(locale) {
    var chain=fallbackChain(locale, manifest && manifest.default || 'ar');
    var requested=chain[0] || 'ar';
    function next(i){
      if(i>=chain.length) return Promise.reject(new Error('I18N_NO_FALLBACK'));
      return loadJson('catalogs/'+chain[i]+'.json').then(function(cat){
        var usable = cat && cat.translations && (cat.status==='verified' || STATUS_WARNING[cat.status]);
        if(!usable) return next(i+1);
        return {catalog:cat, requestedLocale:requested, appliedLocale:cat.locale || chain[i], fallbackUsed:chain[i]!==requested, chain:chain};
      }).catch(function(){ return next(i+1); });
    }
    return next(0);
  }
  function isTranslatable(k) { return !source || !source.keyMetadata || !source.keyMetadata[k] || source.keyMetadata[k].translatable !== false; }
  function ensureStatusBanner(detail) {
    var existing=document.getElementById('fiberos-i18n-status');
    if(existing) existing.remove();
    if(detail.status==='verified' && !detail.fallbackUsed && !detail.formattingFallback) return;
    var banner=document.createElement('div');
    banner.id='fiberos-i18n-status';
    banner.className='fiberos-i18n-status';
    banner.setAttribute('role','status');
    banner.setAttribute('aria-live','polite');
    var messages=[];
    if(detail.fallbackUsed) messages.push('Selected language is unavailable; fallback locale used: '+String(detail.appliedLocale)+'.');
    if(STATUS_WARNING[detail.status]) messages.push('Machine-translated / under review — status '+String(detail.status)+'; not a final verified translation.');
    if(detail.formattingFallback) messages.push('This browser lacks locale-specific date/number formats; English formatting may be used.');
    if(!messages.length) messages.push('The locale catalog is not valid for final activation; reference content has been retained.');
    banner.textContent='FiberOS: '+messages.join(' ');
    document.body.appendChild(banner);
  }
  function annotate() {
    var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT), n;
    while((n=walker.nextNode())){
      if(!n.parentElement || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentElement.tagName)) continue;
      var text=norm(n.nodeValue), k=sourceToKey[text];
      if(!k || !isTranslatable(k)) continue;
      n.parentElement.setAttribute('data-fiberos-i18n-key',k);
      n.__fiberosI18nKey=k;
      if(!n.__fiberosI18nSource) n.__fiberosI18nSource=source.keys[k];
    }
    document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(function(el){
      ['placeholder','title','aria-label'].forEach(function(attr){
        if(!el.hasAttribute(attr)) return;
        var text=norm(el.getAttribute(attr)), k=sourceToKey[text];
        if(!k || !isTranslatable(k)) return;
        el.setAttribute('data-fiberos-i18n-'+attr,k);
        if(!el.getAttribute('data-fiberos-i18n-source-'+attr)) el.setAttribute('data-fiberos-i18n-source-'+attr,source.keys[k]);
      });
    });
  }
  function applyCatalog(catalog) {
    var status=catalog && catalog.status;
    if(!catalog || !catalog.translations || status!=='verified' && !STATUS_WARNING[status]) return {applied:0,status:status||'invalid'};
    var applied=0;
    document.querySelectorAll('[data-fiberos-i18n-key]').forEach(function(parent){
      var k=parent.getAttribute('data-fiberos-i18n-key');
      if(!isTranslatable(k)) return;
      var value=catalog.translations[k];
      if(typeof value!=='string' || !value.trim()) return;
      var walker=document.createTreeWalker(parent,NodeFilter.SHOW_TEXT), n;
      while((n=walker.nextNode())){
        if(n.__fiberosI18nKey===k || norm(n.nodeValue)===source.keys[k] || n.__fiberosI18nSource===source.keys[k]) {
          n.nodeValue=value; n.__fiberosI18nKey=k; n.__fiberosI18nSource=source.keys[k]; applied++; break;
        }
      }
    });
    ['placeholder','title','aria-label'].forEach(function(attr){
      document.querySelectorAll('[data-fiberos-i18n-'+attr+']').forEach(function(el){
        var k=el.getAttribute('data-fiberos-i18n-'+attr);
        if(!isTranslatable(k)) return;
        var value=catalog.translations[k];
        if(typeof value==='string' && value.trim()){ el.setAttribute(attr,value); applied++; }
      });
    });
    return {applied:applied,status:status};
  }
  function activate(locale, eventName) {
    return loadCatalogWithFallback(locale).then(function(info){
      var cat=info.catalog, result=applyCatalog(cat);
      var detail={requestedLocale:info.requestedLocale,locale:info.appliedLocale,status:result.status,applied:result.applied,fallbackUsed:info.fallbackUsed,fallbackChain:info.chain,formattingFallback:!formattingSupported(info.requestedLocale)};
      ensureStatusBanner(detail);
      window.dispatchEvent(new CustomEvent(eventName,{detail:detail}));
      return detail;
    });
  }
  function init(){
    Promise.all([loadJson('source.json'),loadJson('manifest.json')]).then(function(pair){
      source=pair[0]; manifest=pair[1];
      Object.keys(source.keys||{}).forEach(function(k){ sourceToKey[source.keys[k]]=k; });
      annotate();
      return activate(getLocale(),'fiberos:i18n-ready');
    }).catch(function(){
      var detail={requestedLocale:getLocale(),locale:manifest&&manifest.default||'ar',status:'unavailable',applied:0,fallbackUsed:true};
      ensureStatusBanner(detail);
      window.dispatchEvent(new CustomEvent('fiberos:i18n-ready',{detail:detail}));
    });
    window.addEventListener('fiberos:locale-changed',function(e){
      if(!source || !manifest || !e.detail || !e.detail.code) return;
      activate(e.detail.code,'fiberos:i18n-applied').catch(function(){});
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
}());
