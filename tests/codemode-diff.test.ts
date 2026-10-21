import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Capture } from "../src/codemode-diff/capture.ts";
import {
  countChanges,
  DETAILS_KEY,
  limitChange,
  readChanges,
  writeChange,
  type Change,
} from "../src/codemode-diff/changes.ts";
import { lineCount, textFits, writeTextFits, MAX_DIFF_LINES } from "../src/codemode-diff/limits.ts";
import { coloredDiff } from "../src/codemode-diff/diff-color.ts";
import { diffSection } from "../src/codemode-diff/section.ts";
import { registerCodemodeDiffCapture } from "../src/codemode-diff/index.ts";

function passthroughTheme() {
  return {
    fg: (_c: string, t: string) => t,
    bold: (t: string) => t,
  };
}

// ─── limits ──────────────────────────────────────────────────────────────────

test("lineCount counts logical lines and treats CRLF as one ending", () => {
  assert.equal(lineCount(""), 0);
  assert.equal(lineCount("one"), 1);
  assert.equal(lineCount("a\nb\nc"), 3);
  assert.equal(lineCount("a\r\nb\r\nc"), 3);
  assert.equal(lineCount("a\n"), 1);
  assert.equal(lineCount("a", 0), 1);
});

test("textFits enforces byte and line budgets", () => {
  assert.ok(textFits("hello", 100, 10));
  assert.ok(!textFits("x".repeat(11), 10, 10));
  assert.ok(!textFits("a\n".repeat(11).trimEnd(), 100, 10));
  assert.ok(!writeTextFits("x".repeat(256 * 1024 + 1)));
});

// ─── changes ─────────────────────────────────────────────────────────────────

test("writeChange generates a diff and counts added/removed lines", () => {
  const change = writeChange("call-1", "a.txt", { kind: "text", content: "one\ntwo\n" }, "one\nTWO\nthree\n");
  assert.equal(change.tool, "write");
  assert.equal(change.kind, "overwrite");
  assert.ok(change.diff);
  const counts = countChanges(change.diff!);
  assert.equal(counts.removed, 1);
  assert.equal(counts.added, 2);
});

test("writeChange handles creates, no-ops, and empty files", () => {
  const created = writeChange("c1", "new.txt", { kind: "missing" }, "content\n");
  assert.equal(created.kind, "create");
  assert.ok(created.diff);

  const unchanged = writeChange("c2", "same.txt", { kind: "text", content: "same\n" }, "same\n");
  assert.equal(unchanged.note, "No content changes.");

  const empty = writeChange("c3", "empty.txt", { kind: "missing" }, "");
  assert.equal(empty.note, "Created an empty file.");
});

test("writeChange omits diffs for oversized or binary content", () => {
  const big = writeChange("c4", "big.txt", { kind: "text", content: "x" }, "y".repeat(300_000));
  assert.equal(big.diff, undefined);
  assert.match(big.note ?? "", /file too large/);

  const binary = writeChange("c5", "bin.dat", { kind: "text", content: "a" }, "a\0b");
  assert.match(binary.note ?? "", /[Bb]inary/);
});

test("limitChange drops oversized diffs with a note and keeps metadata", () => {
  const huge = "x".repeat(100_000);
  const change: Change = { toolCallId: "c6", tool: "edit", path: "f", kind: "edit", diff: huge, beforeBytes: 1 };
  const bounded = limitChange(change, 10, 10);
  assert.equal(bounded.diff, undefined);
  assert.match(bounded.note ?? "", /Diff omitted/);
  assert.equal(bounded.beforeBytes, 1);
});

test("readChanges validates persisted details and bounds legacy payloads", () => {
  const good = {
    [DETAILS_KEY]: {
      version: 1,
      changes: [{ toolCallId: "c7", tool: "edit", path: "f", kind: "edit", diff: "+ 1 a" }],
    },
  };
  assert.equal(readChanges(good)?.length, 1);
  assert.equal(readChanges({ [DETAILS_KEY]: { version: 2, changes: [] } }), undefined);
  assert.equal(readChanges({ [DETAILS_KEY]: { version: 1, changes: [{ toolCallId: 1 }] } }), undefined);
  assert.equal(readChanges({ something: "else" }), undefined);
  assert.equal(readChanges(undefined), undefined);
});

