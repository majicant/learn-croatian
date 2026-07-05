import { promises as fs } from "node:fs";
import path from "node:path";
import { basicModelName, clozeModelName, defaultSettings, mediaDir } from "../config.js";
import { asCleanString, slugify } from "../utils/text.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function htmlText(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

export function withCardComment(card, html) {
  return `<!--lc:${escapeHtml(card.id)}-->${html}`;
}

export function clozeText(card) {
  const index = card.croatianSentence.indexOf(card.targetText);
  if (index === -1) return withCardComment(card, htmlText(card.croatianSentence));

  return withCardComment(
    card,
    `${htmlText(card.croatianSentence.slice(0, index))}{{c1::${htmlText(card.targetText)}}}${htmlText(
      card.croatianSentence.slice(index + card.targetText.length)
    )}`
  );
}

export function ankiAudioReference(card) {
  return card.audioFile ? `[sound:${card.audioFile}]` : "";
}

export function buildAnkiFields(card, { includeAudioReference = false } = {}) {
  const audioField = includeAudioReference ? ankiAudioReference(card) : "";

  if (card.type === "basic") {
    return {
      Croatian: withCardComment(card, htmlText(card.croatianSentence)),
      English: htmlText(card.englishTranslation),
      Note: htmlText(card.note),
      Audio: audioField
    };
  }

  return {
    Text: clozeText(card),
    Hint: htmlText(card.hint),
    English: htmlText(card.englishTranslation),
    Note: htmlText(card.note),
    Audio: audioField
  };
}

export function buildAnkiNote(card, settings) {
  const base = {
    deckName: settings.deckName,
    options: {
      allowDuplicate: false,
      duplicateScope: "deck",
      duplicateScopeOptions: {
        deckName: settings.deckName,
        checkChildren: true,
        checkAllModels: false
      }
    },
    tags: ["learn-croatian", card.type, slugify(card.storyId)]
  };

  const audio = card.audioFile
    ? [
        {
          path: path.join(mediaDir, card.audioFile),
          filename: card.audioFile,
          fields: ["Audio"]
        }
      ]
    : undefined;

  if (card.type === "basic") {
    return {
      ...base,
      modelName: basicModelName,
      fields: buildAnkiFields(card),
      audio
    };
  }

  return {
    ...base,
    modelName: clozeModelName,
    fields: buildAnkiFields(card),
    audio
  };
}

export function ankiUrlFrom(value) {
  return asCleanString(value).replace(/\/+$/, "") || defaultSettings.ankiUrl;
}

export async function invokeAnki(action, params = {}, ankiUrl) {
  let response;
  try {
    response = await fetch(ankiUrlFrom(ankiUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params })
    });
  } catch {
    const error = new Error("Could not connect to Anki. Start Anki Desktop and install AnkiConnect.");
    error.status = 503;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`AnkiConnect returned HTTP ${response.status}.`);
    error.status = 502;
    throw error;
  }

  const payload = await response.json().catch(() => null);
  if (!payload || payload.error) {
    const error = new Error(payload?.error || "AnkiConnect returned an invalid response.");
    error.status = 502;
    throw error;
  }
  return payload.result;
}

export async function markMissingAnkiNotesForResync(cardsState, settings) {
  const syncedCards = cardsState.cards.filter((card) => card.ankiNoteId);
  if (!syncedCards.length) return 0;

  const noteIds = syncedCards.map((card) => Number(card.ankiNoteId));
  const notesInfo = await invokeAnki("notesInfo", { notes: noteIds }, settings.ankiUrl);
  let missing = 0;

  for (let index = 0; index < syncedCards.length; index += 1) {
    const info = notesInfo[index];
    if (info?.noteId && Array.isArray(info.cards) && info.cards.length > 0) continue;

    const card = syncedCards[index];
    missing += 1;
    card.ankiNoteId = null;
    card.syncStatus = "pending";
    card.syncError = null;
  }

  return missing;
}

