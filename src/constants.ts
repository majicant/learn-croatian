import type { SettingsState } from "./types";

export const READING_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export const DEFAULT_SETTINGS: SettingsState = {
  ankiUrl: "http://127.0.0.1:8765",
  deckName: "Croatian::Mined"
};
