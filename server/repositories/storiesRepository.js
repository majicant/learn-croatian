import { promises as fs } from "node:fs";
import path from "node:path";
import { textsDir } from "../config.js";
import { readJson, writeJsonSafe } from "../storage/jsonStore.js";
import { slugify } from "../utils/text.js";
import { readProgress } from "./progressRepository.js";

export function assertStoryId(id) {
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

export async function readStory(id) {
  return readJson(storyPath(id), null);
}

export async function writeStory(story) {
  await writeJsonSafe(storyPath(story.id), story);
}

async function readAllStories() {
  const files = (await fs.readdir(textsDir)).filter((file) => file.endsWith(".json"));
  const stories = await Promise.all(files.map((file) => readJson(path.join(textsDir, file), null)));
  return stories.filter(Boolean);
}

export async function listStories() {
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
  const story = await readStory(id);
  if (!story) return null;

  story.folderId = folderId || "";
  await writeStory(story);
  return story;
}

export async function deleteStories(ids) {
  const storyIdSet = new Set(ids);
  const stories = await readAllStories();
  const deletedStories = stories.filter((story) => storyIdSet.has(story.id));
  if (!deletedStories.length) return [];

  await Promise.all(deletedStories.map((story) => fs.rm(storyPath(story.id), { force: true })));
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
    try {
      await fs.access(storyPath(candidate));
      candidate = `${base}-${index}`;
      index += 1;
    } catch {
      return candidate;
    }
  }
}
