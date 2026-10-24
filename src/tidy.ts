import { isDeepStrictEqual } from "node:util";
import {
  createScanner,
  getNodeValue,
  parseTree,
  printParseErrorCode,
  type Node,
  type ParseError,
} from "jsonc-parser";
import type { Category } from "./categories.ts";
import { resolveExtensions, type ExtensionsResult } from "./resolve-extensions.ts";

export interface TidyInput {
  settings: string;
  defaults: string;
  categories: Category[];
  /** When given, `dev.containers.defaultExtensions` is generated from these. */
  extensions?: { installed: string; patterns: string[] };
}

export type WarningKind =
  | "redundant"
  | "partially-redundant"
  | "unknown"
  | "uncategorized"
  | "stale"
  | "missing-sync-target"
  | "extension-stale"
  | "extension-redundant"
  | "extension-unlisted"
  | "extension-overwritten";

export interface Warning {
  kind: WarningKind;
  key: string;
  message: string;
}

export interface TidyResult {
  output: string;
  warnings: Warning[];
  errors: string[];
}

// jsonc-parser declares SyntaxKind as a `const enum`, which can't be imported under type-stripping.
const LINE_COMMENT = 12;
const BLOCK_COMMENT = 13;
const LINE_BREAK = 14;
const EOF = 17;

export const DEFAULT_EXTENSIONS_KEY = "dev.containers.defaultExtensions";

const NEW_BANNER = "New (unsorted)";
const BANNER = /^\/\/ ── .* ──$/;

interface Entry {
  key: string;
  source: string;
  leading: string[];
  trailing: string;
}

interface Comment {
  text: string;
  /** Line breaks between the previous token (comment or property) and this comment. */
  breaksBefore: number;
  banner: boolean;
}

/** Tidy `settings` into categories. Never throws; problems come back in `errors` (and `output` is then empty). */
export function tidy(input: TidyInput): TidyResult {
  const ext = input.extensions
    ? resolveExtensions(input.extensions.installed, input.extensions.patterns)
    : undefined;
  const result = build(input, ext);
  if (result.errors.length) return { ...result, output: "" };

  // Safety net: nothing lost, added or changed (except the generated key), and the output is a fixed point.
  const before = valueMap(input.settings);
  if (ext) before.set(DEFAULT_EXTENSIONS_KEY, ext.ids);
  const after = valueMap(result.output);
  if (!isDeepStrictEqual(before, after)) {
    return {
      ...result,
      output: "",
      errors: ["round-trip check failed: output settings differ from input"],
    };
  }
  if (build({ ...input, settings: result.output }, ext).output !== result.output) {
    return {
      ...result,
      output: "",
      errors: ["idempotency check failed: tidying the output changed it"],
    };
  }
  return result;
}

function build(input: TidyInput, ext: ExtensionsResult | undefined): TidyResult {
  const warnings: Warning[] = [];
  const errors: string[] = [];

  const root = parseJsonc(input.settings, "settings.json", errors);
  if (!root || root.type !== "object") {
    if (!errors.length) errors.push("settings.json: expected a JSON object");
    return { output: "", warnings, errors };
  }

  const owner = new Map<string, string>();
  for (const category of input.categories) {
    for (const key of category.keys) {
      const first = owner.get(key);
      if (first !== undefined) errors.push(`"${key}" is in both "${first}" and "${category.name}"`);
      else owner.set(key, category.name);
    }
  }

  const defaults = nodeEntries(parseJsonc(input.defaults, "defaultSettings.jsonc", errors));
  if (ext) errors.push(...ext.errors);

  const { entries, orphans } = readEntries(input.settings, root);
  const seen = new Set<string>();
  for (const { key } of entries) {
    if (seen.has(key)) errors.push(`duplicate key "${key}" in settings.json`);
    seen.add(key);
  }
  if (errors.length) return { output: "", warnings, errors };

  const values = nodeEntries(root);
  if (ext) {
    warnings.push(...ext.warnings);
    const source = `${JSON.stringify(DEFAULT_EXTENSIONS_KEY)}: ${JSON.stringify(ext.ids, null, "\t").replaceAll("\n", "\n\t")}`;
    const existing = entries.find((e) => e.key === DEFAULT_EXTENSIONS_KEY);
    if (existing) {
      if (!isDeepStrictEqual(values.get(DEFAULT_EXTENSIONS_KEY), ext.ids)) {
        warnings.push({
          kind: "extension-overwritten",
          key: DEFAULT_EXTENSIONS_KEY,
          message: `${DEFAULT_EXTENSIONS_KEY} in settings.json was replaced by the generated list`,
        });
      }
      existing.source = source;
    } else {
      entries.push({ key: DEFAULT_EXTENSIONS_KEY, source, leading: [], trailing: "" });
    }
  }
  const byKey = new Map(entries.map((e) => [e.key, e]));

  const known = new Set<string>();
  const sections: string[] = [];
  for (const category of input.categories) {
    const lines: string[] = [];
    for (const key of category.keys) {
      const entry = byKey.get(key);
      if (entry) {
        known.add(key);
        lines.push(render(entry));
      }
    }
    if (lines.length) sections.push([`\t// ── ${category.name} ──`, ...lines].join("\n"));
  }

  for (const key of owner.keys()) {
    if (!byKey.has(key)) {
      warnings.push({
        kind: "stale",
        key,
        message: `${key} is listed in a category but absent from settings.json`,
      });
    }
  }
  for (const [key, value] of values) warnings.push(...compareToDefaults(key, value, defaults));
  const ignored = values.get("settingsSync.ignoredSettings");
  for (const key of Array.isArray(ignored) ? ignored : []) {
    if (typeof key === "string" && !values.has(key)) {
      warnings.push({
        kind: "missing-sync-target",
        key,
        message: `settingsSync.ignoredSettings lists ${key}, which is not in settings.json`,
      });
    }
  }

  const fresh = entries.filter((e) => !known.has(e.key));
  for (const entry of fresh) {
    warnings.push({
      kind: "uncategorized",
      key: entry.key,
      message: `${entry.key} is not in any category`,
    });
  }
  sections.push([`\t// ── ${NEW_BANNER} ──`, ...fresh.map(render)].join("\n"));

  const head = orphans.length ? `${orphans.map((c) => `\t${c}`).join("\n")}\n\n` : "";
  return { output: `{\n${head}${sections.join("\n\n")}\n}\n`, warnings, errors };
}