export async function deleteQueuedAnkiNotes(cardsState, settings) {
  const queuedIds = Array.isArray(cardsState.deletedAnkiNoteIds)
    ? Array.from(new Set(cardsState.deletedAnkiNoteIds.map(Number).filter(Number.isFinite)))
    : [];
  if (!queuedIds.length) return 0;

  const notesInfo = await invokeAnki("notesInfo", { notes: queuedIds }, settings.ankiUrl);
  const existingIds = queuedIds.filter((id, index) => notesInfo[index]?.noteId);
  if (existingIds.length) {
    await invokeAnki("deleteNotes", { notes: existingIds }, settings.ankiUrl);
  }

  cardsState.deletedAnkiNoteIds = [];
  return existingIds.length;
}

export function expectedModelName(card) {
  return card.type === "basic" ? basicModelName : clozeModelName;
}

export function noteHasLocalCardId(noteInfo, cardId) {
  return Object.values(noteInfo?.fields || {}).some((field) => String(field?.value || "").includes(`lc:${cardId}`));
}

export async function uploadCardAudioForUpdate(card, settings) {
  if (!card.audioFile) return;
  const audioPath = path.join(mediaDir, card.audioFile);
  try {
    await fs.access(audioPath);
  } catch {
    return;
  }
  await invokeAnki("storeMediaFile", { filename: card.audioFile, path: audioPath }, settings.ankiUrl);
}

export async function updateExistingAnkiNote(card, noteId, settings) {
  await uploadCardAudioForUpdate(card, settings);
  await invokeAnki(
    "updateNoteFields",
    {
      note: {
        id: noteId,
        fields: buildAnkiFields(card, { includeAudioReference: true })
      }
    },
    settings.ankiUrl
  );
}

export async function findAppNotesForCard(card, settings) {
  const noteIds = await invokeAnki("findNotes", { query: card.id }, settings.ankiUrl);
  if (!noteIds.length) return [];

  const notesInfo = await invokeAnki("notesInfo", { notes: noteIds }, settings.ankiUrl);
  return notesInfo
    .filter(
      (noteInfo) =>
        noteInfo?.noteId &&
        noteInfo.modelName === expectedModelName(card) &&
        Array.isArray(noteInfo.cards) &&
        noteInfo.cards.length > 0 &&
        noteHasLocalCardId(noteInfo, card.id)
    )
    .map((noteInfo) => Number(noteInfo.noteId))
    .filter(Number.isFinite);
}

export async function recoverExistingAnkiNotes(cardsState, settings) {
  const pendingCards = cardsState.cards.filter((card) => !card.ankiNoteId);
  if (!pendingCards.length) return 0;

  let recovered = 0;

  for (const card of pendingCards) {
    const noteIds = await findAppNotesForCard(card, settings);
    if (!noteIds.length) continue;

    const [primaryNoteId, ...duplicateNoteIds] = noteIds;
    if (duplicateNoteIds.length) {
      await invokeAnki("deleteNotes", { notes: duplicateNoteIds }, settings.ankiUrl);
    }
    await updateExistingAnkiNote(card, primaryNoteId, settings);

    recovered += 1;
    card.ankiNoteId = primaryNoteId;
    card.syncStatus = "synced";
    card.syncError = null;
  }

  return recovered;
}

