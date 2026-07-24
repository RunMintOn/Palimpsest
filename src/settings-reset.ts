import type { SideGrepSettings } from "./settings";

export type SettingsResetSection =
  | "scope"
  | "embedding"
  | "query"
  | "chunking"
  | "retrieval"
  | "expansion"
  | "appearance"
  | "indexBuild"
  | "queryInstruction";

const sectionKeys: Record<SettingsResetSection, readonly (keyof SideGrepSettings)[]> = {
  scope: ["excludedDirectories"],
  embedding: ["endpoint", "model", "dimensions", "keepAlive"],
  query: ["queryDebounceMs", "queryMaxLength"],
  chunking: ["chunkTargetLength", "chunkMaxLength", "chunkMinLength"],
  retrieval: ["topK", "maxPerFile"],
  expansion: ["autoExpandCount", "autoExpandThresholdEnabled", "autoExpandThreshold"],
  appearance: ["resultExcerptFontScale", "resultExcerptLineHeight", "resultExcerptMaxLines"],
  indexBuild: ["embeddingBatchSize"],
  queryInstruction: ["queryInstruction"]
};

/** Finds the reset section owning a setting field. Every editable field belongs to one. */
export function resetSectionForSetting(key: keyof SideGrepSettings): SettingsResetSection {
  for (const [section, keys] of Object.entries(sectionKeys) as [SettingsResetSection, readonly (keyof SideGrepSettings)[]][]) {
    if (keys.includes(key)) return section;
  }
  throw new Error(`No reset section for setting ${key}`);
}

function sameSettingValue(left: SideGrepSettings[keyof SideGrepSettings], right: SideGrepSettings[keyof SideGrepSettings]): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return left === right;
}

/** Whether a section differs from the defaults and should expose its reset control. */
export function settingsSectionDiffersFromDefaults(
  settings: SideGrepSettings,
  defaults: SideGrepSettings,
  section: SettingsResetSection
): boolean {
  return sectionKeys[section].some((key) => !sameSettingValue(settings[key], defaults[key]));
}

/** Returns a new settings object with only the requested section restored. */
export function resetSettingsSection(
  settings: SideGrepSettings,
  defaults: SideGrepSettings,
  section: SettingsResetSection
): SideGrepSettings {
  const restored = { ...settings };
  for (const key of sectionKeys[section]) {
    const value = defaults[key];
    (restored as Record<keyof SideGrepSettings, unknown>)[key] = Array.isArray(value) ? [...value] : value;
  }
  return restored;
}
