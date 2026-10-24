import { describe, expect, test } from "vite-plus/test";
import { tidy } from "../src/tidy.ts";

const cats = [
  { name: "A", keys: ["a.one", "a.two"] },
  { name: "B", keys: ["b.one"] },
];

function run(settings: string, defaults = "{}", categories = cats) {
  return tidy({ settings, defaults, categories });
}

describe("output layout", () => {
  test("sorts keys into banner sections in config order, tabs, trailing commas, New banner last", () => {
    const { output, errors } = run(`{ "b.one": 1, "a.two": 2, "a.one": 3 }`);
    expect(errors).toEqual([]);
    expect(output).toBe(
      [
        "{",
        "\t// ── A ──",
        '\t"a.one": 3,',
        '\t"a.two": 2,',
        "",
        "\t// ── B ──",
        '\t"b.one": 1,',
        "",
        "\t// ── New (unsorted) ──",
        "}",
        "",
      ].join("\n"),
    );
  });
});

describe("comments", () => {
  test("leading and same-line trailing comments travel with their key", () => {
    const { output } = run(
      [
        "{",
        "  // about two",
        "  /* block */",
        '  "a.two": 2, // trailing two',
        '  "a.one": 1 // no comma, trailing one',
        "}",
      ].join("\n"),
    );
    expect(output).toContain(
      [
        '\t"a.one": 1, // no comma, trailing one',
        "\t// about two",
        "\t/* block */",
        '\t"a.two": 2, // trailing two',
      ].join("\n"),
    );
  });

  test("a comment separated by a blank line is an orphan, kept at the top", () => {
    const { output } = run(`{\n  // header\n\n  "a.one": 1,\n}`);
    expect(output.startsWith("{\n\t// header\n\n\t// ── A ──")).toBe(true);
  });

  test("multi-line values are kept verbatim", () => {
    const value = `{\n    "x": [1,\n   2],\n  "//": "keep"\n  }`;
    const { output } = run(`{ "a.one": ${value} }`);
    expect(output).toContain(`\t"a.one": ${value},`);
  });
});

describe("uncategorized keys", () => {
  test("go under the New banner and are reported", () => {
    const { output, warnings } = run(`{ "zzz": 1 }`);
    expect(output).toBe('{\n\t// ── New (unsorted) ──\n\t"zzz": 1,\n}\n');
    expect(warnings).toContainEqual(expect.objectContaining({ kind: "uncategorized", key: "zzz" }));
  });
});

describe("errors", () => {
  test("parse errors report line and column", () => {
    const { errors, output } = run(`{\n  "a.one": ,\n}`);
    expect(errors[0]).toMatch(/settings\.json:2:\d+/);
    expect(output).toBe("");
  });

  test("duplicate keys are reported", () => {
    const { errors } = run(`{ "a.one": 1, "a.one": 2 }`);
    expect(errors).toContainEqual(expect.stringContaining('duplicate key "a.one"'));
  });

  test("a key in two categories is an error", () => {
    const { errors } = run(`{ "a.one": 1 }`, "{}", [
      { name: "A", keys: ["a.one"] },
      { name: "B", keys: ["a.one"] },
    ]);
    expect(errors).toContainEqual(expect.stringContaining('"a.one" is in both "A" and "B"'));
  });
});

describe("safety net", () => {
  const messy = [
    "{",
    "  // header",
    "",
    "  // about b",
    '  "b.one": { "x": 1, }, // trailing b',
    '  "zzz": [1, 2],',
    '  "a.one": "v"',
    "}",
  ].join("\n");

  test("running on its own output is a no-op (banners are not duplicated)", () => {
    const first = run(messy);
    expect(first.errors).toEqual([]);
    expect(run(first.output).output).toBe(first.output);
  });

  test("keys found under the New banner on the next run are uncategorized", () => {
    const first = run(messy).output;
    const next = first.replace(/\n}\n$/, '\n\t"added": true,\n}\n');
    const { output, warnings } = run(next);
    expect(warnings.map((w) => w.key)).toContain("added");
    expect(output.indexOf("New (unsorted)")).toBeLessThan(output.indexOf('"added"'));
  });

  test("the result parses back to the same settings", () => {
    const { output } = run(messy);
    const { output: again, errors } = run(output);
    expect(errors).toEqual([]);
    expect(again).toBe(output);
    for (const needle of [
      '"a.one": "v"',
      '"zzz": [1, 2]',
      '{ "x": 1, }',
      "// about b",
      "// trailing b",
    ]) {
      expect(output).toContain(needle);
    }
  });
});

