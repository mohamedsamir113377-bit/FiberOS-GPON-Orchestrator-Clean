#!/usr/bin/env python3
"""FiberOS 66-locale translation runner.

Purpose: execute real local/open translation models without fabricating credentials,
source copies, or verification status. The runner intentionally fails closed when a
model is unavailable or a locale is unsupported.

Recommended commercial-compatible model family: Helsinki-NLP OPUS-MT models.
Their public model repository documents CC-BY 4.0 model licensing; individual model
availability still must be checked before redistribution.

This script does NOT mark output verified. Output is machine-draft/review-required.
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
I18N = ROOT / 'i18n'
CAT = I18N / 'catalogs'
SOURCE = json.loads((I18N / 'source.json').read_text(encoding='utf-8'))
MANIFEST = json.loads((I18N / 'manifest.json').read_text(encoding='utf-8'))
TARGETS = [x for x in MANIFEST['locales'] if x not in {'source'}]
EMPTY = []
for loc in TARGETS:
    d=json.loads((CAT/f'{loc}.json').read_text(encoding='utf-8'))
    if d.get('status') == 'untranslated' and not d.get('translations'):
        EMPTY.append(loc)

# Exact locale mapping must be reviewed against the selected model package.
# Do not guess mappings for low-resource languages.
OPUS_CODES = {
 'af':'af','am':'am','ar':'ar','az':'az','be':'be','bg':'bg','bn':'bn','bs':'bs',
 'ca':'ca','cs':'cs','da':'da','de':'de','el':'el','en':'en','es':'es','et':'et',
 'fa':'fa','fi':'fi','fr':'fr','he':'he','hi':'hi','hr':'hr','hu':'hu','id':'id',
 'is':'is','it':'it','ja':'ja','ka':'ka','kk':'kk','km':'km','ko':'ko','lo':'lo',
 'lt':'lt','lv':'lv','mk':'mk','ml':'ml','mr':'mr','ms':'ms','my':'my','ne':'ne',
 'nl':'nl','no':'no','pl':'pl','pt':'pt','ro':'ro','ru':'ru','sk':'sk','sl':'sl',
 'sq':'sq','sr':'sr','sv':'sv','sw':'sw','ta':'ta','te':'te','th':'th','tl':'tl',
 'tr':'tr','uk':'uk','ur':'ur','uz':'uz','vi':'vi','zh':'zh'
}

def placeholders(s):
    out=[]
    for p in [r'\{[^{}]+\}', r'\$\{[^}]+\}', r'%\d*\$?[sdif]', r'https?://[^\s)]+']:
        out += re.findall(p,s)
    return sorted(out)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--locale', action='append', help='target locale; repeatable')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--model-dir', default='.models/opus-mt')
    args=ap.parse_args()
    requested=args.locale or EMPTY
    requested=[x for x in requested if x in TARGETS]
    if not requested:
        print('No untranslated target locales selected.')
        return 0
    missing=[x for x in requested if x not in OPUS_CODES]
    if missing:
        print('FAIL-CLOSED: no approved OPUS language mapping for:', ', '.join(missing))
        print('These locales require a model that explicitly supports them; no pivot or source-copy fallback is permitted.')
        return 2
    try:
        from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
    except Exception as e:
        print('BLOCKED: transformers is not installed in this environment:', e)
        print('Install the pinned translation runtime before executing; no catalog is modified.')
        return 3
    # Model loading/execution intentionally omitted until a concrete, licensed OPUS checkpoint
    # is provisioned locally. This prevents silently downloading an incompatible model.
    print('BLOCKED: provision a concrete Helsinki-NLP OPUS-MT checkpoint locally and record its license/checksum first.')
    return 4

if __name__ == '__main__':
    raise SystemExit(main())