// ─── capture ─────────────────────────────────────────────────────────────────

test("capture tracks nested calls per codemode root with budgets", () => {
  const capture = new Capture();
  capture.start("root", "codemode");
  capture.start("n1", "edit", "root");
  capture.start("n2", "write", "root");
  capture.start("other", "codemode"); // second independent root
  capture.start("n3", "edit", "other");

  assert.ok(capture.isNested("n1"));
  assert.ok(!capture.isNested("root"));
  assert.equal(capture.rootFor("n3"), "other");
  assert.equal(capture.isNested("not-tracked"), false);

  capture.add(writeChange("n1", "one.txt", { kind: "missing" }, "a\n"));
  capture.add(writeChange("n2", "two.txt", { kind: "text", content: "b\n" }, "b\nc\n"));
  assert.equal(capture.changes("root").length, 2);
  assert.equal(capture.details("root")?.version, 1);

  // Invalidations fire when changes land.
  let invalidated = 0;
  capture.watch("root", () => invalidated++);
  capture.add(writeChange("n1", "one.txt", { kind: "text", content: "a\n" }, "z\n"));
  assert.equal(invalidated, 1);

  // Errors are annotated, not removed.
  capture.reportError("n2");
  assert.equal(capture.changes("root").find((c) => c.toolCallId === "n2")?.toolReportedError, true);

  // Ending the root detaches the batch; nested ends are no-ops.
  capture.end("n1");
  assert.equal(capture.changes("root").length, 2);
  capture.end("root");
  assert.equal(capture.changes("root").length, 0);
  assert.equal(capture.details("root"), undefined);

  capture.clear();
});

test("capture enforces the batch diff budget across changes", () => {
  const capture = new Capture();
  capture.start("root", "codemode");
  capture.start("n1", "edit", "root");
  capture.start("n2", "edit", "root");

  const bigDiff = `+ ${"a".repeat(1000)}`;
  capture.add({ toolCallId: "n1", tool: "edit", path: "big", kind: "edit", diff: Array.from({ length: MAX_DIFF_LINES + 10 }, () => bigDiff).join("\n") });
  assert.equal(capture.changes("root")[0]?.diff, undefined);
  assert.match(capture.changes("root")[0]?.note ?? "", /Diff omitted/);
});

// ─── rendering ───────────────────────────────────────────────────────────────

test("coloredDiff colors added, removed, and context lines", () => {
  const styled = coloredDiff(" 1 ctx\n- 2 old\n+ 2 new", passthroughTheme());
  assert.ok(styled.includes("- 2 old"));
  assert.ok(styled.includes("+ 2 new"));
});

test("diffSection renders a summary, per-change headers, and collapse hints", () => {
  const changes = [
    writeChange("c1", "src/a.ts", { kind: "text", content: "a\n" }, "b\n"),
    writeChange("c2", "src/b.ts", { kind: "missing" }, "b\n"),
    writeChange("c3", "src/c.ts", { kind: "text", content: "c\n" }, "d\n"),
    writeChange("c4", "src/d.ts", { kind: "text", content: "d\n" }, "e\n"),
  ];
  const collapsed = diffSection(changes, false, passthroughTheme());
  const collapsedText = collapsed.render(100).join("\n");
  assert.match(collapsedText, /File changes \(4\) · 4 files/);
  assert.match(collapsedText, /src\/a\.ts/);
  assert.match(collapsedText, /1 more change/);

  const expanded = diffSection(changes, true, passthroughTheme());
  const expandedText = expanded.render(100).join("\n");
  assert.match(expandedText, /src\/d\.ts/);
  assert.ok(!expandedText.includes("more changes"));

  assert.equal(diffSection([], false, passthroughTheme()).render(100).length, 0);
});

