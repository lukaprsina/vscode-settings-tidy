import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { categories } from "./categories.ts";
import { extensionPatterns } from "./extensions.ts";
import { tidy } from "./tidy.ts";

const USAGE = `usage: tidy [settings.json] [defaultSettings.jsonc] [extensions.txt]

Writes a tidy copy of settings.json to output/settings.json. The input is never modified.
Defaults: input/settings.json, input/defaultSettings.jsonc and input/extensions.txt.
dev.containers.defaultExtensions is generated from extensions.txt (code --list-extensions) and the whitelist in src/extensions.ts.
Regenerate the defaults when extensions change: F1 -> "Preferences: Open Default Settings (JSON)", save as a file.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { help: { type: "boolean" } },
});
if (values.help || positionals.length > 3) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 2);
}
const [
  settingsPath = "input/settings.json",
  defaultsPath = "input/defaultSettings.jsonc",
  extensionsPath = "input/extensions.txt",
] = positionals;

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    console.error(`error: cannot read ${path}: ${(error as Error).message}`);
    process.exit(1);
  }
}

const { output, warnings, errors } = tidy({
  settings: read(settingsPath),
  defaults: read(defaultsPath),
  categories,
  extensions: { installed: read(extensionsPath), patterns: extensionPatterns },
});

for (const message of errors) console.error(`error: ${message}`);
if (errors.length) process.exit(1);

for (const w of warnings) console.warn(`warning [${w.kind}]: ${w.message}`);
mkdirSync("output", { recursive: true });
writeFileSync("output/settings.json", output);
console.log(`wrote output/settings.json (${warnings.length} warnings)`);
