import { promises as fs } from "node:fs";
import path from "node:path";
import { textsDir } from "../config.js";
import { readJson, writeJsonSafe } from "../storage/jsonStore.js";
import { assertFolderId, cleanFolderId, replaceFolderPrefix } from "../utils/folders.js";
import { slugify } from "../utils/text.js";
import { readProgress } from "./progressRepository.js";

export function assertStoryId(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    const error = new Error("Invalid story id.");
    error.status = 400;
    throw error;
  }
}

function storyFolderPath(folderId) {
  const cleanId = cleanFolderId(folderId);
  assertFolderId(cleanId);
  return cleanId ? path.join(textsDir, cleanId, "") : textsDir;
}

function storyFilePath(story) {
  assertStoryId(story.id);
  return path.join(storyFolderPath(story.folderId || ""), `${story.id}.json`);
}

async function readStoryRecordsFromDirectory(directory) {
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const records = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "hr"))) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      records.push(...(await readStoryRecordsFromDirectory(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      const story = await readJson(entryPath, null);
      if (story) records.push({ story, filePath: entryPath });
    }
  }

  return records;
}

async function readAllStoryRecords() {
  return readStoryRecordsFromDirectory(textsDir);
}

async function findStoryRecord(id) {
  assertStoryId(id);
  const records = await readAllStoryRecords();
  return records.find((record) => record.story?.id === id) || null;
}

async function writeStoryRecord(story, previousPath = "") {
  const nextPath = storyFilePath(story);
  await writeJsonSafe(nextPath, story);
  if (previousPath && path.resolve(previousPath) !== path.resolve(nextPath)) {
    await fs.rm(previousPath, { force: true });
  }
}

export async function readStory(id) {
  return (await findStoryRecord(id))?.story || null;
}

export async function writeStory(story) {
  const existing = story.id ? await findStoryRecord(story.id) : null;
  await writeStoryRecord(story, existing?.filePath || "");
}

async function readAllStories() {
  return (await readAllStoryRecords()).map((record) => record.story).filter(Boolean);
}

export async function listStories() {
  await ensureStoryFilesMatchFolders();
  const progress = await readProgress();
  const stories = await readAllStories();
  const summaries = stories.map((story) => {
    const state = progress.stories[story.id] || {};
    return {
      id: story.id,
      title: story.title,
      level: story.level,
      folderId: story.folderId || "",
      hasAudio: Boolean(story.audioFile),
      completed: Boolean(state.completed)
    };
  });

  return summaries.sort((a, b) => a.title.localeCompare(b.title, "hr"));
}

export function attachCardStatus(story, cards) {
  const counts = new Map();
  for (const card of cards) {
    if (card.storyId !== story.id) continue;
    counts.set(card.sentenceId, (counts.get(card.sentenceId) || 0) + 1);
  }

  return {
    ...story,
    folderId: story.folderId || "",
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

export async function updateStoryMetadata(id, values) {
  const story = await readStory(id);
  if (!story) return null;

  if (Object.prototype.hasOwnProperty.call(values, "title")) {
    const cleanTitle = String(values.title || "").trim().replace(/\s+/g, " ");
    if (!cleanTitle) {
      const error = new Error("Story title is required.");
      error.status = 400;
      throw error;
    }
    story.title = cleanTitle;
  }

  if (Object.prototype.hasOwnProperty.call(values, "level")) {
    const cleanLevel = String(values.level || "").trim();
    if (!cleanLevel) {
      const error = new Error("Story level is required.");
      error.status = 400;
      throw error;
    }
    story.level = cleanLevel;
  }

  await writeStory(story);
  return story;
}

export async function moveStoryToFolder(id, folderId) {
  const record = await findStoryRecord(id);
  if (!record) return null;

  const story = record.story;
  story.folderId = folderId || "";
  await writeStoryRecord(story, record.filePath);
  return story;
}

export async function updateStoryFolderIds(oldFolderId, newFolderId) {
  const cleanOldFolderId = cleanFolderId(oldFolderId);
  const cleanNewFolderId = cleanFolderId(newFolderId);
  assertFolderId(cleanOldFolderId);
  assertFolderId(cleanNewFolderId);
  if (cleanOldFolderId === cleanNewFolderId) return [];

  const updatedStories = [];
  const records = await readAllStoryRecords();
  for (const record of records) {
    const currentFolderId = cleanFolderId(record.story.folderId);
    const nextFolderId = replaceFolderPrefix(currentFolderId, cleanOldFolderId, cleanNewFolderId);
    if (nextFolderId === currentFolderId) continue;

    const story = {
      ...record.story,
      folderId: nextFolderId
    };
    await writeStoryRecord(story, record.filePath);
    updatedStories.push(story);
  }

  return updatedStories;
}

export async function deleteStories(ids) {
  const storyIdSet = new Set(ids);
  const records = await readAllStoryRecords();
  const deletedRecords = records.filter((record) => storyIdSet.has(record.story.id));
  const deletedStories = deletedRecords.map((record) => record.story);
  if (!deletedStories.length) return [];

  await Promise.all(deletedRecords.map((record) => fs.rm(record.filePath, { force: true })));
  return deletedStories;
}

export function findSentence(story, sentenceId) {
  for (const paragraph of story.paragraphs || []) {
    const sentence = (paragraph.sentences || []).find((item) => item.id === sentenceId);
    if (sentence) return sentence;
  }
  return null;
}

export function findSentenceContext(story, sentenceId) {
  const sentences = [];
  for (const paragraph of story.paragraphs || []) {
    for (const sentence of paragraph.sentences || []) {
      sentences.push(sentence);
    }
  }

  const index = sentences.findIndex((sentence) => sentence.id === sentenceId);
  if (index < 0) return null;

  return {
    sentence: sentences[index],
    previousSentence: sentences[index - 1] || null,
    nextSentence: sentences[index + 1] || null
  };
}

export async function buildUniqueStoryId(title) {
  const base = slugify(title);
  let candidate = base;
  let index = 1;

  while (true) {
    if (!(await findStoryRecord(candidate))) {
      return candidate;
    }
    candidate = `${base}-${index}`;
    index += 1;
  }
}

async function ensureStoryFilesMatchFolders() {
  const records = await readAllStoryRecords();
  await Promise.all(
    records.map(async (record) => {
      const expectedPath = storyFilePath(record.story);
      if (path.resolve(record.filePath) === path.resolve(expectedPath)) return;
      await writeStoryRecord(record.story, record.filePath);
    })
  );
}
