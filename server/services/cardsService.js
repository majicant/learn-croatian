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

export function requireText(value, message) {
  const text = String(value ?? "");
  if (!text.trim()) {
    const error = new Error(message);
    error.status = 400;
    throw error;
  }
  return text;
}

export function targetSelectionFromBody(sentence, body) {
  const targetStart = Number(body.targetStart);
  const targetEnd = Number(body.targetEnd);
  if (
    !Number.isInteger(targetStart) ||
    !Number.isInteger(targetEnd) ||
    targetStart < 0 ||
    targetEnd <= targetStart ||
    targetEnd > sentence.length
  ) {
    const error = new Error("Hidden text selection is out of range.");
    error.status = 400;
    throw error;
  }

  const targetText = sentence.slice(targetStart, targetEnd);
  if (!targetText.trim()) {
    const error = new Error("Hidden text is required.");
    error.status = 400;
    throw error;
  }
  return { targetText, targetStart, targetEnd };
}

export function createCard({ type, story, sentence, body }) {
  const croatianSentence = requireText(
    body.croatianSentence === undefined ? sentence.croatian : body.croatianSentence,
    "Croatian sentence is required."
  );
  const targetSelection = type === "cloze" ? targetSelectionFromBody(croatianSentence, body) : null;

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
    ...(type === "cloze" ? { ...targetSelection, hint: asCleanString(body.hint) } : {})
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
  const croatianSentence = requireText(
    fieldOrCurrent(body, "croatianSentence", card.croatianSentence),
    "Croatian sentence is required."
  );
  const targetSelection = type === "cloze" ? targetSelectionFromBody(croatianSentence, body) : null;

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
    delete updated.targetStart;
    delete updated.targetEnd;
    delete updated.hint;
    return updated;
  }
  return {
    ...updated,
    ...targetSelection,
    hint: asCleanString(fieldOrCurrent(body, "hint", card.hint))
  };
}

function sameClozeTarget(existing, draft) {
  if (draft.type !== "cloze") return true;

  return existing.targetStart === draft.targetStart && existing.targetEnd === draft.targetEnd;
}

export function isDuplicateCard(cards, draft, ignoredCardId = "") {
  return cards.some(
    (existing) =>
      existing.id !== ignoredCardId &&
      existing.storyId === draft.storyId &&
      existing.sentenceId === draft.sentenceId &&
      existing.type === draft.type &&
      normalizeText(existing.croatianSentence) === normalizeText(draft.croatianSentence) &&
      sameClozeTarget(existing, draft)
  );
}

export function queueAnkiNoteDeletion(cardsState, noteId) {
  const id = Number(noteId);
  if (!Number.isFinite(id)) return;
  const existingQueue = Array.isArray(cardsState.deletedAnkiNoteIds) ? cardsState.deletedAnkiNoteIds : [];
  if (!existingQueue.includes(id)) existingQueue.push(id);
  cardsState.deletedAnkiNoteIds = existingQueue;
}
