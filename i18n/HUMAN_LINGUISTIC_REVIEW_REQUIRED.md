# Human linguistic review required

## Scope boundary

The **84** populated runtime catalogs passed a **deterministic machine forensic audit**
(Unicode safety, placeholders, structural contracts, cross-script numeric parity).

This is **not** native-speaker linguistic certification.

| Class | Meaning |
|-------|---------|
| Machine-forensically accepted | Passed `verify-i18n-atomic-linguistic-audit.js` / forensic auditor |
| Machine-draft | Usable draft; not human-certified |
| Human-certified | Only after independent human review evidence |

**Rule:** Automated PASS must never promote a catalog to human-verified.

## High-risk human checks

- Security wording (*secured webhook* ≠ *encrypted*; *server-authoritative closure*; *no PSTN call is claimed*)
- Authority / operational state semantics
- Placeholder and route/endpoint fidelity
- Grammar, register, cultural fit

## Prior attention locales (re-validate; do not auto-rewrite)

`ms`, `sw`, `hy`, `uz`, `my`, `ml`, `es`, `sr`, `te`

## Buyer model

Product ships **Machine-Forensic Accepted** language pack + this notice. Human certification is optional and buyer-owned.

## العربية

خضعت الحزمة لتدقيق آلي جنائي متعدد الطبقات. **ليست** شهادة لغوية بشرية. لا تُعرض ترجمات machine-draft كمراجعة ناطق أصلي. من يحتاج اعتماداً بشرياً يقوم به مستقلاً.
