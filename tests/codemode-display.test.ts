import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, ToolExecutionComponent, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text, type Component, type TUI } from "@earendil-works/pi-tui";
import { registerCodemodeDisplay } from "../src/codemode-display.ts";
import { disposeAll, resetDisposed } from "../src/disposable.ts";
import { normalizeToolDisplayConfig } from "../src/config-store.ts";

initTheme("dark", false);

const script = "const value = await tools.read({ path: 'example.ts' });\nreturn value;";
const output = "RESULT_ONE\nRESULT_TWO\nRESULT_THREE";
const renderers = {
  renderCall: (() => new Text(script, 0, 0)) satisfies NonNullable<ToolDefinition["renderCall"]>,
  renderResult: ((result) => new Text(
    ["NATIVE CALL TRACE", ...result.content.flatMap((block) => block.type === "text" ? [block.text] : [])].join("\n"),
    0, 0,
  )) satisfies NonNullable<ToolDefinition["renderResult"]>,
};

function install(path = "builtin:codemode", getConfig = () => normalizeToolDisplayConfig({})) {
  return installWithCapture(path, getConfig);
}

function installWithCapture(path: string, getConfig: () => ReturnType<typeof normalizeToolDisplayConfig>, capture?: import("../src/codemode-diff/capture.ts").Capture) {
  resetDisposed();
  const handlers = new Map<string, () => void>();
  registerCodemodeDisplay({
    getAllTools: () => [{ name: "codemode", sourceInfo: { path } }],
    on(event, handler) { handlers.set(event, handler); },
  }, getConfig, capture);
  handlers.get("session_start")!();
  return () => {
    handlers.get("session_shutdown")!();
    disposeAll();
  };
}

function component(name = "codemode") {
  // SAFETY: ToolExecutionComponent only calls requestRender on its TUI host in this test.
  const ui = { requestRender() {} } as TUI;
  // SAFETY: the component reads only the renderers plus name/args it is given,
  // and the bare renderer shape is what older Pi versions accept here.
  return new ToolExecutionComponent(
    name, "call-1", { code: script }, { showImages: false },
    renderers as unknown as ToolDefinition,
    ui, process.cwd(),
  );
}

