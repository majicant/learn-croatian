import { defaultSettings, settingsFile } from "../config.js";
import { readJson, writeJsonSafe } from "../storage/jsonStore.js";
import { asCleanString } from "../utils/text.js";

export async function readSettings() {
  const raw = await readJson(settingsFile, defaultSettings);
  return cleanSettings(raw);
}

export async function writeSettings(settings) {
  const cleaned = cleanSettings(settings);
  await writeJsonSafe(settingsFile, cleaned);
  return cleaned;
}

export function cleanSettings(raw) {
  return {
    ankiUrl: asCleanString(raw?.ankiUrl) || defaultSettings.ankiUrl,
    deckName: asCleanString(raw?.deckName) || defaultSettings.deckName
  };
}
