import dotenv from "dotenv";
import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3737);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const textsDir = path.join(rootDir, "texts");
const dataDir = path.join(rootDir, "data");
const mediaDir = path.join(dataDir, "media");
const cardsFile = path.join(dataDir, "cards.json");
const progressFile = path.join(dataDir, "progress.json");
const settingsFile = path.join(dataDir, "settings.json");

const basicModelName = "Learn Croatian Basic";
const clozeModelName = "Learn Croatian Cloze";

const defaultSettings = {
  ankiUrl: "http://127.0.0.1:8765",
  deckName: "Croatian::Mined"
};

app.use(express.json({ limit: "2mb" }));
app.use("/media", express.static(mediaDir));

async function ensureStorage() {
  await fs.mkdir(textsDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(mediaDir, { recursive: true });
  await ensureJsonFile(cardsFile, { cards: [], deletedAnkiNoteIds: [] });
  await ensureJsonFile(progressFile, { stories: {} });
  await ensureJsonFile(settingsFile, defaultSettings);
}

async function ensureJsonFile(filePath, fallback) {
  try {
    await fs.access(filePath);
  } catch {
    await writeJsonSafe(filePath, fallback);
  }
}

async function readJson(filePath, fallback) {
  try {
    const contents = await fs.readFile(filePath, "utf8");
    if (!contents.trim()) return structuredClone(fallback);
    return JSON.parse(contents);
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(fallback);
    throw error;
  }
}

async function writeJsonSafe(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function readCards() {
  const raw = await readJson(cardsFile, { cards: [], deletedAnkiNoteIds: [] });
  const cards = Array.isArray(raw?.cards) ? raw.cards : [];
  const deletedAnkiNoteIds = Array.isArray(raw?.deletedAnkiNoteIds)
    ? raw.deletedAnkiNoteIds.map(Number).filter(Number.isFinite)
    : [];
  return { cards, deletedAnkiNoteIds };
}

async function writeCards(cardsState) {
  const deletedAnkiNoteIds = Array.isArray(cardsState.deletedAnkiNoteIds)
    ? Array.from(new Set(cardsState.deletedAnkiNoteIds.map(Number).filter(Number.isFinite)))
    : [];
  await writeJsonSafe(cardsFile, { cards: cardsState.cards, deletedAnkiNoteIds });
}

function cardForClient(card) {
  const { ankiNoteId, ...clientCard } = card;
  return clientCard;
}

async function readSettings() {
  const raw = await readJson(settingsFile, defaultSettings);
  return cleanSettings(raw);
}

async function writeSettings(settings) {
  const cleaned = cleanSettings(settings);
  await writeJsonSafe(settingsFile, cleaned);
  return cleaned;
}

function cleanSettings(raw) {
  return {
    ankiUrl: asCleanString(raw?.ankiUrl) || defaultSettings.ankiUrl,
    deckName: asCleanString(raw?.deckName) || defaultSettings.deckName
  };
}

async function readProgress() {
  const raw = await readJson(progressFile, { stories: {} });
  return { stories: raw && typeof raw.stories === "object" && raw.stories ? raw.stories : {} };
}

async function writeProgress(progress) {
  await writeJsonSafe(progressFile, { stories: progress.stories });
}

function assertStoryId(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    const error = new Error("Invalid story id.");
    error.status = 400;
    throw error;
  }
}

function storyPath(id) {
  assertStoryId(id);
  return path.join(textsDir, `${id}.json`);
}

async function readStory(id) {
  return readJson(storyPath(id), null);
}

async function writeStory(story) {
  await writeJsonSafe(storyPath(story.id), story);
}

async function listStories() {
  const progress = await readProgress();
  const files = (await fs.readdir(textsDir)).filter((file) => file.endsWith(".json"));
  const stories = await Promise.all(
    files.map(async (file) => {
      const story = await readJson(path.join(textsDir, file), null);
      if (!story) return null;
      const state = progress.stories[story.id] || {};
      return {
        id: story.id,
        title: story.title,
        level: story.level,
        completed: Boolean(state.completed)
      };
    })
  );

  return stories.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title, "hr"));
}

