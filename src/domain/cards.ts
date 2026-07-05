import type { CardType, MinedCard } from "../types";

export function cardTypeLabel(type: CardType) {
  return type === "basic" ? "Basic" : "Cloze";
}

export function syncLabel(card: MinedCard) {
  if (card.syncStatus === "synced") return "Synced";
  if (card.syncStatus === "error") return "Needs retry";
  return "Pending";
}

export function isSynced(card: MinedCard) {
  return card.syncStatus === "synced";
}
