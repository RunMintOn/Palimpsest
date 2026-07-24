/** The only shape written through Obsidian Plugin.saveData(). */
export interface PluginSettingsData<Settings> {
  settings: Settings;
}

/** Reads settings while intentionally ignoring all legacy plugin-data fields, including index. */
export function settingsFromPluginData<Settings>(value: unknown): Settings | undefined {
  if (!value || typeof value !== "object") return undefined;
  return (value as { settings?: Settings }).settings;
}

export function pluginSettingsData<Settings>(settings: Settings): PluginSettingsData<Settings> {
  return { settings };
}
