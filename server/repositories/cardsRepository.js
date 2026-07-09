import { cardsFile } from "../config.js";
import { readJson, writeJsonSafe } from "../storage/jsonStore.js";

export async function readCards() {
  const raw = await readJson(cardsFile, { cards: [], deletedAnkiNoteIds: [] });
  const cards = Array.isArray(raw?.cards) ? raw.cards : [];
  const deletedAnkiNoteIds = Array.isArray(raw?.deletedAnkiNoteIds)
    ? raw.deletedAnkiNoteIds.map(Number).filter(Number.isFinite)
    : [];
  return { cards, deletedAnkiNoteIds };
}

export async function writeCards(cardsState) {
  const deletedAnkiNoteIds = Array.isArray(cardsState.deletedAnkiNoteIds)
    ? Array.from(new Set(cardsState.deletedAnkiNoteIds.map(Number).filter(Number.isFinite)))
    : [];
  await writeJsonSafe(cardsFile, { cards: cardsState.cards, deletedAnkiNoteIds });
}

export function cardForClient(card) {
  const { ankiNoteId, audioOnlyAnkiNoteId, ...clientCard } = card;
  return clientCard;
}