const ankiCss = `
.card {
  background: #fbfaf7;
  color: #242424;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 20px;
  line-height: 1.5;
  text-align: left;
}
.lc-wrap {
  box-sizing: border-box;
  margin: 0 auto;
  max-width: 760px;
  padding: 24px 18px;
}
.lc-sentence,
.lc-answer {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 30px;
  line-height: 1.42;
}
.cloze {
  color: #295f9e;
  font-weight: 800;
}
.lc-audio {
  margin-bottom: 14px;
}
.lc-divider {
  border: 0;
  border-top: 1px solid #ded9d0;
  margin: 24px 0 18px;
}
.lc-english {
  font-size: 22px;
  margin-bottom: 14px;
}
.lc-hint {
  background: #f1eee7;
  border-left: 3px solid #d8d1c5;
  color: #4b4944;
  font-size: 20px;
  margin-top: 18px;
  padding: 10px 12px;
}
.lc-note {
  color: #6a6862;
  font-size: 18px;
}
.nightMode.card,
.night_mode .card {
  background: #202020;
  color: #f3f0ea;
}
.nightMode .lc-divider,
.night_mode .lc-divider {
  border-top-color: #4c4a45;
}
.nightMode .cloze,
.night_mode .cloze {
  color: #8eb7e6;
}
.nightMode .lc-hint,
.night_mode .lc-hint {
  background: #2b2a28;
  border-left-color: #5a554c;
  color: #ddd8cf;
}
.nightMode .lc-note,
.night_mode .lc-note {
  color: #bdb8ad;
}
`;

function basicTemplates() {
  return {
    "Basic": {
      Front: `<div class="lc-wrap">{{#Audio}}<div class="lc-audio">{{Audio}}</div>{{/Audio}}<div class="lc-sentence">{{Croatian}}</div></div>`,
      Back: `<div class="lc-wrap"><div class="lc-sentence">{{Croatian}}</div><hr class="lc-divider"><div class="lc-english">{{English}}</div>{{#Note}}<div class="lc-note">{{Note}}</div>{{/Note}}</div>`
    }
  };
}

function clozeTemplates() {
  return {
    "Cloze": {
      Front: `<div class="lc-wrap"><div class="lc-sentence">{{cloze:Text}}</div>{{#Hint}}<div class="lc-hint">{{Hint}}</div>{{/Hint}}</div>`,
      Back: `<div class="lc-wrap"><div class="lc-answer">{{cloze:Text}}</div><hr class="lc-divider"><div class="lc-english">{{English}}</div>{{#Note}}<div class="lc-note">{{Note}}</div>{{/Note}}{{#Audio}}<div class="lc-audio">{{Audio}}</div>{{/Audio}}</div>`
    }
  };
}

async function ensureModel({ settings, modelName, fields, templates, isCloze }) {
  const modelNames = await invokeAnki("modelNames", {}, settings.ankiUrl);
  if (!modelNames.includes(modelName)) {
    await invokeAnki(
      "createModel",
      {
        modelName,
        inOrderFields: fields,
        css: ankiCss,
        isCloze,
        cardTemplates: Object.entries(templates).map(([Name, template]) => ({
          Name,
          Front: template.Front,
          Back: template.Back
        }))
      },
      settings.ankiUrl
    );
    return;
  }

  const existingFields = await invokeAnki("modelFieldNames", { modelName }, settings.ankiUrl);
  for (const fieldName of fields) {
    if (!existingFields.includes(fieldName)) {
      await invokeAnki("modelFieldAdd", { modelName, fieldName }, settings.ankiUrl);
    }
  }

  await invokeAnki(
    "updateModelTemplates",
    {
      model: {
        name: modelName,
        templates
      }
    },
    settings.ankiUrl
  );
  await invokeAnki(
    "updateModelStyling",
    {
      model: {
        name: modelName,
        css: ankiCss
      }
    },
    settings.ankiUrl
  );

  const updatedFields = await invokeAnki("modelFieldNames", { modelName }, settings.ankiUrl);
  for (const fieldName of updatedFields) {
    if (!fields.includes(fieldName)) {
      await invokeAnki("modelFieldRemove", { modelName, fieldName }, settings.ankiUrl);
    }
  }
}

export async function ensureAnkiSetup(settings) {
  await invokeAnki("createDeck", { deck: settings.deckName }, settings.ankiUrl);
  await ensureModel({
    settings,
    modelName: basicModelName,
    fields: ["Croatian", "English", "Note", "Audio"],
    templates: basicTemplates(),
    isCloze: false
  });
  await ensureModel({
    settings,
    modelName: clozeModelName,
    fields: ["Text", "Hint", "English", "Note", "Audio"],
    templates: clozeTemplates(),
    isCloze: true
  });
}
