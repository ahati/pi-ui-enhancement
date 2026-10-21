import { keyText, truncateToVisualLines } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { countChanges, type Change } from "./changes.js";
import { coloredDiff, type CodemodeDiffTheme } from "./diff-color.js";

export const PREVIEW_CHANGES = 3;
export const PREVIEW_LINES = 8;

/** File contents/path names must not inject terminal escape sequences. */
function safeText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "�").replace(/\t/g, "   ");
}

export function inlineText(text: string): string {
  return safeText(text).replace(/\n/g, "\\n");
}

function expandHint(theme: CodemodeDiffTheme): string {
  let key: string | undefined;
  try {
    key = keyText("app.tools.expand");
  } catch {
    key = undefined;
  }
  return theme.fg("dim", key ? `${key} to expand` : "expand tool output");
}

class DiffPreview implements Component {
  private width?: number;
  private lines?: string[];

  constructor(private text: string, private theme: CodemodeDiffTheme) {}

  render(width: number): string[] {
    if (this.width !== width || !this.lines) {
      // "start" keeps the tail of long diffs; newer Pi declares the 5th
      // parameter, older Pi accepts it at runtime (verified on 0.80.3).
      const truncate = truncateToVisualLines as unknown as (
        text: string, maxVisualLines: number, width: number, paddingX?: number, from?: string,
      ) => { visualLines: string[]; skippedCount: number };
      const { visualLines, skippedCount } = truncate(this.text, PREVIEW_LINES, width, 0, "start");
      this.lines = visualLines;
      if (skippedCount) {
        this.lines = [...visualLines, truncateToWidth(
          `${this.theme.fg("muted", `… (${skippedCount} more lines,`)} ${expandHint(this.theme)}${this.theme.fg("muted", ")")}`,
          width,
          "…",
        )];
      }
      this.width = width;
    }
    return this.lines;
  }

  invalidate(): void {
    this.width = undefined;
    this.lines = undefined;
  }
}

/**
 * The "File changes" section appended to codemode call rendering. Adapted from
 * hyein-cbio/pi-codemode-diff (src/render.ts); themed through the caller.
 */
export function diffSection(changes: readonly Change[], expanded: boolean, theme: CodemodeDiffTheme): Container {
  const section = new Container();
  if (!changes.length) return section;
  section.addChild(new Spacer(1));
  // Count the whole batch, including changes hidden by the collapsed preview.
  // Paths are compared as recorded; counting must not perform filesystem reads.
  const files = new Set(changes.map(change => change.path)).size;
  // An empty diff is available (e.g. an unchanged write), not missing.
  const unavailable = changes.filter(change => change.diff === undefined).length;
  const summary = `File changes (${changes.length}) · ${files} ${files === 1 ? "file" : "files"}` +
    (unavailable ? ` · ${unavailable} ${unavailable === 1 ? "diff" : "diffs"} unavailable` : "");
  section.addChild(new Text(theme.fg("toolTitle", theme.bold(summary)), 0, 0));

  const shown = expanded ? changes : changes.slice(0, PREVIEW_CHANGES);
  for (const change of shown) {
    section.addChild(new Spacer(1));
    const { added, removed } = countChanges(change.diff ?? "");
    const label = change.kind === "create" ? "write · new" : change.kind === "overwrite" ? "write · overwrite" : change.tool;
    const counts = change.diff === undefined ? "" : ` ${theme.fg("toolDiffAdded", `+${added}`)} ${theme.fg("toolDiffRemoved", `-${removed}`)}`;
    const header = `${theme.fg("toolTitle", inlineText(change.path))} ${theme.fg("muted", `[${label}]`)}${counts}`;
    section.addChild(new Text(header, 0, 0));
    if (change.diff) {
      const styled = coloredDiff(safeText(change.diff), theme);
      section.addChild(expanded ? new Text(styled, 0, 0) : new DiffPreview(styled, theme));
    }
    if (change.note) section.addChild(new Text(theme.fg("muted", inlineText(change.note)), 0, 0));
    if (change.toolReportedError) {
      section.addChild(new Text(theme.fg("warning", "File change observed, but the tool reported an error or cancellation."), 0, 0));
    }
  }
  if (shown.length < changes.length) {
    section.addChild(new Text(
      `${theme.fg("muted", `… (${changes.length - shown.length} more changes,`)} ${expandHint(theme)}${theme.fg("muted", ")")}`,
      0, 0,
    ));
  }
  return section;
}
