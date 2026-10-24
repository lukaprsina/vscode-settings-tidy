/**
 * Extensions to install in every dev container (`dev.containers.defaultExtensions`).
 *
 * Applied in order against input/extensions.txt (`code --list-extensions`). An entry is an exact
 * ID or a pattern with `*` (`ms-python.*`); a leading `!` removes matches from what came before.
 * UI-only extensions (themes, icons, keymaps) and remote/local-only ones don't belong here.
 */
export const extensionPatterns: string[] = [
  // Core
  "anthropic.claude-code",
  "github.vscode-pull-request-github",
  "github.vscode-github-actions",
  "neophack.git-graph-rs",
  "antfu.file-nesting",
  "kartiklabhshetwar.quotick",

  // Notebooks
  "ms-toolsai.*",
  "caenrigen.jupytext-sync",

  // Viewers and tools
  "openai.chatgpt",
  "openai.codex-audio",
  "pomdtr.excalidraw-editor",
  "eric-blanquer.ansi-automatic-clean-viewer",
  "mathematic.vscode-pdf",
  "qwtel.sqlite-viewer",
  "ms-vscode.hexeditor",

  // Web
  "oxc.oxc-vscode",
  "typescriptteam.native-preview",
  "voidzero.vite-plus-extension-pack",
  "vitest.explorer",
  "esbenp.prettier-vscode",
  "yoavbls.pretty-ts-errors",

  // Rust
  "rust-lang.rust-analyzer",
  "fill-labs.dependi",
  "tamasfe.even-better-toml",

  // Python
  "charliermarsh.ruff",
  "astral-sh.ty",
  "ms-python.*",

  // Data and docs
  "redhat.vscode-yaml",
  "redhat.vscode-xml",
  "mechatroner.rainbow-csv",
  "vstirbu.vscode-mermaid-preview",
  "myriad-dreamin.tinymist",
];