function attachCardStatus(story, cards) {
  const counts = new Map();
  for (const card of cards) {
    if (card.storyId !== story.id) continue;
    counts.set(card.sentenceId, (counts.get(card.sentenceId) || 0) + 1);
  }

  return {
    ...story,
    paragraphs: story.paragraphs.map((paragraph) => ({
      ...paragraph,
      sentences: paragraph.sentences.map((sentence) => {
        const cardCount = counts.get(sentence.id) || 0;
        return {
          ...sentence,
          hasCards: cardCount > 0,
          cardCount
        };
      })
    }))
  };
}

function findSentence(story, sentenceId) {
  for (const paragraph of story.paragraphs || []) {
    const sentence = (paragraph.sentences || []).find((item) => item.id === sentenceId);
    if (sentence) return sentence;
  }
  return null;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFC")
    .toLocaleLowerCase("hr-HR")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "");
}

function splitParagraphs(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function splitSentences(paragraph) {
  const segmenter = new Intl.Segmenter("hr", { granularity: "sentence" });
  return Array.from(segmenter.segment(paragraph), (segment) => segment.segment.trim()).filter(Boolean);
}

function slugify(value) {
  return (
    String(value || "story")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase("hr-HR")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "story"
  );
}

async function buildUniqueStoryId(title) {
  const base = slugify(title);
  let candidate = base;
  let index = 1;

  while (true) {
    try {
      await fs.access(storyPath(candidate));
      candidate = `${base}-${index}`;
      index += 1;
    } catch {
      return candidate;
    }
  }
}

function buildStory({ title, level, text }) {
  const paragraphs = splitParagraphs(text);
  let sentenceNumber = 1;

  return {
    id: "",
    title: String(title || "").trim(),
    level: String(level || "").trim() || "A1",
    paragraphs: paragraphs.map((paragraph, paragraphIndex) => ({
      id: `p${String(paragraphIndex + 1).padStart(3, "0")}`,
      sentences: splitSentences(paragraph).map((sentence) => {
        const sentenceId = `s${String(sentenceNumber).padStart(3, "0")}`;
        sentenceNumber += 1;
        return {
          id: sentenceId,
          croatian: sentence
        };
      })
    }))
  };
}

function cleanAnalysis(raw) {
  const notes = Array.isArray(raw.notes)
    ? raw.notes.map((note) => String(note).trim()).filter(Boolean).slice(0, 3)
    : [];

  return {
    english: String(raw.english || "").trim(),
    notes
  };
}

async function generateAnalysis({ croatian, level }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!apiKey) {
    const error = new Error("OPENAI_API_KEY is not configured on the backend.");
    error.status = 503;
    throw error;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a concise Croatian reading assistant. Return only strict JSON with keys english and notes. Use 1-3 short notes. Keep explanations useful for a language learner."
        },
        {
          role: "user",
          content: `Level: ${level || "unknown"}\nCroatian sentence: ${croatian}`
        }
      ]
    })
  });

  if (!response.ok) {
    const details = await response.text();
    const error = new Error(`OpenAI request failed: ${details}`);
    error.status = 502;
    throw error;
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    const error = new Error("OpenAI response did not include JSON content.");
    error.status = 502;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const error = new Error("OpenAI response was not valid JSON.");
    error.status = 502;
    throw error;
  }

  const analysis = cleanAnalysis(parsed);
  if (!analysis.english) {
    const error = new Error("OpenAI response did not include an English translation.");
    error.status = 502;
    throw error;
  }
  return analysis;
}

