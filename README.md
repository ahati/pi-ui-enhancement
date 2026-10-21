<div align="center">

# pi-ui-enhancement

[![npm version](https://img.shields.io/npm/v/pi-ui-enhancement?style=for-the-badge)](https://www.npmjs.com/package/pi-ui-enhancement)
[![License](https://img.shields.io/github/license/ahati/pi-ui-enhancement?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=for-the-badge)]()

Fork of [MasuRii/pi-tool-display](https://github.com/MasuRii/pi-tool-display)
with all open upstream PRs, selected fork improvements, and new features.

OpenCode-style tool rendering for the [Pi coding agent](https://github.com/mariozechner/pi).

`pi-render` keeps tool calls compact by default, adds richer diff rendering for file edits, and improves a few core chat UI details such as thinking labels and the native user prompt box.

<img width="1360" height="752" alt="image" src="https://github.com/user-attachments/assets/777944a2-18b2-4642-b035-2c703a5abb1b" />

<img width="978" height="670" alt="image" src="https://github.com/user-attachments/assets/122b69ce-6c99-4aaa-ba93-236f97a1d8b4" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/7d5e36d3-cbe1-4d54-8bed-ae3dbdef870c" />
<img width="1919" height="566" alt="image" src="https://github.com/user-attachments/assets/68a1619b-62da-480f-8de3-2af441ccf6ff" />
<img width="1919" height="550" alt="image" src="https://github.com/user-attachments/assets/1d3f0b38-a5b5-47fc-b54b-8b55cc2bfaf1" />

</div>

## Features

- **Compact built-in tool rendering** for `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write`
- **MCP-aware rendering** with hidden, summary, and preview modes
- **Opt-in custom tool overrides** for noisy extension tools, defaulting to generic rendering unless `kind: "mcp"` is selected
- **Adaptive edit/write diffs** with split or unified layouts, syntax highlighting, inline emphasis, and narrow-pane width clamping
- **Workspace-scoped projected pending edit/write previews** that show `pending edit`, `pending overwrite`, and `pending create` diffs while partial tool calls are still streaming
- **Progressive collapsed diff hints** that shorten automatically on small terminal widths instead of overflowing
- **Hashline-anchor diff gutters** that preserve `LINE#HASH` labels from anchored read/edit output when those lines are rendered in diffs
- **Three presets**: `opencode`, `balanced`, and `verbose`
- **Thinking labels** during streaming and final message rendering, with context sanitization to avoid leaking presentation labels back into future model turns
- **Shiki/TextMate markdown code fence highlighting** with common bundled grammars and configurable Shiki themes
- **Optional formatted code block panels** that replace raw triple-backtick fences with compact bordered code blocks
- **Optional native user message box** with markdown-aware rendering and safer ANSI/background handling
- **Per-tool ownership toggles** so this extension can coexist with other renderer extensions
- **Capability-aware settings** that keep MCP and RTK-specific controls aligned with the current environment
- **Adapter API for renderer consumers** through the `pi-render/tool-display-api-consumer` subpath export

## Installation

### Local extension folder

Place this folder in one of Pi's auto-discovery locations:

```text
# Global default (when PI_CODING_AGENT_DIR is unset)
~/.pi/agent/extensions/pi-render

# Project-specific
.pi/extensions/pi-render
```

### npm package

```bash
pi install npm:pi-render
```

### Git repository

```bash
pi install git:github.com/jiwnchoi/pi-render
```

## Usage

### Interactive settings

Open the settings modal:

```text
/tool-display
```

The modal exposes the day-to-day controls most people change regularly:

- preset profile
- read output mode
- grep/find/ls output mode
- native codemode output (`summary`, `calls`, or `preview`)
- MCP output mode (when MCP is available)
- preview line count
- bash collapsed line count
- diff layout mode
- native user message box toggle
- Shiki code highlighting and code block box toggles

Advanced options remain in `config.json`.

### Direct commands

```text
/tool-display show                    # Show the effective config summary
/tool-display reset                   # Reset the current effective scope to opencode
/tool-display reset --global          # Reset global config
/tool-display reset --project         # Reset project config (trusted projects only)
/tool-display preset opencode         # Apply opencode preset to the current effective scope
/tool-display preset balanced         # Apply balanced preset to the current effective scope
/tool-display preset verbose          # Apply verbose preset to the current effective scope
/tool-display preset verbose --global # Apply preset to global config
/tool-display preset verbose --project # Apply preset to project config (trusted projects only)
```

### Tool display adapter API

Other extensions can opt into `pi-render` rendering without directly depending on its load order by importing the consumer helper:

```ts
import { decorateToolForDisplay, decorateMcpToolForDisplay } from "pi-render/tool-display-api-consumer";
```

`decorateToolForDisplay(tool, adapter)` applies the runtime decoration immediately when `pi-render` is loaded, or queues the decoration until the API becomes available. Use adapter options such as `kind: "read" | "edit" | "mcp" | "generic"` to select the renderer family; `decorateMcpToolForDisplay(tool)` is the shortcut for MCP-style tools.

On Pi 1.1 and later, `pi-ui-enhancement` also applies its built-in tool renderers through the Pi tool renderer chain (`registerToolRenderer`) at render time. Extensions that re-register `read`, `bash`, `edit`, or `write` with their own execute logic — for example [`pi-ssh-remote`](https://pi.dev/packages/pi-ssh-remote), which routes these tools to a remote SSH host — keep compact tool-display rendering in any load order, and their execute logic stays intact. On Pi versions without the renderer chain, externally owned tools keep their own rendering.

Pi binds `pi.getAllTools()` after extensions load, so ownership is unknown during load. `pi-ui-enhancement` therefore defers built-in tool registration to the `session_start` event and registers only the tools no other extension owns. This avoids the `Tool "read" conflicts with ...` startup diagnostic and keeps the other extension's execute logic in charge.

## Presets

| Preset | Read Output | Search Output | MCP Output | Bash Output | Codemode Output | Preview Lines | Bash Lines |
|--------|-------------|---------------|------------|-------------|-----------------|---------------|------------|
| `opencode` | hidden | hidden | hidden | opencode | calls | 8 | 10 |
| `balanced` | summary | count | summary | summary | calls | 8 | 10 |
| `verbose` | preview | preview | preview | preview | preview | 12 | 20 |

- **`opencode`** (default): minimal inline-only display; tool results stay collapsed
- **`balanced`**: compact summaries with line counts and match totals; bash shows line count only
- **`verbose`**: larger previews for read/search/MCP/bash/codemode output

### Bash Output Modes

| Mode | Behavior |
|------|----------|
| `opencode` | Classic collapsed output using `bashCollapsedLines` limit with expansion hint |
| `summary` | Shows only line count (e.g., "↳ 3 lines returned") — no output displayed |
| `preview` | Shows actual output lines using `previewLines` limit |

### Bash Intent Headers

Long commands (deep flag sets, absolute paths, `--git-dir`/`--work-tree` pairs) make the call header hard
to scan. With `bashIntentMode` enabled, leading comment lines are rendered as the header instead of the raw
command:

```bash
# tool: git status
# intent: check which files are dirty
git --git-dir=/srv/app/.git --work-tree=/srv/app status --short --untracked-files=all
```

renders as:

```text
🔧 git status · check which files are dirty
```

The header is composed of three parts — the wrench icon (Nerd Font or emoji, resolved the same way as
the rest of the UI), the program label, and the intent. **Arguments are omitted entirely.**

The label is chosen by the **agent**, which declares it on a second comment line — and it must name the program
actually being run, exactly as invoked (`gh pr view`, `git status`, `docker compose`). Naming the shell or the
tool you are calling through (`bash`) says nothing about the command and is worse than omitting the line:

```bash
# tool: git status
# intent: check which files are dirty
git --git-dir=/srv/app/.git --work-tree=/srv/app status --short --untracked-files=all
```

Omitting `# tool:` is fine — the header then falls back to the program alone, derived from the command. What it
never does is *guess* a subcommand: a shell command cannot distinguish a subcommand from an argument
(`grep -r pattern` vs `git status`), and inferring one would require a curated list of programs inside the
package, which nobody should have to maintain. The agent already knows what it is running, so it says so.

| command | `# tool:` | label |
|---------|-----------|-------|
| `git --git-dir=/srv/.git status --short` | `git status` | `git status` |
| `git --git-dir=/srv/.git status --short` | *(omitted)* | `git` |
| `sudo -u root systemctl restart app` | *(omitted)* | `systemctl` |
| `FOO=1 /usr/bin/apt-get install -y curl` | *(omitted)* | `apt-get` |
| `cd /srv/app && git status --short` | *(omitted)* | `git` |
| `grep -r pattern /path` | *(omitted)* | `grep` |
| `./scripts/deploy.sh --prod` | *(omitted)* | `deploy.sh` |

The fallback skips wrapper programs (`sudo`, `doas`, `env`, `nohup`, `command`, `exec`, `time`), their flags
*and the values those flags consume*, plus leading `VAR=value` assignments, and reduces absolute paths to a
basename. A leading segment that only sets context (`cd`, `export`, `set`, `source`, `pushd`, …) is skipped,
so the label names the program that does the work — and a command made *only* of those shows the icon plus
intent, with no dangling separator. Only the first pipeline segment is inspected, so a label never describes
something merely piped into.

Both comment lines are ordinary shell comments: the renderer strips them for display and they are never
executed. Only leading **comment** lines matching `# intent:` / `# tool:` are consumed, so executable content
can never be mistaken for a header; a `description` argument overrides the intent text when a custom shell
tool supplies one, while `# tool:` still applies.

| Mode | Behavior |
|------|----------|
| `off` | Default. Headers stay the raw command; intent comments render verbatim. |
| `render` | Render the intent comment as the header. Nothing is injected into the prompt. |
| `render-and-instruct` | As `render`, and append a guideline to the system prompt so the model supplies the intent comment itself. |

`bashIntentShowCommand` appends the stripped command after the intent
(`🔧 git status · check which files are dirty · git status --short`) when you want provenance in the header.

**Expanding a call with `Ctrl+O` shows the full command.** Because the header hides the arguments by design,
the full command is appended as a muted line beneath the header while expanded — preserving line breaks, so a
multi-line command is shown as written:

```text
🔧 git status · check which files are dirty
   git --git-dir=/srv/app/.git --work-tree=/srv/app status --short --untracked-files=all
```

`bashIntentShowCommand`'s one-line suffix is omitted while expanded, so the command never appears twice.
Output expansion is unchanged: `Ctrl+O` reveals the whole output in every `bashOutputMode`, including `summary`.

## Configuration

Runtime configuration is stored at:

```text
Global default: ~/.pi/agent/extensions/pi-ui-enhancement/config.json
Global with PI_CODING_AGENT_DIR: $PI_CODING_AGENT_DIR/extensions/pi-ui-enhancement/config.json
Project override: .pi/extensions/pi-ui-enhancement/config.json (legacy pi-tool-display path still read)
```

Effective configuration is merged as defaults → global config → project config. Project-level config requires Pi 0.79.1 or newer so the extension can verify project trust status; when trust is unavailable or the project is not trusted, project config is ignored with a warning. Project saves store only values that differ from the global config so inherited global settings keep applying. A starter template is included at `config/config.example.json`.

### Configuration options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `debug` | boolean | `false` | Opt-in file logging for extension diagnostics; missing values are treated as `false` |
| `registerToolOverrides` | object | all `true` | Built-in tool ownership flags |
| `customToolOverrides` | object | `{}` | Explicit opt-in rendering rules for non-built-in extension tools |
| `enableNativeUserMessageBox` | boolean | `true` | Enable bordered user prompt rendering |
| `enableShikiCodeBlocks` | boolean | `true` | Use Shiki's TextMate grammar renderer for markdown code fences when the language is supported |
| `formatCodeBlocks` | boolean | `true` | Render markdown code fences as compact bordered code panels instead of raw triple-backtick blocks |
| `shikiCodeBlockTheme` | string | `"github-dark"` | Shiki theme for code fences: `github-dark`, `github-light`, `dark-plus`, `light-plus`, `min-dark`, `min-light`, `one-dark-pro`, `vitesse-dark`, or `vitesse-light` |
| `readOutputMode` | string | `"hidden"` | `hidden`, `summary`, or `preview` |
| `searchOutputMode` | string | `"hidden"` | `hidden`, `count`, or `preview` |
| `mcpOutputMode` | string | `"hidden"` | `hidden`, `summary`, or `preview` |
| `codemodeOutputMode` | string | `"calls"` | `summary` shows status and counts, `calls` also lists nested tool calls, and `preview` adds output limited by `previewLines` |
| `previewLines` | number | `8` | Lines shown in collapsed preview mode |
| `expandedPreviewMaxLines` | number | `4000` | Max preview lines when fully expanded |
| `bashOutputMode` | string | `"opencode"` | `opencode` (collapse), `summary` (line count), or `preview` (show lines) |
| `bashCollapsedLines` | number | `10` | Lines shown for collapsed bash output (opencode mode) |
| `bashCommandMaxChars` | number | `0` | Truncate the bash call's displayed command to this many characters on a single line; `0` shows the full command |
| `bashIntentMode` | string | `"off"` | `off`, `render` (intent comment as the call header), or `render-and-instruct` (also teach the convention in the system prompt) |
| `bashIntentShowCommand` | boolean | `false` | Append the stripped command after the rendered intent |
| `diffViewMode` | string | `"auto"` | `auto`, `split`, or `unified` |
| `diffIndicatorMode` | string | `"bars"` | `bars` (vertical indicators), `classic` (+/- markers), or `none` |
| `diffSplitMinWidth` | number | `120` | Minimum width before auto mode prefers split diffs |
| `diffCollapsedLines` | number | `24` | Diff lines shown before collapsing |
| `diffWordWrap` | boolean | `true` | Wrap long diff lines when needed |
| `allowExternalDiffPreviews` | boolean | `false` | Allow pending edit/write diff previews for target paths outside workspace |
| `showTruncationHints` | boolean | `false` | Show truncation indicators for compacted output |
| `showRtkCompactionHints` | boolean | `false` | Show RTK compaction hints when RTK metadata exists |

### Tool ownership

Use `registerToolOverrides` to control which built-in tools this extension owns:

```json
{
  "registerToolOverrides": {
    "read": true,
    "grep": true,
    "find": true,
    "ls": true,
    "bash": true,
    "edit": true,
    "write": true
  }
}
```

Set any entry to `false` if another extension should handle that tool instead.

> Changes to tool ownership take effect after `/reload`.

### Custom tool overrides

Use `customToolOverrides` when another extension registers a noisy top-level tool and you want `pi-render` to render that tool's call/result output. Custom overrides are explicit opt-in only: unlisted or disabled tools keep their original renderers.

```json
{
  "customToolOverrides": {
    "ide_find_symbol": {
      "enabled": true,
      "kind": "generic",
      "outputMode": "summary"
    },
    "custom_mcp_gateway": {
      "enabled": true,
      "kind": "mcp",
      "outputMode": "preview",
      "preserveCallRenderer": true
    }
  }
}
```

Each entry supports:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Whether `pi-render` should decorate this custom tool |
| `kind` | string | `"generic"` | `generic` for plain compact output, or `mcp` for MCP-style call labels and result handling |
| `outputMode` | string | `"summary"` | `hidden`, `summary`, or `preview` for this custom tool's result output |
| `preserveCallRenderer` | boolean | `false` | Keep the tool's native call/header renderer while overriding only its result output |

Boolean shorthand is also accepted:

```json
{
  "customToolOverrides": {
    "ide_find_symbol": true,
    "noisy_tool_to_leave_alone": false
  }
}
```

Notes:

- Built-in tool names (`read`, `grep`, `find`, `ls`, `bash`, `edit`, `write`) are ignored here; use `registerToolOverrides` for those.
- `generic` call rendering shows the tool name and argument count, then compacts the result according to `outputMode`.
- `mcp` call rendering understands MCP proxy-style arguments such as `tool`, `server`, `search`, `describe`, and `connect`.
- Changes for already-registered tools take effect after `/reload`; tools registered later can be decorated as they register.

### Example config

```json
{
  "debug": false,
  "registerToolOverrides": {
    "read": true,
    "grep": true,
    "find": true,
    "ls": true,
    "bash": true,
    "edit": true,
    "write": true
  },
  "customToolOverrides": {
    "ide_find_symbol": {
      "enabled": true,
      "kind": "generic",
      "outputMode": "summary"
    },
    "custom_mcp_gateway": {
      "enabled": true,
      "kind": "mcp",
      "outputMode": "preview",
      "preserveCallRenderer": true
    }
  },
  "enableNativeUserMessageBox": true,
  "enableShikiCodeBlocks": true,
  "formatCodeBlocks": true,
  "shikiCodeBlockTheme": "github-dark",
  "readOutputMode": "summary",
  "searchOutputMode": "count",
  "mcpOutputMode": "summary",
  "previewLines": 12,
  "expandedPreviewMaxLines": 4000,
  "bashOutputMode": "opencode",
  "bashCollapsedLines": 15,
  "bashCommandMaxChars": 160,
  "bashIntentMode": "render-and-instruct",
  "bashIntentShowCommand": false,
  "diffViewMode": "auto",
  "diffIndicatorMode": "bars",
  "diffSplitMinWidth": 120,
  "diffCollapsedLines": 24,
  "diffWordWrap": true,
  "allowExternalDiffPreviews": false,
  "showTruncationHints": false,
  "showRtkCompactionHints": false
}
```

### Debug logging

Debug logging is disabled by default. Set `debug` to `true` in the global or active project `config.json` only when collecting diagnostics; missing or non-`true` values are treated as `false`. When enabled, diagnostics are appended to `debug/debug.log` next to the active config file, and no debug output is written to the terminal.

## Rendering notes

### Native codemode

By default, native `codemode` calls on Pi 0.99 or later show a compact title, a status summary, and a list of tools called by the script. In `/tool-display`, select **Native codemode output** and choose `summary` for status and counts, `calls` to also list nested tool calls, or `preview` to add returned output. Selections are saved automatically.

**Preview lines** limits only the returned output in `preview` mode, measured in terminal rows after wrapping. All three modes include failure and cancellation counts, even if the script completes successfully. Expand with `Ctrl+O` to see the full script, list of tool calls, and output.

### Edit and write diffs

`edit` and `write` results use the same diff renderer. In `auto` mode the extension chooses split or unified layout based on available width. On narrow panes it clamps rendered lines and shortens collapsed hint text so the diff stays readable instead of spilling past the terminal width.

While tool arguments are still streaming, partial `edit` and `write` calls can show projected pending previews. Deterministic edits render as `pending edit` diffs against current file contents, writes render as `pending overwrite` or `pending create`, and unresolved projections show a clear preview notice instead of guessing. Preview file reads are scoped to the active workspace so pending previews avoid reading paths outside the current project.

When diff input includes Pi anchored read lines such as `12#AB:content`, the renderer treats the anchor as line metadata and displays the `LINE#HASH` label in the gutter while keeping the content aligned for split, unified, and compact diff layouts.

### Write summaries

When content is available, `write` call summaries include line count and byte size information inline so you can quickly see the size of the pending write before expanding the result.

### Thinking labels

Thinking blocks are labeled during streaming and on final messages. Before the next model turn, the extension sanitizes those presentation labels out of the stored assistant context so they do not accumulate or pollute future prompts.

### Markdown code blocks

When enabled, markdown code fences in assistant, user, custom, compaction, and skill messages are rendered through Shiki's TextMate grammars for common languages such as TypeScript, JavaScript, Python, Bash, JSON, Markdown, YAML, HTML/CSS, Rust, Go, Java, Kotlin, Swift, C/C++, C#, Ruby, PHP, SQL, Dockerfile, TOML, XML, Vue, and Svelte.

`formatCodeBlocks` replaces the classic triple-backtick visual wrapper with a compact rounded panel and language label. If Shiki cannot highlight a language, the extension falls back to Pi's built-in markdown highlighter while keeping the configured code block formatting.

### Native user message box

When enabled, user prompts render inside a bordered box using Pi's native user message component. The renderer preserves markdown content more safely and normalizes ANSI/background handling to avoid odd nested background artifacts.

## Capability detection

The extension checks the current Pi environment and adjusts behavior automatically:

- **MCP tooling unavailable at startup**: MCP settings can be hidden from the modal, but the configured MCP output mode is preserved because MCP tools may register later
- **RTK optimizer unavailable**: RTK hint settings are hidden and RTK compaction hints are disabled

This keeps the UI aligned with the current environment while still allowing dynamically registered MCP tools to be styled when they appear.

## Troubleshooting

### Reload safety

`/reload` is fully supported. On reload, the extension cleans up all tool overrides, prototype patches, timers, and event handlers through its built-in disposal registry, then re-registers everything on the next session lifecycle event. No manual cleanup is needed.

### Tool ownership conflicts

If another extension is already rendering one of the built-in tools:

1. Set `registerToolOverrides.<tool>` to `false`
2. Run `/reload`
3. Use `/tool-display show` to confirm the effective ownership state

Built-in tool overrides (including `bash`) are **queued at load** and only registered during `session_start` / `before_agent_start`. Before registering, the extension re-checks `pi.getAllTools()` and yields any tool already owned by a non-builtin source (for example `pi-patty-bg-tasks` owning `bash`). Immediate load-time registration is intentionally avoided so package order cannot create a hard `Tool "bash" conflicts with ...` diagnostic.

If you still prefer an explicit config, set:

```json
{
  "registerToolOverrides": {
    "bash": false
  }
}
```

On Pi 1.1+, built-in tools owned by another extension are instead rendered
compactly through the Pi tool renderer chain (`registerToolRenderer`): the owner
keeps its execute logic and pi-ui-enhancement still applies its display renderers,
in any load order. On older Pi versions the skip behavior above applies.

### Config not loading

If your settings are not being applied:

1. Check the global Pi tool-display config (default: `~/.pi/agent/extensions/pi-ui-enhancement/config.json`, respects `PI_CODING_AGENT_DIR`)
2. Check the optional project override at `.pi/extensions/pi-ui-enhancement/config.json` (legacy `pi-tool-display` paths are still read)
3. Make sure the JSON is valid
4. Make sure you are running Pi 0.79.1 or newer and the project is trusted when expecting project overrides to apply
5. Run `/tool-display show` to inspect the effective config summary

### MCP or custom tool rendering not appearing

MCP tools are decorated via `pi.registerTool` interception, so they are captured as soon as they register regardless of lifecycle event ordering. If MCP tools still appear unstyled, check that the tool's name or parameter schema matches one of the supported MCP detection heuristics (names containing `mcp`, `server:`, `ctx_`, or parameter schemas with `mcpServer`/`serverUrl`/`server_name`).

For non-MCP extension tools, or MCP-like tools that do not match the heuristics, add the exact tool name under `customToolOverrides` and run `/reload`. Use `kind: "generic"` for ordinary tools and `kind: "mcp"` for MCP proxy-style arguments.

### MCP or RTK settings missing

Those controls only appear when the corresponding capability is available in the current Pi environment.

## Project structure

```text
pi-render/
├── index.ts                         # Extension entrypoint for Pi auto-discovery
├── src/
│   ├── index.ts                     # Bootstrap and extension registration
│   ├── capabilities.ts              # MCP/RTK capability detection
│   ├── config-modal.ts              # /tool-display settings UI and command handling
│   ├── config-store.ts              # Config load/save and normalization
│   ├── disposable.ts                # Reload-safe cleanup registry for tool overrides, patches, and timers
│   ├── diff-renderer.ts             # Edit/write diff rendering engine
│   ├── line-width-safety.ts         # Width clamping helpers for narrow panes
│   ├── pending-diff-preview.ts      # Partial edit/write preview projection helpers
│   ├── presets.ts                   # Preset definitions and matching
│   ├── render-utils.ts              # Shared rendering helpers
│   ├── shiki-codeblock-renderer.ts  # Shiki/TextMate markdown code fence renderer and formatting patch
│   ├── thinking-label.ts            # Thinking label formatting and context sanitization
│   ├── tool-overrides.ts            # Built-in, MCP, and opt-in custom renderer overrides
│   ├── types.ts                     # Shared config and type definitions
│   ├── user-message-box-markdown.ts # Markdown extraction for user message rendering
│   ├── user-message-box-native.ts   # Native user message box registration
│   ├── user-message-box-patch.ts    # Safe native render patching helpers
│   ├── user-message-box-renderer.ts # User message border renderer
│   ├── user-message-box-utils.ts    # ANSI/background normalization helpers
│   ├── write-display-utils.ts       # Write summary helpers
│   └── zellij-modal.ts              # Modal UI primitives
├── config/
│   └── config.example.json          # Starter config template
└── tests/
    ├── ansi-utils.test.ts           # ANSI utility tests including foreground RGB preservation
    ├── bash-display.test.ts         # Bash display and spinner tests
    ├── capabilities-edge.test.ts    # Capability detection edge cases
    ├── config-modal.test.ts         # Config modal tests
    ├── custom-tool-overrides.test.ts # Opt-in custom tool override tests
    ├── debug-logger-edge.test.ts    # Debug logger edge cases
    ├── diff-renderer-ansi.test.ts   # ANSI/background handling tests for diff rendering
    ├── diff-renderer-edge.test.ts   # Diff renderer edge case tests
    ├── diff-renderer-width.test.ts  # Width and background coverage tests for diff rendering
    ├── index-integration.test.ts    # Integration tests for extension lifecycle
    ├── presets-edge.test.ts         # Preset edge case tests
    ├── reload-behavior.test.ts      # Reload-safe cleanup and re-registration tests
    ├── tool-overrides-config.test.ts    # Tool override config tests
    ├── tool-overrides-registration.test.ts # Tool override registration tests
    └── tool-ui-utils.test.ts        # Utility tests for user message and diff helpers
```

## Development

```bash
# Type check
npm run build

# Run tests
npm run test

# Full verification
npm run check
```

## Related Pi Extensions

- [pi-image-tools](https://github.com/MasuRii/pi-image-tools) — Image attachment and inline preview for the Pi TUI
- [pi-hide-messages](https://github.com/MasuRii/pi-hide-messages) — Hide older chat messages without losing context
- [pi-startup-redraw-fix](https://github.com/MasuRii/pi-startup-redraw-fix) — Fix terminal redraw glitches on startup
- [pi-permission-system](https://github.com/MasuRii/pi-permission-system) — Permission enforcement for tool and command access

## License

[MIT](LICENSE)
