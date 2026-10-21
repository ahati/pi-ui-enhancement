import assert from "node:assert/strict";
import test from "node:test";
import { registerToolDisplayOverrides } from "../src/tool-overrides.ts";
import { normalizeToolDisplayConfig } from "../src/config-store.ts";

// Simulates the real environment: pi-diff owns edit/write, plus third-party
// tools (apply_patch, todo, web_search) that nobody decorated before.
function buildHost() {
  const resolvers: Array<(n: string, next: () => unknown) => unknown> = [];
  const registered: Array<{ name: string }> = [];
  const handlers = new Map<string, () => Promise<void> | void>();
  let registry: unknown[] | undefined = [
    { name: "read", sourceInfo: { source: "builtin", path: "builtin:read" } },
    { name: "bash", sourceInfo: { source: "builtin", path: "builtin:bash" } },
    { name: "grep", sourceInfo: { source: "builtin", path: "builtin:grep" } },
    { name: "edit", sourceInfo: { source: "local", path: "npm/@heyhuynhgiabuu/pi-diff/dist/index.js" } },
    { name: "write", sourceInfo: { source: "local", path: "npm/@heyhuynhgiabuu/pi-diff/dist/index.js" } },
  ];
  const api = {
    registerTool(t: { name: string }) { registered.push(t); },
    registerToolRenderer(r: (n: string, next: () => unknown) => unknown) { resolvers.push(r); },
    on(e: string, h: () => Promise<void> | void) { handlers.set(e, h); },
    getAllTools() { return registry ?? []; },
  } as never;
  return { api, resolvers, registered, handlers };
}

const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t, inverse: (t: string) => t };

test("e2e: every tool call gets a compact call line", async () => {
  const { api, resolvers, handlers } = buildHost();
  registerToolDisplayOverrides(api, () => normalizeToolDisplayConfig({}));
  await handlers.get("session_start")?.();
  const resolver = resolvers[0];
  const native = () => ({ renderCall: () => "NATIVE" as unknown, renderResult: () => "NATIVE" as unknown });

  for (const name of ["read", "bash", "grep", "edit", "write", "apply_patch", "todo", "web_search", "pi_docparser"]) {
    const r = resolver(name, native) as { renderCall?: (a: unknown, t: unknown, c: unknown) => { render(w: number): string[] } };
    assert.ok(r?.renderCall, `${name} has a renderCall`);
    const context = { executionStarted: false, isPartial: false, expanded: false, state: {}, args: { x: 1 } };
    const line = r.renderCall({ x: 1 }, theme, context).render(120).join("\n").trim();
    assert.ok(!line.includes("NATIVE"), `${name} is decorated (not native)`);
    console.log(`  ${name.padEnd(14)} -> ${JSON.stringify(line.slice(0, 60))}`);
  }
});

test("e2e: user prompt decoration is off by default", () => {
  assert.equal(normalizeToolDisplayConfig({}).enableNativeUserMessageBox, false);
});

test("e2e: wildcard can be disabled to pass unknown tools through", async () => {
  const { api, resolvers, handlers } = buildHost();
  registerToolDisplayOverrides(api, () =>
    normalizeToolDisplayConfig({ customToolOverrides: { "*": { enabled: false } } }),
  );
  await handlers.get("session_start")?.();
  const resolver = resolvers[0];
  const nativeCall = () => "NATIVE";
  const next = () => ({ renderCall: nativeCall, renderResult: () => "NATIVE" });
  const r = resolver("apply_patch", next) as { renderCall?: unknown };
  assert.equal(r.renderCall, nativeCall, "wildcard off -> native renderer kept");
});

test("disabling a built-in override keeps the owner's renderer (no wildcard hijack)", async () => {
  const { api, resolvers, handlers } = buildHost();
  registerToolDisplayOverrides(api, () =>
    normalizeToolDisplayConfig({ registerToolOverrides: { edit: false, write: false } }),
  );
  await handlers.get("session_start")?.();
  const resolver = resolvers[0];
  const nativeCall = () => "PI_DIFF_RENDERER";
  const next = () => ({ renderCall: nativeCall, renderResult: () => "PI_DIFF_RENDERER" });

  for (const name of ["edit", "write"]) {
    const r = resolver(name, next) as { renderCall?: unknown };
    assert.equal(r.renderCall, nativeCall, `${name} keeps the owner's renderer when our override is off`);
  }
});

test("built-ins we own win over the wildcard, MCP and codemode are never wildcarded", async () => {
  const { api, resolvers, handlers } = buildHost();
  registerToolDisplayOverrides(api, () => normalizeToolDisplayConfig({}));
  await handlers.get("session_start")?.();
  const resolver = resolvers[0];
  const nativeCall = () => "NATIVE";
  const next = () => ({ renderCall: nativeCall, renderResult: () => "NATIVE" });

  assert.notEqual((resolver("read", next) as { renderCall?: unknown }).renderCall, nativeCall, "read uses ours");
  for (const name of ["codemode", "mcp__srv__tool", "mcp"]) {
    const r = resolver(name, next) as { renderCall?: unknown };
    assert.equal(r.renderCall, nativeCall, `${name} is left to its specialized resolver`);
  }
});
