'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const config = window.FiberOSFieldConfig || { apiBase: '', allowedApiOrigins: [] };
  let stream = null;
  let lat = null;
  let lng = null;
  let lastPhotoHash = null;
  let lastCapturedAt = null;
  let ocrWorkerPromise = null;
  let ocrLibraryPromise = null;

  if (config.apiBase) $('apiBase').value = String(config.apiBase);

  function allowedApiOrigins() {
    return Array.isArray(config.allowedApiOrigins) ? config.allowedApiOrigins : [];
  }

  function normalizedApiBase() {
    return window.FiberOSFieldSecurity.normalizeApiBase(
      $('apiBase').value,
      window.location.href,
      allowedApiOrigins()
    );
  }

  async function api(path, options = {}) {
    // Validate the destination before accessing the token field. A pasted API
    // base must never receive the bearer token unless explicitly allowlisted.
    const url = window.FiberOSFieldSecurity.resolveApiUrl(
      normalizedApiBase(), path, window.location.href, allowedApiOrigins()
    );
    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type') && options.body != null) headers.set('Content-Type', 'application/json');
    const token = $('token').value.trim();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: options.signal || AbortSignal.timeout(20000)
    });
    let body;
    try { body = await response.json(); }
    catch (_) { body = { error: 'INVALID_JSON_RESPONSE' }; }
    if (!response.ok) throw new Error(body.error || `HTTP_${response.status}`);
    return body;
  }

  async function gps() {
    if (!navigator.geolocation) throw new Error('GEOLOCATION_UNAVAILABLE');
    const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
      resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    ));
    lat = position.coords.latitude;
    lng = position.coords.longitude;
    $('gpsOut').textContent = `GPS: ${lat.toFixed(6)}, ${lng.toFixed(6)} (accuracy ${Math.round(position.coords.accuracy || 0)}m)`;
    return { lat, lng };
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('CAMERA_UNAVAILABLE');
    if (stream) return stream;
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    const video = $('video');
    video.srcObject = stream;
    if (video.readyState < 2) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('CAMERA_FRAME_NOT_READY')), 10000);
        video.addEventListener('loadeddata', () => { clearTimeout(timeout); resolve(); }, { once: true });
        video.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('CAMERA_FRAME_NOT_READY')); }, { once: true });
      });
    }
    return stream;
  }

  function hashToHex(buffer) {
    return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  async function loadOcrLibrary() {
    if (window.Tesseract?.createWorker) return;
    if (!ocrLibraryPromise) {
      ocrLibraryPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'vendor/tesseract-7.0.0/tesseract.min.js';
        script.async = true;
        const timer = setTimeout(() => {
          script.remove();
          reject(new Error('LOCAL_OCR_LIBRARY_TIMEOUT'));
        }, 20000);
        script.onload = () => {
          clearTimeout(timer);
          if (window.Tesseract?.createWorker) resolve();
          else reject(new Error('LOCAL_OCR_ASSETS_UNAVAILABLE'));
        };
        script.onerror = () => {
          clearTimeout(timer);
          script.remove();
          reject(new Error('LOCAL_OCR_LIBRARY_LOAD_FAILED'));
        };
        document.head.append(script);
      });
    }
    return ocrLibraryPromise;
  }

  async function getOcrWorker() {
    await loadOcrLibrary();
    if (!window.Tesseract || typeof window.Tesseract.createWorker !== 'function') {
      throw new Error('LOCAL_OCR_ASSETS_UNAVAILABLE');
    }
    if (!ocrWorkerPromise) {
      ocrWorkerPromise = window.Tesseract.createWorker('eng', 1, {
        workerPath: 'vendor/tesseract-7.0.0/worker.min.js',
        corePath: 'vendor/tesseract-7.0.0/core',
        langPath: 'vendor/tesseract-7.0.0/lang-data',
        gzip: true,
        logger(message) {
          if (message && message.status === 'recognizing text') {
            $('ocrOut').textContent = `OCR: ${Math.round((message.progress || 0) * 100)}%`;
          }
        }
      });
    }
    try { return await ocrWorkerPromise; }
    catch (error) { ocrWorkerPromise = null; throw error; }
  }

  async function captureAndOcr() {
    await startCamera();
    const video = $('video');
    if (!video.videoWidth || !video.videoHeight) throw new Error('CAMERA_FRAME_NOT_READY');
    const canvas = $('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d', { willReadFrequently: false });
    if (!context) throw new Error('CAMERA_CAPTURE_UNAVAILABLE');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob || blob.size < 1) throw new Error('PHOTO_CAPTURE_FAILED');
    lastCapturedAt = new Date().toISOString();
    lastPhotoHash = hashToHex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));

    $('ocrOut').textContent = 'OCR: starting local English model…';
    try {
      const worker = await getOcrWorker();
      const result = await worker.recognize(blob);
      const text = String(result.data.text || '').trim();
      $('ocrOut').textContent = text ? `OCR: ${text.slice(0, 500)}` : 'OCR: no text found';
      const serial = (text.match(/(?:SN|S\/N|SERIAL)\s*[:#-]?\s*([A-Z0-9._-]{5,})/i) || [])[1];
      if (serial && !$('serial').value) $('serial').value = serial;
    } catch (_) {
      $('ocrOut').textContent = 'OCR unavailable; enter the identifier manually. The captured image hash is retained.';
    }
    $('status').textContent = 'Photo captured locally. Review OCR and entered values before saving.';
  }

  async function ensureGps() {
    if (lat == null || lng == null) await gps();
    return { lat, lng };
  }

  async function submitEvidence() {
    await ensureGps();
    const ticketId = $('ticket').value.trim();
    if (!ticketId) throw new Error('TICKET_ID_REQUIRED');
    if (!lastCapturedAt || !lastPhotoHash) throw new Error('PHOTO_CAPTURE_REQUIRED');
    const rxDbm = $('rx').value === '' ? null : Number($('rx').value);
    if (rxDbm !== null && !Number.isFinite(rxDbm)) throw new Error('RX_DBM_INVALID');
    const payload = {
      ontSerial: $('serial').value.trim() || null,
      boxCode: $('box').value.trim() || null,
      rxDbm,
      note: $('note').value,
      gps: { lat, lng },
      capturedAt: lastCapturedAt
    };
    const body = await api('/v1/evidence/submit', {
      method: 'POST',
      body: JSON.stringify({ ticketId, kind: 'ocr', source: 'field', payload, contentHash: lastPhotoHash })
    });
    $('out').textContent = JSON.stringify(body, null, 2);
    $('status').textContent = body.persisted ? 'Evidence saved to DB.' : 'Request accepted without persistence; DB is required.';
  }

  async function closeTicket() {
    await ensureGps();
    const ticketId = $('ticket').value.trim();
    if (!ticketId) throw new Error('TICKET_ID_REQUIRED');
    if (!lastCapturedAt || !lastPhotoHash) throw new Error('PHOTO_CAPTURE_REQUIRED');
    const rxDbm = $('rx').value === '' ? undefined : Number($('rx').value);
    if (rxDbm !== undefined && !Number.isFinite(rxDbm)) throw new Error('RX_DBM_INVALID');
    const body = await api('/v1/tickets/close-field', {
      method: 'POST',
      body: JSON.stringify({
        ticketId,
        toStatus: 'completed',
        jobGps: { lat, lng },
        deviceGps: { lat, lng },
        photo: { capturedAt: lastCapturedAt, contentHash: lastPhotoHash },
        rxDbm,
        opticalSources: ['field_reading'],
        ontSerial: $('serial').value.trim() || null,
        boxCode: $('box').value.trim() || null,
        idempotencyKey: `field-${ticketId}-${lastPhotoHash.slice(0, 16)}`
      })
    });
    $('out').textContent = JSON.stringify(body, null, 2);
    $('status').textContent = body.ok ? 'Close processed by the server gate.' : 'Close rejected/pending; review the reasons.';
  }

  function reportError(error) {
    $('status').textContent = error && /^[A-Z0-9_:-]+$/.test(error.message || '') ? error.message : 'OPERATION_FAILED';
    $('status').className = 'bad';
  }

  function bindAction(selector, action) {
    $(selector).addEventListener('click', () => { Promise.resolve().then(action).catch(reportError); });
  }

  bindAction('captureGps', gps);
  bindAction('startCamera', startCamera);
  bindAction('captureOcr', captureAndOcr);
  bindAction('saveEvidence', submitEvidence);
  bindAction('closeTicket', closeTicket);

  $('tokenToggle').addEventListener('click', () => {
    const input = $('token');
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    $('tokenToggle').textContent = visible ? 'Hide token' : 'Show token';
    $('tokenToggle').setAttribute('aria-pressed', String(visible));
  });

  $('apiBase').addEventListener('change', () => {
    try {
      normalizedApiBase();
      $('apiBaseStatus').textContent = 'API origin allowed.';
      $('apiBaseStatus').className = 'ok';
    } catch (error) {
      $('apiBaseStatus').textContent = error.message;
      $('apiBaseStatus').className = 'bad';
    }
  });

  window.addEventListener('beforeunload', () => {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (ocrWorkerPromise) ocrWorkerPromise.then((worker) => worker.terminate()).catch(() => {});
    $('token').value = '';
  });

  window.addEventListener('error', () => reportError(new Error('CLIENT_ERROR')));
  window.addEventListener('unhandledrejection', () => reportError(new Error('CLIENT_REQUEST_FAILED')));
})();
