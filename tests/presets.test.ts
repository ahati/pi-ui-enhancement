import assert from "node:assert/strict";
import test from "node:test";
import {
  detectToolDisplayPreset,
  getToolDisplayPresetConfig,
  parseToolDisplayPreset,
} from "../src/presets.ts";

test("preset parsing is case-insensitive and rejects unknown names", () => {
  assert.equal(parseToolDisplayPreset(" BALANCED "), "balanced");
  assert.equal(parseToolDisplayPreset("Verbose"), "verbose");
  assert.equal(parseToolDisplayPreset(""), undefined);
  assert.equal(parseToolDisplayPreset("custom"), undefined);
});

test("preset detection matches cloned preset configs and detects custom changes", () => {
  const balanced = getToolDisplayPresetConfig("balanced");
  const anotherBalanced = getToolDisplayPresetConfig("balanced");

  assert.notEqual(balanced.disableEnhancedToolRender, anotherBalanced.disableEnhancedToolRender);
  assert.equal(detectToolDisplayPreset(balanced), "balanced");
  assert.equal(
    detectToolDisplayPreset({ ...balanced, previewLines: balanced.previewLines + 1 }),
    "custom",
  );
});

test("preset detection and presets ignore diff color customization", () => {
  const opencode = getToolDisplayPresetConfig("opencode");
  const colored = {
    ...opencode,
    diffAddedBg: "#14351f",
    diffRemovedBg: "#3a1d20",
    diffAddedEmphasisBg: "#1d5230",
    diffRemovedEmphasisBg: "#57262b",
    diffSyntaxHighlighting: "shiki" as const,
  };

  assert.equal(detectToolDisplayPreset(colored), "opencode", "colors must not flip the preset to custom");

  const balanced = getToolDisplayPresetConfig("balanced");
  assert.equal(balanced.diffAddedBg, undefined, "preset configs do not invent colors");
  assert.equal(balanced.diffSyntaxHighlighting, "shiki");
});
