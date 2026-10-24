# vscode-settings-tidy

Sorts a VS Code `settings.json` (JSONC) into commented categories and generates `dev.containers.defaultExtensions` from a whitelist. It never modifies its inputs; it writes `output/settings.json` for you to review and copy over.

```bash
vp install
vp run tidy [settings.json] [defaultSettings.jsonc] [extensions.txt]
```

## Inputs

All gitignored, all in `input/` by default:

| File                    | How to get it                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `settings.json`         | Your user settings.                                                                                                   |
| `defaultSettings.jsonc` | F1 → "Preferences: Open Default Settings (JSON)", save. Depends on installed extensions; regenerate when they change. |
| `extensions.txt`        | `code --list-extensions > input/extensions.txt` (or `code-insiders`).                                                 |

## Settings

Categories and key order live in `src/categories.ts`. No build step.

- Keys in no category go under `// ── New (unsorted) ──` at the end; add them to `categories.ts` and rerun.
- Warnings: `redundant`, `partially-redundant`, `unknown`, `uncategorized`, `stale`, `missing-sync-target`.
- Errors (exit 1): parse errors, duplicate keys, a key in two categories, failed round-trip or idempotency check.

## Dev container extensions

The whitelist lives in `src/extensions.ts`, applied in order against `extensions.txt`:

- an exact ID, a glob (`ms-python.*`), or `!pattern` to remove earlier matches;
- case-insensitive, and only installed extensions are ever selected.

The sorted result is written to `dev.containers.defaultExtensions`, replacing any existing value. Copy that key into your user settings; Settings Sync does the rest.

- Warnings: `extension-stale` (matches nothing), `extension-redundant` (selects nothing new), `extension-unlisted` (installed, matched by no pattern: add it or `!` it), `extension-overwritten` (the input's value differed).
- Errors (exit 1): malformed ID or pattern, duplicate pattern, duplicate installed extension.

## Behaviour notes

- Each property is copied as its original text, with the comments directly above it (no blank line between) and any same-line comment. Only the top-level indent becomes a tab.
- `// ── … ──` banners are generated and dropped on read, so a hand-written one is discarded.
- A comment attached to no key (blank line after it, or after the last key) moves to a block at the top. Nothing else is dropped.
- Comments in `categories.ts` and `extensions.ts` are notes for you, not copied.
- `[lang]` override keys are compared by their inner keys.

`vp test` runs the tests; `vp check` formats, lints and type checks.
