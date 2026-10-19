# Branch Policy (FiberOS)

## Single release train

Development for the installation + security closeout train lands on:

`feature/installation-command-workflows-2026-10-07`

Promotion order:

1. Feature tip (source complete)
2. `fix/security-release-blockers-2026-10-06` via PR #31 — only after hosted Actions admit runners
3. `main` via PR #27 — only after Final adversarial + infrastructure proofs

## Forbidden

- Merging feature work directly to `main`
- Claiming Production Ready without live DB + runner evidence
- Developing on absorbed fix/* branches after merge into feature tip

## Cleanup (maintainers)

After verifying tip contains merges, delete remote branches that are fully absorbed:

```text
fix/installation-command-workflows-p0-p1-2026-10-07
fix/installation-completion-tracking-p0-2026-10-07
fix/installation-unified-batch-p0-2026-10-07
docs/adversarial-release-path-2026-10-07
```

Keep parallel product lines (`i18n/*`, `website/*`) until intentionally integrated.
