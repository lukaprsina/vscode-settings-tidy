import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { categories } from "./categories.ts";
import { tidy } from "./tidy.ts";

const USAGE = `usage: tidy [settings.json] [defaultSettings.jsonc]

Writes a tidy copy of settings.json to output/settings.json. The input is never modified.
Defaults: input/settings.json and input/defaultSettings.jsonc.
Regenerate the defaults when extensions change: F1 -> "Preferences: Open Default Settings (JSON)", save as a file.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { help: { type: "boolean" } },
});
if (values.help || positionals.length > 2) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 2);
}
const [settingsPath = "input/settings.json", defaultsPath = "input/defaultSettings.jsonc"] =
  positionals;

const { output, warnings, errors } = tidy({
  settings: readFileSync(settingsPath, "utf8"),
  defaults: readFileSync(defaultsPath, "utf8"),
  categories,
});

for (const message of errors) console.error(`error: ${message}`);
if (errors.length) process.exit(1);

for (const w of warnings) console.warn(`warning [${w.kind}]: ${w.message}`);
mkdirSync("output", { recursive: true });
writeFileSync("output/settings.json", output);
console.log(`wrote output/settings.json (${warnings.length} warnings)`);