function compareToDefaults(key: string, value: unknown, defaults: Map<string, unknown>): Warning[] {
  const warn = (kind: WarningKind, subject: string, message: string): Warning => ({
    kind,
    key: subject,
    message,
  });
  const isLang = /^\[.+\]$/.test(key);
  const out: Warning[] = [];
  if (!isLang && !defaults.has(key))
    return [warn("unknown", key, `${key} is not in the defaults file`)];

  if (isLang && isPlainObject(value)) {
    for (const inner of Object.keys(value)) {
      if (!defaults.has(inner)) {
        out.push(warn("unknown", `${key}.${inner}`, `${key}.${inner} is not in the defaults file`));
      }
    }
  }
  if (!defaults.has(key)) return out;

  const def = defaults.get(key);
  if (isDeepStrictEqual(value, def)) {
    out.push(warn("redundant", key, `${key} equals its default`));
  } else if (isPlainObject(value) && isPlainObject(def)) {
    const same = Object.keys(value).filter((k) => k in def && isDeepStrictEqual(value[k], def[k]));
    if (same.length) {
      out.push(warn("partially-redundant", key, `${key}: ${same.join(", ")} equal the default`));
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function render(entry: Entry): string {
  const lines = entry.leading.map((c) => `\t${c}`);
  lines.push(`\t${entry.source},${entry.trailing ? ` ${entry.trailing}` : ""}`);
  return lines.join("\n");
}

/** Properties of the root object as verbatim source plus attached comments; unattached comments are orphans. */
function readEntries(text: string, root: Node): { entries: Entry[]; orphans: string[] } {
  const props = root.children ?? [];
  const entries: Entry[] = [];
  const orphans: string[] = [];
  let cursor = root.offset + 1;
  for (const prop of [...props, undefined]) {
    const end = prop ? prop.offset : root.offset + root.length - 1;
    const { trailing, comments, breaksAfter } = scanGap(text, cursor, end, entries.length > 0);
    if (trailing) entries.at(-1)!.trailing = trailing;
    let attached = 0;
    if (prop) {
      // Comments directly above the property (no blank line, no banner in between) belong to it.
      for (let i = comments.length - 1; i >= 0; i--) {
        const gap = i === comments.length - 1 ? breaksAfter : comments[i + 1]!.breaksBefore;
        if (comments[i]!.banner || gap > 1) break;
        attached++;
      }
    }
    const split = comments.length - attached;
    for (const c of comments.slice(0, split)) if (!c.banner) orphans.push(c.text);
    if (prop) {
      entries.push({
        key: prop.children![0]!.value as string,
        source: sliceOf(text, prop),
        leading: comments.slice(split).map((c) => c.text),
        trailing: "",
      });
      cursor = prop.offset + prop.length;
    }
  }
  return { entries, orphans };
}

/** Scan the trivia between two properties: a same-line comment after the previous one, then standalone comments. */
function scanGap(text: string, from: number, to: number, hasPrev: boolean) {
  const gap = text.slice(from, to);
  const scanner = createScanner(gap, false);
  let trailing = "";
  const comments: Comment[] = [];
  let breaks = 0;
  let sameLine = hasPrev;
  for (let kind = scanner.scan(); kind !== EOF; kind = scanner.scan()) {
    if (kind === LINE_BREAK) {
      breaks++;
      sameLine = false;
    } else if (kind === LINE_COMMENT || kind === BLOCK_COMMENT) {
      const start = scanner.getTokenOffset();
      const value = gap.slice(start, start + scanner.getTokenLength()).trimEnd();
      if (sameLine) {
        trailing = value;
      } else {
        comments.push({ text: value, breaksBefore: breaks, banner: BANNER.test(value) });
      }
      breaks = 0;
      sameLine = false;
    }
  }
  return { trailing, comments, breaksAfter: breaks };
}

function sliceOf(text: string, node: Node): string {
  return text.slice(node.offset, node.offset + node.length);
}

/** Parse JSONC (comments and trailing commas allowed), pushing `file:line:column` errors. */
function parseJsonc(text: string, file: string, errors: string[]): Node | undefined {
  const parseErrors: ParseError[] = [];
  const root = parseTree(text, parseErrors, { allowTrailingComma: true });
  for (const e of parseErrors) {
    const before = text.slice(0, e.offset).split("\n");
    errors.push(
      `${file}:${before.length}:${before.at(-1)!.length + 1}: ${printParseErrorCode(e.error)}`,
    );
  }
  return root;
}

/** Key to value map of an object node, with VS Code semantics: the last duplicate wins. */
function nodeEntries(root: Node | undefined): Map<string, unknown> {
  return new Map(
    (root?.children ?? []).map((prop) => [
      prop.children![0]!.value as string,
      getNodeValue(prop.children![1]!),
    ]),
  );
}

function valueMap(text: string): Map<string, unknown> {
  return nodeEntries(parseTree(text, [], { allowTrailingComma: true }));
}