describe("warnings against defaults", () => {
  const defaults = `{
		// generated
		"a.one": 1,
		"a.two": { "x": 1, "y": 2 },
		"b.one": "s",
		"[lang]": { "editor.tabSize": 4 },
	}`;
  const kinds = (settings: string, d = defaults, categories = cats) =>
    run(settings, d, categories).warnings.map((w) => `${w.kind}:${w.key}`);

  test("redundant: value deep-equals the default (key order ignored), and is kept", () => {
    const r = run(`{ "a.two": { "y": 2, "x": 1 }, "a.one": 1 }`, defaults);
    expect(r.warnings.map((w) => `${w.kind}:${w.key}`)).toEqual(
      expect.arrayContaining(["redundant:a.one", "redundant:a.two"]),
    );
    expect(r.output).toContain('"a.one": 1,');
  });

  test("partially redundant: some sub-keys of an object equal the defaults", () => {
    expect(kinds(`{ "a.two": { "x": 1, "y": 3 } }`)).toContain("partially-redundant:a.two");
  });

  test("unknown: key absent from the defaults", () => {
    expect(kinds(`{ "b.one": "t", "nope.key": 1 }`)).toEqual(
      expect.arrayContaining(["unknown:nope.key"]),
    );
    expect(kinds(`{ "b.one": "t" }`)).not.toContain("unknown:b.one");
  });

  test("[lang] overrides compare inner keys, not the whole block", () => {
    const out = kinds(`{ "[lang]": { "editor.tabSize": 4, "editor.bogus": true } }`);
    expect(out).toContain("unknown:[lang].editor.bogus");
    expect(out).toContain("partially-redundant:[lang]");
    expect(out).not.toContain("unknown:[lang]");
    expect(kinds(`{ "[whatever]": { "editor.tabSize": 2 } }`)).not.toContain("unknown:[whatever]");
  });

  test("stale config: category lists a key missing from settings", () => {
    expect(kinds(`{ "a.one": 5 }`)).toContain("stale:a.two");
  });

  test("missing sync target: ignoredSettings entry not present in settings", () => {
    const out = kinds(
      `{ "settingsSync.ignoredSettings": ["a.one", "gone.key"], "a.one": 5 }`,
      `{ "settingsSync.ignoredSettings": [], "a.one": 1 }`,
    );
    expect(out).toContain("missing-sync-target:gone.key");
    expect(out).not.toContain("missing-sync-target:a.one");
  });
});

describe("default extensions", () => {
  const installed = ["a.one", "a.two", "b.one", "Pub.Name", "z.last"].join("\n");
  const ext = (patterns: string[], text = installed) => ({ installed: text, patterns });
  const runExt = (patterns: string[], settings = "{}", text = installed) =>
    tidy({ settings, defaults: "{}", categories: cats, extensions: ext(patterns, text) });
  const kinds = (r: ReturnType<typeof runExt>) => r.warnings.map((w) => `${w.kind}:${w.key}`);

  test("globs expand against the installed list, sorted, case-insensitive, written as a key", () => {
    const r = runExt(["z.last", "a.*", "pub.name"]);
    expect(r.errors).toEqual([]);
    expect(r.output).toContain(
      '\t"dev.containers.defaultExtensions": [\n\t\t"a.one",\n\t\t"a.two",\n\t\t"Pub.Name",\n\t\t"z.last"\n\t],',
    );
  });

  test("! removes earlier matches", () => {
    const r = runExt(["a.*", "!a.two"]);
    expect(r.output).toContain('"a.one"');
    expect(r.output).not.toContain('"a.two"');
    expect(kinds(r)).not.toContain("extension-unlisted:a.two");
  });

  test("warns: stale, redundant, unlisted", () => {
    const r = runExt(["a.*", "a.one", "nope.*"]);
    expect(kinds(r)).toEqual(
      expect.arrayContaining([
        "extension-redundant:a.one",
        "extension-stale:nope.*",
        "extension-unlisted:b.one",
        "extension-unlisted:z.last",
      ]),
    );
  });

  test("replaces an existing key (warning only when it differs) and is idempotent", () => {
    const first = runExt(["a.*"]).output;
    const again = runExt(["a.*"], first);
    expect(again.errors).toEqual([]);
    expect(again.output).toBe(first);
    expect(kinds(again)).not.toContain("extension-overwritten:dev.containers.defaultExtensions");
    const changed = runExt(["a.*"], '{ "dev.containers.defaultExtensions": ["x.y"] }');
    expect(kinds(changed)).toContain("extension-overwritten:dev.containers.defaultExtensions");
    expect(changed.output).not.toContain("x.y");
  });

  test("errors: bad pattern, duplicate pattern, bad or duplicate installed line", () => {
    const errors = (patterns: string[], text = installed) => runExt(patterns, "{}", text).errors;
    expect(errors(["bad pattern"])).toContainEqual(expect.stringContaining("not a valid"));
    expect(errors(["a.*", "A.*"])).toContainEqual(expect.stringContaining("duplicate pattern"));
    expect(errors(["a.*"], "nodot")).toContainEqual(expect.stringContaining("extensions.txt:1"));
    expect(errors(["a.*"], "a.one\nA.One")).toContainEqual(
      expect.stringContaining("duplicate extension"),
    );
  });
});
