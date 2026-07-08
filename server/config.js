import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const port = Number(process.env.PORT || 3737);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const textsDir = path.join(rootDir, "texts");
export const dataDir = path.join(rootDir, "data");
export const mediaDir = path.join(dataDir, "media");
export const cardsFile = path.join(dataDir, "cards.json");
export const progressFile = path.join(dataDir, "progress.json");
export const settingsFile = path.join(dataDir, "settings.json");
export const storyFoldersFile = path.join(dataDir, "story-folders.json");

export const basicModelName = "Learn Croatian Basic";
export const clozeModelName = "Learn Croatian Cloze";
export const audioOnlyModelName = "Learn Croatian Audio";

export const defaultSettings = {
  ankiUrl: "http://127.0.0.1:8765",
  deckName: "Croatian::Mined"
};
