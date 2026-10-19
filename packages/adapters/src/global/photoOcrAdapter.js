'use strict';

const { UnsupportedInputError } = require('./types');

/**
 * Covers: photo of the power meter's screen (any brand). The interface is
 * complete and real; what's NOT implemented is calling an actual OCR
 * provider (Google Vision, AWS Textract, a local model, etc.) — that needs a
 * real API key/contract decision from you, which nobody has made yet.
 *
 * This deliberately throws instead of returning a fabricated number when no
 * provider is configured, so the registry falls through to manual entry
 * rather than silently lying about a reading.
 */
function buildPhotoOcrAdapter({ ocrProvider = null } = {}) {
  return {
    sourceId: 'PHOTO_OCR',
    priority: 20,

    canHandle(rawInput) {
      return rawInput && rawInput.inputType === 'photo' && !!rawInput.imageBuffer;
    },

    extract(rawInput) {
      if (!ocrProvider) {
        throw new UnsupportedInputError(
          'ERR_OCR_NOT_CONFIGURED: no OCR provider wired up yet — pick one (Google Vision / AWS Textract / other) and pass it in as ocrProvider'
        );
      }
      // Real call site once a provider exists — deliberately not faked:
      // const text = await ocrProvider.readText(rawInput.imageBuffer);
      // const rxPowerDbm = parsePowerReadingFromOcrText(text);
      throw new UnsupportedInputError('ERR_OCR_EXTRACTION_NOT_IMPLEMENTED');
    },
  };
}

module.exports = { buildPhotoOcrAdapter };