function makeCardId() {
  return `card_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function asCleanString(value) {
  return String(value || "").trim();
}

function requireField(value, message) {
  const cleaned = asCleanString(value);
  if (!cleaned) {
    const error = new Error(message);
    error.status = 400;
    throw error;
  }
  return cleaned;
}

function validateTargetInSentence(sentence, targetText) {
  if (!sentence.includes(targetText)) {
    const error = new Error(`Hidden text must exactly match text in the Croatian sentence: "${targetText}".`);
    error.status = 400;
    throw error;
  }
}

function createCard({ type, story, sentence, body }) {
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

function cleanCardType(value, fallback) {
  const type = value === undefined ? fallback : value;
  if (type === "basic" || type === "cloze") return type;
  const error = new Error("Card type must be basic or cloze.");
  error.status = 400;
  throw error;
}

function fieldOrCurrent(body, name, current) {
  return body[name] === undefined ? current : body[name];
}

function updateCardFields(card, body) {
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

function isDuplicateCard(cards, draft, ignoredCardId = "") {
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

function queueAnkiNoteDeletion(cardsState, noteId) {
  const id = Number(noteId);
  if (!Number.isFinite(id)) return;
  const existingQueue = Array.isArray(cardsState.deletedAnkiNoteIds) ? cardsState.deletedAnkiNoteIds : [];
  if (!existingQueue.includes(id)) existingQueue.push(id);
  cardsState.deletedAnkiNoteIds = existingQueue;
}

async function generateAudio({ text, cardId }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "TRnNlYQWHAJwo9K75wNE";
  const model = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

  if (!apiKey) {
    const error = new Error("ELEVENLABS_API_KEY is not configured on the backend.");
    error.status = 503;
    throw error;
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        model_id: model
      })
    }
  );

  if (!response.ok) {
    const details = await response.text();
    const error = new Error(`ElevenLabs request failed: ${details}`);
    error.status = 502;
    throw error;
  }

  const audio = Buffer.from(await response.arrayBuffer());
  const audioFile = `${cardId}.mp3`;
  await fs.writeFile(path.join(mediaDir, audioFile), audio);
  return audioFile;
}

async function addAudioIfRequested(card, shouldGenerateAudio) {
  if (!shouldGenerateAudio) return;
  try {
    card.audioFile = await generateAudio({ text: card.croatianSentence, cardId: card.id });
  } catch {
    card.audioFile = null;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlText(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function withCardComment(card, html) {
  return `<!--lc:${escapeHtml(card.id)}-->${html}`;
}

function clozeText(card) {
  const index = card.croatianSentence.indexOf(card.targetText);
  if (index === -1) return withCardComment(card, htmlText(card.croatianSentence));

  return withCardComment(
    card,
    `${htmlText(card.croatianSentence.slice(0, index))}{{c1::${htmlText(card.targetText)}}}${htmlText(
      card.croatianSentence.slice(index + card.targetText.length)
    )}`
  );
}

function ankiAudioReference(card) {
  return card.audioFile ? `[sound:${card.audioFile}]` : "";
}

function buildAnkiFields(card, { includeAudioReference = false } = {}) {
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

function buildAnkiNote(card, settings) {
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

function ankiUrlFrom(value) {
  return asCleanString(value).replace(/\/+$/, "") || defaultSettings.ankiUrl;
}

async function invokeAnki(action, params = {}, ankiUrl) {
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

async function markMissingAnkiNotesForResync(cardsState, settings) {
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

async function deleteQueuedAnkiNotes(cardsState, settings) {
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

function expectedModelName(card) {
  return card.type === "basic" ? basicModelName : clozeModelName;
}

function noteHasLocalCardId(noteInfo, cardId) {
  return Object.values(noteInfo?.fields || {}).some((field) => String(field?.value || "").includes(`lc:${cardId}`));
}

async function uploadCardAudioForUpdate(card, settings) {
  if (!card.audioFile) return;
  const audioPath = path.join(mediaDir, card.audioFile);
  try {
    await fs.access(audioPath);
  } catch {
    return;
  }
  await invokeAnki("storeMediaFile", { filename: card.audioFile, path: audioPath }, settings.ankiUrl);
}

async function updateExistingAnkiNote(card, noteId, settings) {
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

async function findAppNotesForCard(card, settings) {
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

async function recoverExistingAnkiNotes(cardsState, settings) {
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
  background: #fbfbf7;
  color: #242722;
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
  color: #1f6f5b;
  font-weight: 800;
}
.lc-audio {
  margin-bottom: 14px;
}
.lc-divider {
  border: 0;
  border-top: 1px solid #d8ddcf;
  margin: 24px 0 18px;
}
.lc-english {
  font-size: 22px;
  margin-bottom: 14px;
}
.lc-hint {
  background: #eef3e8;
  border-left: 3px solid #b9decf;
  color: #42503d;
  font-size: 20px;
  margin-top: 18px;
  padding: 10px 12px;
}
.lc-note {
  color: #666d60;
  font-size: 18px;
}
.nightMode.card,
.night_mode .card {
  background: #20231f;
  color: #f2f3ed;
}
.nightMode .lc-divider,
.night_mode .lc-divider {
  border-top-color: #4b5147;
}
.nightMode .cloze,
.night_mode .cloze {
  color: #8fd3b6;
}
.nightMode .lc-hint,
.night_mode .lc-hint {
  background: #2c332b;
  border-left-color: #315c4b;
  color: #d6ddce;
}
.nightMode .lc-note,
.night_mode .lc-note {
  color: #b7bdae;
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

async function ensureAnkiSetup(settings) {
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

app.get("/api/texts", async (_request, response, next) => {
  try {
    response.json({ stories: await listStories() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/texts/:id", async (request, response, next) => {
  try {
    const story = await readStory(request.params.id);
    if (!story) return response.status(404).json({ error: "Story not found." });
    const cardsState = await readCards();
    response.json({ story: attachCardStatus(story, cardsState.cards) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/texts/import", async (request, response, next) => {
  try {
    const title = String(request.body.title || "").trim();
    const text = String(request.body.text || "").trim();
    if (!title) return response.status(400).json({ error: "Title is required." });
    if (!text) return response.status(400).json({ error: "Croatian text is required." });

    const story = buildStory({ title, level: request.body.level, text });
    if (!story.paragraphs.length || story.paragraphs.every((paragraph) => !paragraph.sentences.length)) {
      return response.status(400).json({ error: "The text did not contain any sentences." });
    }

    story.id = await buildUniqueStoryId(title);
    await writeStory(story);
    response.status(201).json({ storyId: story.id });
  } catch (error) {
    next(error);
  }
});

app.post("/api/texts/:id/sentences/:sentenceId/analyze", async (request, response, next) => {
  try {
    const story = await readStory(request.params.id);
    if (!story) return response.status(404).json({ error: "Story not found." });

    const sentence = findSentence(story, request.params.sentenceId);
    if (!sentence) return response.status(404).json({ error: "Sentence not found." });
    if (sentence.analysis) return response.json({ analysis: sentence.analysis });

    sentence.analysis = await generateAnalysis({ croatian: sentence.croatian, level: story.level });
    await writeStory(story);
    response.json({ analysis: sentence.analysis });
  } catch (error) {
    next(error);
  }
});

app.get("/api/cards", async (_request, response, next) => {
  try {
    const cardsState = await readCards();
    response.json({ cards: cardsState.cards.map(cardForClient) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/cards", async (request, response, next) => {
  try {
    const story = await readStory(request.body.storyId);
    if (!story) return response.status(404).json({ error: "Story not found." });
    const sentence = findSentence(story, request.body.sentenceId);
    if (!sentence) return response.status(404).json({ error: "Sentence not found." });

    const cardsState = await readCards();
    const type = cleanCardType(request.body.type);
    const draft = createCard({ type, story, sentence, body: request.body });

    if (isDuplicateCard(cardsState.cards, draft)) {
      return response.status(409).json({ error: "A matching card already exists." });
    }

    await addAudioIfRequested(draft, Boolean(request.body.generateAudio));
    cardsState.cards.push(draft);
    await writeCards(cardsState);
    response.status(201).end();
  } catch (error) {
    next(error);
  }
});

app.patch("/api/cards/:id", async (request, response, next) => {
  try {
    const cardsState = await readCards();
    const index = cardsState.cards.findIndex((card) => card.id === request.params.id);
    if (index === -1) {
      return response.status(404).json({ error: "Card not found." });
    }

    const current = cardsState.cards[index];
    const updated = updateCardFields(current, request.body || {});
    if (isDuplicateCard(cardsState.cards, updated, current.id)) {
      return response.status(409).json({ error: "A matching card already exists." });
    }

    if (current.ankiNoteId) {
      queueAnkiNoteDeletion(cardsState, current.ankiNoteId);
      updated.ankiNoteId = null;
    }

    updated.syncStatus = "pending";
    updated.syncError = null;
    cardsState.cards[index] = updated;
    await writeCards(cardsState);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.delete("/api/cards/:id", async (request, response, next) => {
  try {
    const cardsState = await readCards();
    const card = cardsState.cards.find((item) => item.id === request.params.id);
    if (!card) {
      return response.status(404).json({ error: "Card not found." });
    }
    if (card.ankiNoteId) queueAnkiNoteDeletion(cardsState, card.ankiNoteId);

    const nextCards = cardsState.cards.filter((item) => item.id !== request.params.id);
    cardsState.cards = nextCards;
    await writeCards(cardsState);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/cards/sync", async (_request, response, next) => {
  try {
    const settings = await readSettings();
    const cardsState = await readCards();

    await ensureAnkiSetup(settings);
    const deleted = await deleteQueuedAnkiNotes(cardsState, settings);
    const missing = await markMissingAnkiNotesForResync(cardsState, settings);
    const recovered = await recoverExistingAnkiNotes(cardsState, settings);
    const cardsToSync = cardsState.cards.filter((card) => !card.ankiNoteId);

    if (!cardsToSync.length) {
      await writeCards(cardsState);
      return response.json({ synced: 0, failed: 0, recreated: missing, recovered, deleted });
    }

    const notes = cardsToSync.map((card) => buildAnkiNote(card, settings));
    const canAdd = await invokeAnki("canAddNotesWithErrorDetail", { notes }, settings.ankiUrl);
    const addableNotes = [];
    const addableCards = [];
    let failed = 0;

    for (let index = 0; index < cardsToSync.length; index += 1) {
      const check = canAdd[index];
      if (check?.canAdd) {
        addableNotes.push(notes[index]);
        addableCards.push(cardsToSync[index]);
      } else {
        failed += 1;
        cardsToSync[index].syncStatus = "error";
        cardsToSync[index].syncError = check?.error || "Anki rejected this card.";
      }
    }

    let synced = 0;
    if (addableNotes.length) {
      const noteIds = await invokeAnki("addNotes", { notes: addableNotes }, settings.ankiUrl);
      for (let index = 0; index < addableCards.length; index += 1) {
        const noteId = noteIds[index];
        const card = addableCards[index];
        if (noteId) {
          synced += 1;
          card.ankiNoteId = noteId;
          card.syncStatus = "synced";
          card.syncError = null;
        } else {
          failed += 1;
          card.syncStatus = "error";
          card.syncError = "Anki did not return a note id.";
        }
      }
    }

    await writeCards(cardsState);
    response.json({ synced, failed, recreated: missing, recovered, deleted });
  } catch (error) {
    next(error);
  }
});

app.get("/api/settings", async (_request, response, next) => {
  try {
    response.json({ settings: await readSettings() });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/settings", async (request, response, next) => {
  try {
    await writeSettings(request.body);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/anki/test", async (request, response, next) => {
  try {
    const settings = cleanSettings({ ...(await readSettings()), ...request.body });
    const version = await invokeAnki("version", {}, settings.ankiUrl);
    response.json({ version });
  } catch (error) {
    next(error);
  }
});

app.post("/api/anki/decks", async (request, response, next) => {
  try {
    const settings = cleanSettings({ ...(await readSettings()), ...request.body });
    const decks = await invokeAnki("deckNames", {}, settings.ankiUrl);
    response.json({ decks });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/progress/:storyId", async (request, response, next) => {
  try {
    assertStoryId(request.params.storyId);
    const completed = Boolean(request.body.completed);
    const progress = await readProgress();
    if (completed) {
      progress.stories[request.params.storyId] = { completed: true };
    } else {
      delete progress.stories[request.params.storyId];
    }
    await writeProgress(progress);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  const status = error.status || 500;
  response.status(status).json({ error: error.message || "Unexpected server error." });
});

await ensureStorage();

app.listen(port, "127.0.0.1", () => {
  console.log(`Croatian reader API listening on http://127.0.0.1:${port}`);
});
