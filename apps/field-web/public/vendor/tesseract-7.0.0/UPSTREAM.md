# Vendored OCR assets

These browser assets are copied from the npm-published packages below. Their package tarball SHA-512 integrity values were independently recomputed from the downloaded tarballs and matched the npm registry metadata on 2026-09-27. The adjacent license notices are retained.

| Package | Version | License | npm registry `dist.integrity` |
|---|---:|---|---|
| [`tesseract.js`](https://registry.npmjs.org/tesseract.js/7.0.0) | 7.0.0 | Apache-2.0 | `sha512-exPBkd+z+wM1BuMkx/Bjv43OeLBxhL5kKWsz/9JY+DXcXdiBjiAch0V49QR3oAJqCaL5qURE0vx9Eo+G5YE7mA==` |
| [`tesseract.js-core`](https://registry.npmjs.org/tesseract.js-core/7.0.0) | 7.0.0 | Apache-2.0 | `sha512-WnNH518NzmbSq9zgTPeoF8c+xmilS8rFIl1YKbk/ptuuc7p6cLNELNuPAzcmsYw450ca6bLa8j3t0VAtq435Vw==` |
| [`@tesseract.js-data/eng`](https://registry.npmjs.org/@tesseract.js-data/eng/1.0.0) | 1.0.0 | MIT | `sha512-mbTumm6KQPUHyzTPQaF3ObXYnx0SqqfV2nabqFVQBwD6Kl7PhGSLSzOlfFTWy0P3BjghaSKA2W9GB19Jk+ZcTg==` |

`SHA256SUMS` pins the individual files in this directory. Verify them from this directory with `sha256sum -c SHA256SUMS`.

The field app serves the library, worker, all four CPU/SIMD WebAssembly core variants, and compressed English language data from the same origin. This overrides Tesseract's normal remote worker default and avoids requiring a third-party CDN at runtime. The configuration follows the official [browser API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md): use `createWorker('eng', 1, { workerPath, corePath, langPath, gzip: true })`, with `corePath` pointing to a directory containing all four builds.
