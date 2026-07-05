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

export async function deleteCardsForStories(storyIds) {
  const storyIdSet = new Set(storyIds);
  const cardsState = await readCards();
  const deletedCards = cardsState.cards.filter((card) => storyIdSet.has(card.storyId));
  const deletedAnkiNoteIds = deletedCards.map((card) => card.ankiNoteId).filter(Boolean);

  cardsState.cards = cardsState.cards.filter((card) => !storyIdSet.has(card.storyId));
  cardsState.deletedAnkiNoteIds = [...cardsState.deletedAnkiNoteIds, ...deletedAnkiNoteIds];
  await writeCards(cardsState);
}

export function cardForClient(card) {
  const { ankiNoteId, ...clientCard } = card;
  return clientCard;
}
