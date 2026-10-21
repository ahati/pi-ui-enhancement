# Fork mining notes

Survey of every fork of `MasuRii/pi-tool-display` (56 total, 23 with commits
ahead of upstream main at survey time). Analysis was run fork-by-fork; results
below record what was merged into this repo and what remains available.

## Merged into pi-ui-enhancement

| Source | Commit(s) | Change |
| --- | --- | --- |
| MrDaGree | `39a0922`, `4137139` | Deferred built-in ownership + Pi 1.1 `registerToolRenderer` chain so externally owned tools (pi-ssh-remote) keep compact rendering |
| jiwnchoi/pi-render | `45e6bf4` | Shiki/TextMate code-block rendering |
| PeachIceTea | `b084e45`, `f1c3ca0` | Bash result `Text` component caching across partial updates (TUI differential renderer perf) |
| Gucvii | `cef68b8` | Stop MCP discovery retry timers on every `before_agent_start` |
| neumie | `cccb686` | Secure workspace path resolution (symlink cycles, dangling links, `O_NOFOLLOW` fd reads) |
| leohenon | `9c36d82` | Explicit `diffAddedBg`/`diffRemovedBg`/emphasis background colors |
| maplezzk | `9f8d0bb` | Usable global `enabled` switch (command stays registered while disabled) |
| williamcr01 | `9b43df0` (partial) | Peer range widened to Pi 1.x |

Upstream PRs merged separately: #46, #48, #49, #50, #40, #34, #32, #31, #28, #27.

## Available but not merged (deferred)

These were reviewed and look valuable, but each is a large surface that would
conflict heavily with the merged architecture. Recorded here for follow-up:

- **neumie `4ef2c99`** — delete the `pi.registerTool` interceptor and MCP retry
  timers entirely. They are dead code on Pi >= 0.80.6 (per-extension
  `registerTool`; `getAllTools()` returns metadata copies) but may still matter
  for the older end of the supported peer range. Revisit if the peer range
  floor moves to >= 0.80.6.
- **nicobailon `08912e0`** — thinking labels via `registerMarkdownTransformer`
  instead of rewriting content on `message_end`; stops persisting
  escape-coded labels into session files. Needs `registerMarkdownTransformer`
  (Pi >= 1.0) and a rewrite of `thinking-label.ts`.
- **zhangyu-ch `bc2f0fe`** — wildcard `customToolOverrides["*"]`, argument
  summaries (`name k="v" …`), and a generic render-time prototype patch
  (fixes upstream issue #44 for custom tool overrides on Pi 0.84+). Partially
  overlaps our MCP-only `tool-execution-patch.ts`.
- **maplezzk `43f2401`** — public `registerResultRenderMiddleware` API so other
  extensions can append/replace result rendering of owned tools.
- **williamcr01 `2673a61`** — semantic bash command classification
  (read/search/list/edit intent from the command text, 945-line parser);
  bash edits rendered through the diff UI.
- **nathanstaines `faf415a`+`374972d`** — opt-in tool output border styling
  (`toolOutputStyle: background | border`) via a `ToolExecutionComponent.render`
  prototype patch.
- **daydaylx `4da62ca`+`dd33d13`** — opt-in compact timeline layout
  (one line per tool call, subagent row model).
- **neumie `347c342`+`1525957`** — `userMessageStyle: bordered | label-only`.
- **ginwzy `e98ff54`+`0ddb854`** — colored pill badges for tool headers.
- **nantas `bd352d4`** (MCP `MCP: name` label colon fix), **`c192370`**
  (yield grep/find to pi-fff via `PI_FFF_MODE`), **Ayagikei `e4e6d5e`**
  (hashline `replace` tool adapter) — small, opinionated; each is a few lines
  to port if the need arises.

## Rejected

- maplezzk's 30-commit "output distillation" series (self-reverted upstream of
  `43f2401`), cybershape's diff-renderer deletion, hen7777777's hardcoded
  diff colors (removes previews), Dima-369's tool disabling (config already
  covers it), domye/rezkycodes/others' stale snapshots, branding-only forks
  (4cya, ooo-mmm), CI/lockfile/version churn.