function result(statuses: string[], isError = false) {
  return {
    content: [
      { type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" },
      { type: "text", text: output },
    ],
    details: { calls: statuses.map((status) => ({ name: "read", args: "{}", status })) },
    isError,
  };
}

function displayed(view: ToolExecutionComponent, width = 80) {
  return view.render(width).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
}

test("codemode collapses script/output, expands both, and leaves result data intact", (t) => {
  let config = normalizeToolDisplayConfig({});
  t.after(install("builtin:codemode", () => config));
  const view = component();
  const data = result(["ok", "ok", "ok"]);
  const before = structuredClone(data);
  view.updateResult(data);
  assert.match(displayed(view), /3 calls/);
  assert.match(displayed(view), /NATIVE CALL TRACE/);
  assert.doesNotMatch(displayed(view), /example\.ts|RESULT/);
  config = normalizeToolDisplayConfig({ codemodeOutputMode: "summary" });
  view.invalidate();
  assert.doesNotMatch(displayed(view), /NATIVE CALL TRACE|RESULT/);
  config = normalizeToolDisplayConfig({ codemodeOutputMode: "preview", previewLines: 1 });
  view.invalidate();
  assert.match(displayed(view), /NATIVE CALL TRACE/);
  assert.match(displayed(view), /RESULT_ONE/);
  assert.doesNotMatch(displayed(view), /RESULT_TWO|RESULT_THREE|Script completed|example\.ts/);
  config.previewLines = 2;
  view.invalidate();
  assert.match(displayed(view), /RESULT_TWO/);
  assert.doesNotMatch(displayed(view), /RESULT_THREE/);
  view.setExpanded(true);
  assert.match(displayed(view), /example\.ts/);
  assert.match(displayed(view), /RESULT_THREE/);
  config = normalizeToolDisplayConfig({ codemodeOutputMode: "summary" });
  view.setExpanded(false);
  assert.doesNotMatch(displayed(view), /example\.ts|RESULT/);
  assert.deepEqual(data, before);
  assert.equal(renderers.renderCall().render(80).join("\n").includes("example.ts"), true);
  t.diagnostic(displayed(view).trim());
});

test("codemode preview bounds wrapped JSON output at each terminal width", (t) => {
  const config = normalizeToolDisplayConfig({ codemodeOutputMode: "preview", previewLines: 1 });
  t.after(install("builtin:codemode", () => config));
  const view = component();
  const data = result([]);
  data.content[1].text = JSON.stringify(["DATA ".repeat(120) + "END_OF_OUTPUT\nsecond logical line"]);
  const before = structuredClone(data);
  view.updateResult(data);
  for (const width of [40, 100, 40]) {
    const rendered = displayed(view, width);
    assert.equal(rendered.split("\n").filter((line) => line.includes("DATA")).length, 1);
    assert.doesNotMatch(rendered, /END_OF_OUTPUT/);
    assert.match(rendered, /more lines/);
  }
  view.setExpanded(true);
  assert.match(displayed(view), /END_OF_OUTPUT/);
  view.setExpanded(false);
  assert.doesNotMatch(displayed(view), /END_OF_OUTPUT/);
  assert.deepEqual(data, before);
});

test("running, caught failures, cancellation, and errors without details remain visible", (t) => {
  t.after(install());
  const view = component();
  view.updateResult(result(["ok", "running"]), true);
  assert.match(displayed(view), /running/);
  view.updateResult(result(["ok", "error", "cancelled"]));
  assert.match(displayed(view), /1 failed/);
  assert.match(displayed(view), /1 cancelled/);
  view.updateResult({ content: [{ type: "text", text: "Script syntax error" }], isError: true });
  assert.match(displayed(view), /failed/);
});

test("other tools, non-native codemode, and shutdown keep original rendering", () => {
  const stop = install();
  const other = component("exec");
  other.updateResult(result([]));
  assert.match(displayed(other), /example\.ts/);
  assert.match(displayed(other), /RESULT/);
  stop();
  const native = component();
  native.updateResult(result([]));
  assert.match(displayed(native), /example\.ts/);
  const stopCustom = install("/third-party/codemode.ts");
  const custom = component();
  custom.updateResult(result([]));
  assert.match(displayed(custom), /example\.ts/);
  stopCustom();
});

// ─── Codemode file diffs (pi-codemode-diff feature) ─────────────────────────

test("codemode results include the File changes section from captured diffs", async () => {
  const { Capture } = await import("../src/codemode-diff/capture.ts");
  const capture = new Capture();
  capture.start("call-1", "codemode");
  capture.start("e1", "edit", "call-1");
  capture.add({
    toolCallId: "e1",
    tool: "edit",
    path: "src/feature.ts",
    kind: "edit",
    diff: "- 10 const old = 1;\n+ 10 const updated = 2;",
  });

  const cleanup = installWithCapture("builtin:codemode", () => normalizeToolDisplayConfig({}), capture);
  try {
    const view = component();
    view.updateResult(result(["ok"]));
    const text = displayed(view);
    assert.match(text, /File changes \(1\) · 1 file/);
    assert.match(text, /src\/feature\.ts/);
    assert.match(text, /const updated = 2;/);
  } finally {
    cleanup();
  }
});

test("codemode file diffs can be disabled via codemodeShowFileDiffs", async () => {
  const { Capture } = await import("../src/codemode-diff/capture.ts");
  const capture = new Capture();
  capture.start("call-1", "codemode");
  capture.start("e1", "edit", "call-1");
  capture.add({ toolCallId: "e1", tool: "edit", path: "src/off.ts", kind: "edit", diff: "+ 1 x" });

  const cleanup = installWithCapture("builtin:codemode", () =>
    normalizeToolDisplayConfig({ codemodeShowFileDiffs: false }), capture);
  try {
    const view = component();
    view.updateResult(result(["ok"]));
    const text = displayed(view);
    assert.ok(!text.includes("File changes"), `expected no diff section, got: ${text}`);
  } finally {
    cleanup();
  }
});

test("persisted diff details render for resumed sessions", async () => {
  const { DETAILS_KEY } = await import("../src/codemode-diff/changes.ts");
  const cleanup = install("builtin:codemode");
  try {
    const view = component();
    const data = result(["ok"]) as ReturnType<typeof result> & { details: Record<string, unknown> };
    data.details = {
      ...data.details,
      [DETAILS_KEY]: {
        version: 1,
        changes: [{ toolCallId: "e1", tool: "edit", path: "src/resumed.ts", kind: "edit", diff: "+ 1 persisted" }],
      },
    };
    view.updateResult(data);
    const text = displayed(view);
    assert.match(text, /File changes \(1\)/);
    assert.match(text, /src\/resumed\.ts/);
    assert.match(text, /persisted/);
  } finally {
    cleanup();
  }
});

// ─── Official renderer chain path (Pi >= 1.0.1) ─────────────────────────────

test("renderer chain path wraps codemode call and result renderers", async () => {
  type ChainResolver = (toolName: string, next: () => unknown) => unknown;
  const resolvers: ChainResolver[] = [];
  const handlers = new Map<string, () => void>();
  resetDisposed();
  registerCodemodeDisplay({
    getAllTools: () => [{ name: "codemode", sourceInfo: { path: "builtin:codemode" } }],
    on(event: string, handler: () => void) { handlers.set(event, handler); },
    registerToolRenderer(resolver: ChainResolver) { resolvers.push(resolver); },
  } as never, () => normalizeToolDisplayConfig({}));
  handlers.get("session_start")!();
  assert.equal(resolvers.length, 1, "one resolver registered on the chain");
  const resolver = resolvers[0];

  // Non-codemode tools pass through untouched.
  const passthrough = { renderCall: renderers.renderCall, renderResult: renderers.renderResult };
  assert.equal(resolver("bash", () => passthrough), passthrough);

  // Codemode renderers are wrapped: collapsed call is just the title.
  const wrapped = resolver("codemode", () => passthrough) as {
    renderCall: (args: unknown, theme: unknown, context: { expanded: boolean }) => Component;
    renderResult: (result: unknown, options: { expanded: boolean; isPartial: boolean }, theme: unknown, context: unknown) => Component;
  };
  const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
  const collapsedCall = wrapped.renderCall({ code: script }, theme, { expanded: false });
  assert.ok(collapsedCall.render(80).join("\n").includes("codemode"), "collapsed call shows the compact title");

  const resultData = result(["ok", "ok"]);
  const collapsedResult = wrapped.renderResult(resultData, { expanded: false, isPartial: false }, theme, {
    toolCallId: "call-1",
    invalidate: () => {},
  });
  const text = collapsedResult.render(80).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  assert.match(text, /2 calls/);
  assert.match(text, /NATIVE CALL TRACE/);
  assert.doesNotMatch(text, /example\.ts|RESULT_ONE/);

  disposeAll();
});

test("renderer chain path leaves codemode alone when the host has no codemode renderer", async () => {
  type ChainResolver = (toolName: string, next: () => unknown) => unknown;
  const resolvers: ChainResolver[] = [];
  const handlers = new Map<string, () => void>();
  resetDisposed();
  registerCodemodeDisplay({
    getAllTools: () => [{ name: "codemode", sourceInfo: { path: "builtin:codemode" } }],
    on(event: string, handler: () => void) { handlers.set(event, handler); },
    registerToolRenderer(resolver: ChainResolver) { resolvers.push(resolver); },
  } as never, () => normalizeToolDisplayConfig({}));
  handlers.get("session_start")!();

  assert.equal(resolvers[0]("codemode", () => undefined), undefined);
  disposeAll();
});

test("renderer chain path appends captured file diffs", async () => {
  type ChainResolver = (toolName: string, next: () => unknown) => unknown;
  const { Capture } = await import("../src/codemode-diff/capture.ts");
  const capture = new Capture();
  capture.start("call-1", "codemode");
  capture.start("e1", "edit", "call-1");
  capture.add({ toolCallId: "e1", tool: "edit", path: "src/chain.ts", kind: "edit", diff: "+ 1 chain" });

  const resolvers: ChainResolver[] = [];
  const handlers = new Map<string, () => void>();
  resetDisposed();
  registerCodemodeDisplay({
    getAllTools: () => [{ name: "codemode", sourceInfo: { path: "builtin:codemode" } }],
    on(event: string, handler: () => void) { handlers.set(event, handler); },
    registerToolRenderer(resolver: ChainResolver) { resolvers.push(resolver); },
  } as never, () => normalizeToolDisplayConfig({}), capture);
  handlers.get("session_start")!();

  const wrapped = resolvers[0]("codemode", () => ({ renderCall: renderers.renderCall, renderResult: renderers.renderResult })) as {
    renderResult: (result: unknown, options: { expanded: boolean; isPartial: boolean }, theme: unknown, context: unknown) => Component;
  };
  const component = wrapped.renderResult(result(["ok"]), { expanded: false, isPartial: false }, { fg: (_c: string, t: string) => t, bold: (t: string) => t }, { toolCallId: "call-1" });
  const text = component.render(80).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  assert.match(text, /File changes \(1\)/);
  assert.match(text, /src\/chain\.ts/);
  disposeAll();
});
