<div align="center">

# pi-ui-enhancement

[![install](https://img.shields.io/badge/install-git%3Agithub.com%2Fahati%2Fpi--ui--enhancement-blue?style=for-the-badge)](https://github.com/ahati/pi-ui-enhancement)
[![GitHub](https://img.shields.io/badge/GitHub-ahati%2Fpi--ui--enhancement-181717?style=for-the-badge&logo=github)](https://github.com/ahati/pi-ui-enhancement)
[![License](https://img.shields.io/github/license/ahati/pi-ui-enhancement?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=for-the-badge)]()

OpenCode-style tool rendering for the [Pi coding agent](https://github.com/mariozechner/pi) — the maintained successor to
[MasuRii/pi-tool-display](https://github.com/MasuRii/pi-tool-display).

`pi-ui-enhancement` keeps tool calls compact by default, adds richer diff rendering for file edits, and improves a few core chat UI details such as thinking labels and the native user prompt box.

</div>

## Features

- **Compact built-in tool rendering** for `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write`
- **MCP-aware rendering** with hidden, summary, and preview modes, including render-time support on Pi 0.80.6+ and the official renderer chain on Pi 1.x
- **Native codemode rendering** with `summary`, `calls`, and `preview` modes — and **file-change diffs inside codemode calls** that never enter the model's context
- **Adaptive edit/write diffs** with split or unified layouts, syntax highlighting, inline emphasis, explicit or theme-derived colors, and narrow-pane width clamping
- **Workspace-scoped projected pending edit/write previews** that show `pending edit`, `pending overwrite`, and `pending create` diffs while partial tool calls are still streaming
- **Bash intent headers** — leading `# tool:` / `# intent:` comments render as the call header instead of long flag sets and absolute paths, with optional command truncation
- **Shiki/TextMate markdown code fence highlighting** with common bundled grammars and configurable Shiki themes
- **Three presets**: `opencode`, `balanced`, and `verbose`
- **Accent-colored thinking labels** during streaming and final message rendering, with context sanitization so presentation labels never leak into future model turns
- **Per-tool ownership toggles** plus **project-level config** with trust gating, so this extension coexists with other renderer and tool-owning extensions
- **Optional native user message box** with markdown-aware rendering and safer ANSI/background handling
- **Adapter API for renderer consumers** through the `pi-ui-enhancement/tool-display-api-consumer` subpath export

## What this fork adds

`pi-ui-enhancement` takes over where the upstream project stopped. `MasuRii/pi-tool-display` last saw activity on **July 3, 2026**, with the `0.5.0` release. Community work continued to arrive after that date — ten pull requests were open at fork time, the oldest opened on June 29, 2026 — and none of them were reviewed or merged. That is not a criticism of the original author, who built a widely used extension and kept it healthy through many releases; it simply means fixes that contributors had already written and tested were not landing. This fork gives that work a home, credits every author, and keeps the extension aligned with Pi releases.

The fork is a drop-in replacement: same `/tool-display` command, same config layout (legacy `pi-tool-display` directories are still read), and the same cross-package adapter API.

### Merged upstream pull requests

All ten pull requests that were open upstream at fork time are merged here:

- **#46 — IdrisGit (Idris Gadi)**: accent-colored collapsed thinking label.
- **#48 — chrismdp (Chris Parsons)**: `bashCommandMaxChars` truncates the displayed command to a single line.
- **#49 — mendeljacks (Mendel Jacks)**: `# intent:` / `# tool:` comment headers render as the bash call header, plus the optional system-prompt guideline (`bashIntentMode`).
- **#50 — w-winter (wren)**: native codemode rendering with `summary`, `calls`, and `preview` modes via `codemodeOutputMode`.
- **#40 — edahlseng (Eric Dahlseng)**: `allowExternalDiffPreviews` for target files outside the workspace.
- **#34 — RaviTharuma (Ravi Tharuma)**: built-in tool overrides are deferred to `session_start` / `before_agent_start`, avoiding startup tool conflicts (for example with `pi-patty-bg-tasks`).
- **#32 — neumie (Jakub Neumann)**: decorate late-registered tools before Pi snapshots them, and `preserveCallRenderer` for custom tool overrides.
- **#31 — jeremynikolic (Jeremy Nikolic)**: MCP tool rendering through a `ToolExecutionComponent` prototype patch (Pi 0.80.6+).
- **#28 — pnd280 (Pham Ngoc Duong)**: ownership-detection refactor and isolated temp-dir config tests. Its eager-registration part was superseded by #34; the helpers and tests it introduced are what survived.
- **#27 — TxHawks (Jonathan Pollak)**: project-level config at `.pi/extensions/pi-ui-enhancement/config.json`, global/project scopes with trust gating, `--global` / `--project` flags, and overlay saves.

### Community fork contributions

- **jiwnchoi (Jiwon Choi, [jiwnchoi/pi-render](https://github.com/jiwnchoi/pi-render))**: Shiki/TextMate code-block rendering (`enableShikiCodeBlocks`, `formatCodeBlocks`, `shikiCodeBlockTheme`) and a fix for diff-preview path resolution when the working directory is a symlink.
- **MrDaGree**: deferring built-in ownership to `session_start`, independently authored and synthesized with PR #34, plus the Pi 1.1+ `registerToolRenderer` chain so externally owned tools (such as `pi-ssh-remote`) keep compact rendering in any load order.

### Cherry-picked fixes

Ported by hand from community forks, with the original authors credited:

- **PeachIceTea (Jonas Thiem)**: bash result `Text` component caching across partial updates for TUI redraw performance.
- **Gucvii**: stopped the MCP discovery retry-timer spiral that ran on every agent turn.
- **neumie (Jakub Neumann)**: secure workspace path resolution — symlink-cycle detection, path canonicalization, and `O_NOFOLLOW` file-descriptor reads with TOCTOU hardening.
- **leohenon**: explicit diff background colors (`diffAddedBg`, `diffRemovedBg`, and emphasis variants).
- **maplezzk**: a usable global `enabled` switch; `/tool-display` stays reachable while rendering is disabled.
- **williamcr01**: Pi 1.x peer-range compatibility (partially taken — the peer range widening).
- **hyein-cbio**: `pi-codemode-diff`, integrated here as `src/codemode-diff/`: edit/write diffs render inside codemode calls without entering model context (`codemodeShowFileDiffs`).

### Fork maintenance

Maintained by **ahati**. This covers the work that is not a single upstream patch: merging and conflict resolution across all ten pull requests, both community forks, and the cherry-picked fixes — each merge commit documents the decisions taken and what was dropped. On top of that the fork enables TypeScript strict mode across `src/` and `tests/`, rebrands the package to `pi-ui-enhancement` while still reading legacy `pi-tool-display` config paths, targets Pi 1.4 (dev dependencies on `1.4.0`, official `registerToolRenderer` preferred with the prototype patches kept as a 0.8x fallback), and records the full fork-mining survey in [FORK-NOTES.md](docs/FORK-NOTES.md).

### Attribution

| Author | Source | Contribution |
|--------|--------|--------------|
| IdrisGit (Idris Gadi) | upstream PR #46 | Accent-colored collapsed thinking label |
| chrismdp (Chris Parsons) | upstream PR #48 | `bashCommandMaxChars` display truncation |
| mendeljacks (Mendel Jacks) | upstream PR #49 | `# intent:` / `# tool:` bash headers, `bashIntentMode` |
| w-winter (wren) | upstream PR #50 | Native codemode rendering, `codemodeOutputMode` |
| edahlseng (Eric Dahlseng) | upstream PR #40 | `allowExternalDiffPreviews` |
| RaviTharuma (Ravi Tharuma) | upstream PR #34 | Deferred built-in tool overrides at session lifecycle |
| neumie (Jakub Neumann) | upstream PR #32 + cherry-pick | Late-tool decoration, `preserveCallRenderer`, symlink-hardened path resolution |
| pnd280 (Pham Ngoc Duong) | upstream PR #28 | Ownership-detection helpers, isolated config tests |
| jeremynikolic (Jeremy Nikolic) | upstream PR #31 | MCP rendering via prototype patch (Pi 0.80.6+) |
| TxHawks (Jonathan Pollak) | upstream PR #27 | Project-level config, scopes, trust gating, overlay saves |
| jiwnchoi (Jiwon Choi) | jiwnchoi/pi-render | Shiki code blocks, symlinked-cwd preview fix |
| MrDaGree | MrDaGree/pi-tool-display | Deferred ownership, Pi 1.1 renderer chain |
| PeachIceTea (Jonas Thiem) | fork cherry-pick | Bash result `Text` caching |
| Gucvii | fork cherry-pick | Per-turn MCP discovery timer fix |
| leohenon | fork cherry-pick | Explicit diff background colors |
| maplezzk | fork cherry-pick | Usable global `enabled` switch |
| williamcr01 | fork cherry-pick | Pi 1.x peer-range compatibility |
| hyein-cbio | pi-codemode-diff | Edit/write diffs inside codemode calls |
| ahati | this fork | Merge and conflict resolution, strict TypeScript, rebrand, Pi 1.4 targeting |
| MasuRii | pi-tool-display | Original project and base implementation |

The original project is **MasuRii**'s `pi-tool-display`, and it remains the foundation of this package. Its earlier merged contributors — tuansondinh, w-winter, badboiririi, tynanbe, and dependabot — shaped the code this fork started from.

## Installation

### Git repository (recommended)

```bash
pi install git:github.com/ahati/pi-ui-enhancement
```

This clones the repository into `~/.pi/agent/git/github.com/ahati/pi-ui-enhancement` and installs its dependencies. Update it later with:

```bash
pi update git:github.com/ahati/pi-ui-enhancement
```

### Local extension folder

Place this folder in one of Pi's auto-discovery locations:

```text
# Global default (when PI_CODING_AGENT_DIR is unset)
~/.pi/agent/extensions/pi-ui-enhancement

# Project-specific
.pi/extensions/pi-ui-enhancement
```

### npm package

Not published to npm yet. Once it is, the same extension will be installable as:

```bash
pi install npm:pi-ui-enhancement
```

Until then, use the Git install above or the local extension folder.

When upgrading from `pi-tool-display`, remove the old extension from the same location so both packages do not render the same tools. Your existing config is picked up from the legacy directory automatically.

## Usage

### Interactive settings

Open the settings modal:

```text
/tool-display
```

The modal exposes the day-to-day controls most people change regularly:

- global on/off switch
- preset profile
- read output mode
- grep/find/ls output mode
- native codemode output (`summary`, `calls`, or `preview`) and codemode file diffs
- MCP output mode (when MCP is available)
- preview line count and bash collapsed line count
- bash output mode
- diff layout mode and diff indicators
- external diff previews
- Shiki code highlighting and code block box toggles
- native user message box toggle

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

Other extensions can opt into `pi-ui-enhancement` rendering without directly depending on its load order by importing the consumer helper:

```ts
import { decorateToolForDisplay, decorateMcpToolForDisplay } from "pi-ui-enhancement/tool-display-api-consumer";
```

`decorateToolForDisplay(tool, adapter)` applies the runtime decoration immediately when `pi-ui-enhancement` is loaded, or queues the decoration until the API becomes available. Use adapter options such as `kind: "read" | "edit" | "mcp" | "generic"` to select the renderer family; `decorateMcpToolForDisplay(tool)` is the shortcut for MCP-style tools. The API symbols themselves keep their original `pi-tool-display.api.v1` names so extensions built against upstream keep working.

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

## Bash Output Modes

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
tool you are calling through (`bash`) says nothing about the command and is worse than omitting the line.
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
tool supplies one, while `# tool:` still applies. The guideline is only appended when a system prompt exists.

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

`bashCommandMaxChars` truncates the *collapsed* command to one line of at most that many characters, with an
ellipsis and ` ; ` separators instead of line breaks. `0` (the default) shows the full command.

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
| `enabled` | boolean | `true` | Global switch for all rendering and tool ownership; `/tool-display` stays available when off so it can be turned back on |
| `debug` | boolean | `false` | Opt-in file logging for extension diagnostics; missing values are treated as `false` |
| `registerToolOverrides` | object | all `true` | Built-in tool ownership flags |
| `customToolOverrides` | object | `{ "*": … }` | Rendering rules for non-built-in extension tools. The shipped `"*"` wildcard decorates every third-party tool (compact call line + summarized output); add an exact-name entry to override one tool, or `"*": { "enabled": false }` to turn decorate-all off |
| `enableNativeUserMessageBox` | boolean | `false` | Bordered user prompt rendering (off by default; user prompts keep Pi's native look) |
| `enableShikiCodeBlocks` | boolean | `true` | Use Shiki's TextMate grammar renderer for markdown code fences when the language is supported |
| `formatCodeBlocks` | boolean | `true` | Render markdown code fences as compact bordered code panels instead of raw triple-backtick blocks |
| `shikiCodeBlockTheme` | string | `"github-dark"` | Shiki theme for code fences: `github-dark`, `github-light`, `dark-plus`, `light-plus`, `min-dark`, `min-light`, `one-dark-pro`, `vitesse-dark`, or `vitesse-light` |
| `readOutputMode` | string | `"hidden"` | `hidden`, `summary`, or `preview` |
| `searchOutputMode` | string | `"hidden"` | `hidden`, `count`, or `preview` |
| `mcpOutputMode` | string | `"hidden"` | `hidden`, `summary`, or `preview` |
| `codemodeOutputMode` | string | `"calls"` | `summary` shows status and counts, `calls` also lists nested tool calls, and `preview` adds output limited by `previewLines` |
| `codemodeShowFileDiffs` | boolean | `true` | Append the `File changes` diff section (edit/write changes made inside codemode runs) to codemode results |
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
| `diffAddedBg` | string | *(theme mix)* | Explicit `#RRGGBB` background for added diff rows; invalid values fall back to the theme-derived color |
| `diffRemovedBg` | string | *(theme mix)* | Explicit `#RRGGBB` background for removed diff rows |
| `diffAddedEmphasisBg` | string | *(theme mix)* | Explicit `#RRGGBB` background for emphasized added spans; theme-derived when unset |
| `diffRemovedEmphasisBg` | string | *(theme mix)* | Explicit `#RRGGBB` background for emphasized removed spans; theme-derived when unset |
| `diffSyntaxHighlighting` | string | `"shiki"` | Code coloring inside edit/write diffs: `shiki` (block-level TextMate highlighting), `basic` (pi's per-line highlighter), or `off` |
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

Every tool call is decorated by default. Built-in tools, MCP tools, and codemode use their specialized renderers; any other tool (third-party extension tools such as `apply_patch`, `todo`, or `web_search`) gets a compact call line and a summarized result through the shipped `"*"` wildcard.

`customToolOverrides` tunes that behavior:

- an **exact-name entry** overrides the wildcard for one tool (`kind`, `outputMode`, `preserveCallRenderer`);
- `"*": { "enabled": false }` turns decorate-all off, so unknown tools keep their native renderers;
- `"customToolOverrides": {}` does the same as a whole (an explicit object replaces the shipped default).

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
| `enabled` | boolean | `true` | Whether `pi-ui-enhancement` should decorate this custom tool |
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
  "enabled": true,
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
  "customToolOverrides": {},
  "enableNativeUserMessageBox": true,
  "enableShikiCodeBlocks": true,
  "formatCodeBlocks": true,
  "shikiCodeBlockTheme": "github-dark",
  "readOutputMode": "summary",
  "searchOutputMode": "count",
  "mcpOutputMode": "summary",
  "codemodeOutputMode": "calls",
  "codemodeShowFileDiffs": true,
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
  "diffAddedBg": "#14351f",
  "diffRemovedBg": "#3a1d20",
  "diffAddedEmphasisBg": "#1d5230",
  "diffRemovedEmphasisBg": "#57262b",
  "diffSyntaxHighlighting": "shiki",
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

#### Codemode file diffs

When a codemode script runs `edit` or `write` tools, their diffs are captured at execution time and appended to the codemode result as a `File changes` section: per-file headers with `+added`/`-removed` counts, word-highlighted line diffs, and notes for changes whose diff exceeded the display budget (or was binary/oversized). Collapsed results preview up to 3 changes and 8 lines each; expanding shows everything.

The diffs are display-only: they are stored in the result's rendering metadata (never in model-facing content), batched under byte/line budgets, and validated when a resumed session renders them again. Writes that completed but whose tool call later reported an error or cancellation are annotated. Disable the section with `codemodeShowFileDiffs: false`.

### Edit and write diffs

`edit` and `write` results use the same diff renderer. In `auto` mode the extension chooses split or unified layout based on available width. On narrow panes it clamps rendered lines and shortens collapsed hint text so the diff stays readable instead of spilling past the terminal width.

While tool arguments are still streaming, partial `edit` and `write` calls can show projected pending previews. Deterministic edits render as `pending edit` diffs against current file contents, writes render as `pending overwrite` or `pending create`, and unresolved projections show a clear preview notice instead of guessing. Preview file reads are scoped to the active workspace, with symlink-safe canonicalization, unless `allowExternalDiffPreviews` is enabled.

When diff input includes Pi anchored read lines such as `12#AB:content`, the renderer treats the anchor as line metadata and displays the `LINE#HASH` label in the gutter while keeping the content aligned for split, unified, and compact diff layouts.

### Write summaries

When content is available, `write` call summaries include line count and byte size information inline so you can quickly see the size of the pending write before expanding the result.

### Thinking labels

Thinking blocks are labeled during streaming and on final messages; the collapsed label uses the theme accent color so it stands out without competing with content. Before the next model turn, the extension sanitizes those presentation labels out of the stored assistant context so they do not accumulate or pollute future prompts.

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

On Pi 1.1+, built-in tools owned by another extension are instead rendered compactly through the Pi tool renderer chain (`registerToolRenderer`): the owner keeps its execute logic and `pi-ui-enhancement` still applies its display renderers, in any load order. On older Pi versions the skip behavior above applies.

### Config not loading

If your settings are not being applied:

1. Check the global config (default: `~/.pi/agent/extensions/pi-ui-enhancement/config.json`, respects `PI_CODING_AGENT_DIR`)
2. Check the optional project override at `.pi/extensions/pi-ui-enhancement/config.json` (legacy `pi-tool-display` paths are still read)
3. Make sure the JSON is valid
4. Make sure you are running Pi 0.79.1 or newer and the project is trusted when expecting project overrides to apply
5. Run `/tool-display show` to inspect the effective config summary

### MCP or custom tool rendering not appearing

MCP tools are decorated through `pi.registerTool` interception, so they are captured as soon as they register regardless of lifecycle event ordering; render-time patches and the Pi 1.x renderer chain cover tools registered outside that path. If MCP tools still appear unstyled, check that the tool's name or parameter schema matches one of the supported MCP detection heuristics (names containing `mcp`, `server:`, `ctx_`, or parameter schemas with `mcpServer`/`serverUrl`/`server_name`).

For non-MCP extension tools, or MCP-like tools that do not match the heuristics, add the exact tool name under `customToolOverrides` and run `/reload`. Use `kind: "generic"` for ordinary tools and `kind: "mcp"` for MCP proxy-style arguments.

### MCP or RTK settings missing

Those controls only appear when the corresponding capability is available in the current Pi environment.

## Project structure

```text
pi-ui-enhancement/
├── index.ts                            # Extension entrypoint for Pi auto-discovery
├── tool-display-api-consumer.{js,d.ts} # Dependency-free adapter for other extensions
├── src/
│   ├── index.ts                        # Bootstrap and extension registration
│   ├── config-controller.ts            # Global/project scopes and trust handling
│   ├── config-store.ts                 # Config load/save, normalization, legacy path fallback
│   ├── config-modal.ts                 # /tool-display settings UI and command handling
│   ├── tool-overrides.ts               # Built-in, MCP, and opt-in custom renderer overrides
│   ├── tool-execution-patch.ts         # MCP render-time patch and Pi renderer chain
│   ├── codemode-display.ts             # Native codemode call and result rendering
│   ├── codemode-diff/                  # Edit/write diff capture for codemode runs
│   ├── bash-display.ts                 # Bash call header, intent rendering, output modes
│   ├── bash-intent.ts                  # # intent:/# tool: parsing and prompt guideline
│   ├── diff-renderer.ts                # Edit/write diff rendering engine
│   ├── diff-presentation.ts            # Diff colors, layout, and presentation helpers
│   ├── pending-diff-preview.ts         # Partial edit/write preview projection
│   ├── shiki-codeblock-renderer.ts     # Shiki/TextMate markdown code fence renderer
│   ├── thinking-label.ts               # Thinking label formatting and sanitization
│   ├── user-message-box-*.ts           # Native user message box rendering
│   ├── disposable.ts                   # Reload-safe cleanup registry
│   ├── capabilities.ts                 # MCP/RTK capability detection
│   ├── presets.ts                      # Preset definitions and matching
│   └── types.ts                        # Shared config and type definitions
├── config/config.example.json          # Starter config template
└── tests/                              # 37 test files run with tsx --test
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

The codebase is TypeScript in strict mode across `src/` and `tests/`. The fork-mining survey and the reasoning behind which community changes were taken, deferred, or rejected live in [FORK-NOTES.md](docs/FORK-NOTES.md); release-level history is in [CHANGELOG.md](CHANGELOG.md).

## Related Pi Extensions

- [pi-image-tools](https://github.com/MasuRii/pi-image-tools) — Image attachment and inline preview for the Pi TUI
- [pi-hide-messages](https://github.com/MasuRii/pi-hide-messages) — Hide older chat messages without losing context
- [pi-startup-redraw-fix](https://github.com/MasuRii/pi-startup-redraw-fix) — Fix terminal redraw glitches on startup
- [pi-permission-system](https://github.com/MasuRii/pi-permission-system) — Permission enforcement for tool and command access

## License

[MIT](LICENSE). `pi-ui-enhancement` is a fork of [MasuRii/pi-tool-display](https://github.com/MasuRii/pi-tool-display); the original copyright and license are preserved, and every incorporated contribution is credited in [What this fork adds](#what-this-fork-adds).
