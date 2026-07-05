import { promises as fs } from "node:fs";
import { cardsFile, dataDir, defaultSettings, mediaDir, progressFile, settingsFile, textsDir } from "../config.js";
import { ensureJsonFile } from "./jsonStore.js";

export async function ensureStorage() {
  await fs.mkdir(textsDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(mediaDir, { recursive: true });
  await ensureJsonFile(cardsFile, { cards: [], deletedAnkiNoteIds: [] });
  await ensureJsonFile(progressFile, { stories: {} });
  await ensureJsonFile(settingsFile, defaultSettings);
}
