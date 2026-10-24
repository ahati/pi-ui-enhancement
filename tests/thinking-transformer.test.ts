import assert from "node:assert/strict";
import test from "node:test";
import { registerThinkingLabeling } from "../src/thinking-label.ts";

type CapturedHandler = (event: unknown, ctx?: unknown) => Promise<void> | void;
type TransformerLike = (markdown: string, context: {
  messageType: "user" | "assistant" | "assistant-thinking";
  isStreaming: boolean;
  availableWidth: number;
}) => string;

interface CaptureResult {
  transformers: TransformerLike[];
  handlers: Map<string, CapturedHandler>;
}

function captureRegistration(): CaptureResult {
  const transformers: TransformerLike[] = [];
  const handlers = new Map<string, CapturedHandler>();
  registerThinkingLabeling({
    registerMarkdownTransformer(transformer: TransformerLike): void {
      transformers.push(transformer);
    },
    on(eventName: string, handler: CapturedHandler): void {
      handlers.set(eventName, handler);
    },
  } as never);
  return { transformers, handlers };
}

const themedCtx = {
  ui: { theme: { fg: (color: string, text: string) => `[${color}]${text}` } },
};

const thinkingContext = {
  messageType: "assistant-thinking" as const,
  isStreaming: true,
  availableWidth: 80,
};

test("transformer host: render-time transformer registered, legacy payload pipeline skipped", async () => {
  const { transformers, handlers } = captureRegistration();

  assert.equal(transformers.length, 1, "exactly one markdown transformer registered");
  assert.equal(handlers.has("message_update"), false, "message_update mutation pipeline must not register");
  assert.equal(handlers.has("message_end"), false, "message_end mutation pipeline must not register");
  assert.equal(handlers.has("context"), true, "legacy-session context cleanup stays");
  assert.equal(handlers.has("session_start"), true, "hidden label refresh stays");

  await handlers.get("session_start")?.({}, themedCtx);
});

test("transformer prefixes assistant-thinking markdown with the themed label", async () => {
  const { transformers, handlers } = captureRegistration();
  await handlers.get("session_start")?.({}, themedCtx);

  const out = transformers[0]("checking options", thinkingContext);
  assert.equal(out, "[accent]Thinking: [thinkingText]checking options");
});

test("transformer leaves user and assistant markdown untouched", () => {
  const { transformers } = captureRegistration();
  const transform = transformers[0];

  assert.equal(transform("# heading", { ...thinkingContext, messageType: "user" }), "# heading");
  assert.equal(transform("plain text", { ...thinkingContext, messageType: "assistant" }), "plain text");
});

test("transformer labels legacy persisted content exactly once", async () => {
  const { transformers, handlers } = captureRegistration();
  await handlers.get("session_start")?.({}, themedCtx);

  // Thinking text persisted by the old event pipeline carries a plain label.
  const out = transformers[0]("Thinking: checking options", thinkingContext);
  assert.equal(out, "[accent]Thinking: [thinkingText]checking options");
  assert.equal((out.match(/Thinking:/g) ?? []).length, 1, "no double label");
});

test("transformer passes through empty and whitespace-only thinking", async () => {
  const { transformers, handlers } = captureRegistration();
  await handlers.get("session_start")?.({}, themedCtx);

  assert.equal(transformers[0]("", thinkingContext), "");
  assert.equal(transformers[0]("   ", thinkingContext), "   ");
});

test("without a theme snapshot the transformer labels theme-less", async () => {
  const { transformers, handlers } = captureRegistration();

  // Simulate a fresh process: session_start without a ui/theme clears the
  // module-level snapshot an earlier registration may have set.
  await handlers.get("session_start")?.({}, {});

  // Label must exist before session lifecycle runs (replayed transcripts).
  assert.equal(transformers[0]("raw", thinkingContext), "Thinking: raw");
});
