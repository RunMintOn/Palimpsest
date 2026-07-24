import assert from "node:assert/strict";
import test from "node:test";
import { pluginSettingsData, settingsFromPluginData } from "../src/plugin-settings-data";
import type { PluginSettingsData } from "../src/plugin-settings-data";

type SettingsOnlyHasNoIndex = "index" extends keyof PluginSettingsData<{ model: string }> ? never : true;
const settingsOnlyHasNoIndex: SettingsOnlyHasNoIndex = true;
void settingsOnlyHasNoIndex;

// @ts-expect-error PluginData is deliberately unable to represent an index.
const invalidPluginData: PluginSettingsData<{ model: string }> = { settings: { model: "test" }, index: {} };
void invalidPluginData;

test("plugin settings persistence writes only settings and ignores a legacy saved index", () => {
  const settings = { model: "test", resultExcerptFontScale: 0.92 };
  assert.deepEqual(pluginSettingsData(settings), { settings });
  const legacy = { settings, index: { chunks: [new Float32Array([1, 2, 3])], generation: "legacy" } };
  assert.strictEqual(settingsFromPluginData<typeof settings>(legacy), settings);
  assert.equal(settingsFromPluginData(undefined), undefined);
});
