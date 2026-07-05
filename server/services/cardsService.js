import crypto from "node:crypto";
import { asCleanString, normalizeText } from "../utils/text.js";

export function makeCardId() {
  return `card_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

export function requireField(value, message) {
  const cleaned = asCleanString(value);
  if (!cleaned) {
    const error = new Error(message);
    error.status = 400;
    throw error;
  }
  return cleaned;
}

export function validateTargetInSentence(sentence, targetText) {
  if (!sentence.includes(targetText)) {
    const error = new Error(`Hidden text must exactly match text in the Croatian sentence: "${targetText}".`);
    error.status = 400;
    throw error;
  }
}

export function createCard({ type, story, sentence, body }) {
  const croatianSentence = requireField(body.croatianSentence || sentence.croatian, "Croatian sentence is required.");
  const targetText = type === "cloze" ? requireField(body.targetText, "Hidden text is required.") : "";
  if (type === "cloze") validateTargetInSentence(croatianSentence, targetText);

  return {
    id: makeCardId(),
    type,
    storyId: story.id,
    sentenceId: sentence.id,
    croatianSentence,
    englishTranslation: requireField(
      body.englishTranslation || sentence.analysis?.english,
      "English translation is required."
    ),
    note: asCleanString(body.note),
    audioFile: null,
    ankiNoteId: null,
    syncStatus: "pending",
    syncError: null,
    ...(type === "cloze" ? { targetText, hint: asCleanString(body.hint) } : {})
  };
}

export function cleanCardType(value, fallback) {
  const type = value === undefined ? fallback : value;
  if (type === "basic" || type === "cloze") return type;
  const error = new Error("Card type must be basic or cloze.");
  error.status = 400;
  throw error;
}

export function fieldOrCurrent(body, name, current) {
  return body[name] === undefined ? current : body[name];
}

export function updateCardFields(card, body) {
  const type = cleanCardType(body.type, card.type);
  const croatianSentence = requireField(
    fieldOrCurrent(body, "croatianSentence", card.croatianSentence),
    "Croatian sentence is required."
  );
  const targetText =
    type === "cloze"
      ? requireField(fieldOrCurrent(body, "targetText", card.targetText), "Hidden text is required.")
      : "";
  if (type === "cloze") validateTargetInSentence(croatianSentence, targetText);

  const englishTranslation = requireField(
    fieldOrCurrent(body, "englishTranslation", card.englishTranslation),
    "English translation is required."
  );
  const sentenceChanged = croatianSentence !== card.croatianSentence;

  const updated = {
    ...card,
    type,
    croatianSentence,
    englishTranslation,
    note: asCleanString(fieldOrCurrent(body, "note", card.note)),
    audioFile: sentenceChanged ? null : card.audioFile || null
  };
  if (type !== "cloze") {
    delete updated.targetText;
    delete updated.hint;
    return updated;
  }
  return {
    ...updated,
    targetText,
    hint: asCleanString(fieldOrCurrent(body, "hint", card.hint))
  };
}

export function isDuplicateCard(cards, draft, ignoredCardId = "") {
  return cards.some(
    (existing) =>
      existing.id !== ignoredCardId &&
      existing.storyId === draft.storyId &&
      existing.sentenceId === draft.sentenceId &&
      existing.type === draft.type &&
      normalizeText(existing.croatianSentence) === normalizeText(draft.croatianSentence) &&
      normalizeText(existing.targetText) === normalizeText(draft.targetText)
  );
}

export function queueAnkiNoteDeletion(cardsState, noteId) {
  const id = Number(noteId);
  if (!Number.isFinite(id)) return;
  const existingQueue = Array.isArray(cardsState.deletedAnkiNoteIds) ? cardsState.deletedAnkiNoteIds : [];
  if (!existingQueue.includes(id)) existingQueue.push(id);
  cardsState.deletedAnkiNoteIds = existingQueue;
}
