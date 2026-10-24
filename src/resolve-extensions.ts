import type { Warning } from "./tidy.ts";

export interface ExtensionsResult {
  /** Installed extension IDs selected by the whitelist, sorted. */
  ids: string[];
  warnings: Warning[];
  errors: string[];
}

const ID = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9._-]*$/i;
const PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-z0-9*][a-z0-9._*-]*$/i;

/**
 * Select installed extensions with an ordered whitelist.
 *
 * `installed` is `code --list-extensions` output. A pattern is an exact ID or uses `*` as a
 * wildcard (`ms-python.*`); a leading `!` removes matches from what earlier patterns selected.
 * Matching is case-insensitive.
 */
export function resolveExtensions(installed: string, patterns: string[]): ExtensionsResult {
  const warnings: Warning[] = [];
  const errors: string[] = [];

  const ids: string[] = [];
  const seenId = new Set<string>();
  installed.split(/\r?\n/).forEach((raw, index) => {
    // `--show-versions` appends @version; a trailing comment or blank line is ignored.
    const line = raw.replace(/#.*/, "").trim().replace(/@\S+$/, "");
    if (!line) return;
    if (!ID.test(line)) {
      errors.push(`extensions.txt:${index + 1}: "${line}" is not a publisher.name extension ID`);
    } else if (seenId.has(line.toLowerCase())) {
      errors.push(`extensions.txt:${index + 1}: duplicate extension "${line}"`);
    } else {
      seenId.add(line.toLowerCase());
      ids.push(line);
    }
  });

  const seenPattern = new Set<string>();
  const rules = patterns.map((pattern) => {
    const exclude = pattern.startsWith("!");
    const body = exclude ? pattern.slice(1) : pattern;
    if (!PATTERN.test(body))
      errors.push(`whitelist: "${pattern}" is not a valid extension pattern`);
    if (seenPattern.has(pattern.toLowerCase()))
      errors.push(`whitelist: duplicate pattern "${pattern}"`);
    seenPattern.add(pattern.toLowerCase());
    const source = body.split("*").map(escapeRegExp).join(".*");
    return { pattern, exclude, regex: new RegExp(`^${source}$`, "i") };
  });
  if (errors.length) return { ids: [], warnings, errors };

  const selected = new Set<string>();
  const decided = new Set<string>();
  const warn = (kind: Warning["kind"], key: string, message: string) =>
    warnings.push({ kind, key, message });

  for (const { pattern, exclude, regex } of rules) {
    const matches = ids.filter((id) => regex.test(id));
    for (const id of matches) decided.add(id);
    if (!matches.length) {
      warn("extension-stale", pattern, `${pattern} matches no installed extension`);
    } else if (exclude) {
      if (!matches.some((id) => selected.has(id))) {
        warn("extension-redundant", pattern, `${pattern} excludes nothing already selected`);
      }
      for (const id of matches) selected.delete(id);
    } else {
      if (matches.every((id) => selected.has(id))) {
        warn("extension-redundant", pattern, `${pattern} selects nothing new`);
      }
      for (const id of matches) selected.add(id);
    }
  }

  for (const id of ids) {
    if (!decided.has(id)) {
      warn("extension-unlisted", id, `${id} is installed but matched by no whitelist pattern`);
    }
  }

  const sorted = [...selected].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), "en"));
  return { ids: sorted, warnings, errors };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}
