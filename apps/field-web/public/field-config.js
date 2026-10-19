'use strict';
/*
 * Deployment template for the field application.
 * Keep apiBase empty to use this page's own origin. For a separate API host,
 * set apiBase and list that exact HTTPS origin in allowedApiOrigins. Never
 * add a wildcard; the browser will refuse to send bearer credentials elsewhere.
 */
window.FiberOSFieldConfig = Object.freeze({
  apiBase: '',
  allowedApiOrigins: Object.freeze([])
});