test("diffSection marks diffs unavailable and tool-reported errors", () => {
  const changes: Change[] = [
    { toolCallId: "c1", tool: "write", path: "big.bin", kind: "overwrite", note: "Diff omitted: file too large." },
    { toolCallId: "c2", tool: "write", path: "late.txt", kind: "create", diff: "+ 1 x", toolReportedError: true },
  ];
  const text = diffSection(changes, true, passthroughTheme()).render(100).join("\n");
  assert.match(text, /1 diff unavailable/);
  assert.match(text, /reported an error/);
});

// ─── event wiring ────────────────────────────────────────────────────────────

type Handler = (event?: unknown, ctx?: unknown) => unknown;

function captureHandlers() {
  const handlers = new Map<string, Handler>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
  };
  const capture = new Capture();
  registerCodemodeDiffCapture(pi as never, capture);
  return { handlers, capture };
}

test("tool events capture nested edits and persist details on the codemode result", () => {
  const { handlers, capture } = captureHandlers();

  handlers.get("tool_execution_start")?.({ toolCallId: "root", toolName: "codemode" });
  handlers.get("tool_execution_start")?.({ toolCallId: "e1", toolName: "edit", parentToolCallId: "root" });

  const editResult = handlers.get("tool_result")?.({
    toolCallId: "e1",
    toolName: "edit",
    isError: false,
    input: { path: "src/a.ts" },
    details: { diff: "+ 1 new\n- 1 old" },
  });
  assert.equal(editResult, undefined, "nested edit results are not rewritten");

  const rootResult = handlers.get("tool_result")?.({
    toolCallId: "root",
    toolName: "codemode",
    details: { calls: [{ name: "edit", status: "ok" }] },
  }) as { details: Record<string, unknown> } | undefined;

  assert.ok(rootResult?.details);
  const payload = rootResult.details[DETAILS_KEY] as { version: number; changes: Change[] };
  assert.equal(payload.version, 1);
  assert.equal(payload.changes.length, 1);
  assert.equal(payload.changes[0].path, "src/a.ts");
  assert.equal(readChanges(rootResult.details)?.length, 1, "persisted payload round-trips through validation");
});

test("nested tool errors are annotated and the batch ends with the root", () => {
  const { handlers, capture } = captureHandlers();
  handlers.get("tool_execution_start")?.({ toolCallId: "root", toolName: "codemode" });
  handlers.get("tool_execution_start")?.({ toolCallId: "w1", toolName: "write", parentToolCallId: "root" });
  capture.add(writeChange("w1", "f.txt", { kind: "missing" }, "x\n"));

  handlers.get("tool_execution_end")?.({ toolCallId: "w1", toolName: "write", isError: true });
  assert.equal(capture.changes("root")[0]?.toolReportedError, true);

  handlers.get("tool_execution_end")?.({ toolCallId: "root", toolName: "codemode" });
  assert.equal(capture.changes("root").length, 0);
});

test("unrelated tool activity never enters a batch", () => {
  const { handlers, capture } = captureHandlers();
  handlers.get("tool_execution_start")?.({ toolCallId: "solo", toolName: "edit" });
  handlers.get("tool_result")?.({
    toolCallId: "solo",
    toolName: "edit",
    isError: false,
    input: { path: "x" },
    details: { diff: "+ 1 y" },
  });
  assert.equal(capture.details("solo"), undefined);
});

test("session lifecycle clears capture state", () => {
  const { handlers, capture } = captureHandlers();
  handlers.get("tool_execution_start")?.({ toolCallId: "root", toolName: "codemode" });
  handlers.get("tool_execution_start")?.({ toolCallId: "e1", toolName: "edit", parentToolCallId: "root" });
  capture.add({ toolCallId: "e1", tool: "edit", path: "p", kind: "edit", diff: "+ 1 x" });

  handlers.get("session_start")?.();
  assert.equal(capture.changes("root").length, 0);
});

// ─── write integration ───────────────────────────────────────────────────────

test("writeChange reads real files through the snapshot-free path", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-ui-enhancement-cmdiff-"));
  try {
    const file = join(dir, "real.txt");
    writeFileSync(file, "before\n", "utf8");
    const change = writeChange("c9", file, { kind: "text", content: "before\n" }, "after\n");
    assert.ok(change.diff);
    assert.equal(countChanges(change.diff!).added, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
