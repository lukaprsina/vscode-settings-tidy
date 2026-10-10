# vscode-settings-tidy

Reorganises a VS Code `settings.json` (JSONC) into commented categories. The categories and key order live in `src/categories.ts`; edit that file, no build step needed.

```bash
vp install
vp run tidy [settings.json] [defaultSettings.jsonc]
```

- Defaults: `input/settings.json` and `input/defaultSettings.jsonc` (both gitignored).
- Create the defaults file with F1 → "Preferences: Open Default Settings (JSON)" and save it. It is generated from your installed extensions, so regenerate it when they change.
- Writes `output/settings.json` only; the input is never modified. Review it, then replace your settings yourself.
- Keys not in any category land under `// ── New (unsorted) ──` at the end. Add them to `categories.ts` and run again.
- Prints warnings (redundant, partially redundant, unknown, uncategorized, stale config, missing sync target) and exits non-zero on errors (parse errors, duplicate keys, a key in two categories, failed round-trip or idempotency check).

`vp test` runs the tests, `vp check` formats, lints and type checks.
