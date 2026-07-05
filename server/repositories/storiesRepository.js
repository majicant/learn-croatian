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

export function storyPath(id) {
  assertStoryId(id);
  return path.join(textsDir, `${id}.json`);
}

export async function readStory(id) {
  return readJson(storyPath(id), null);
}

export async function writeStory(story) {
  await writeJsonSafe(storyPath(story.id), story);
}

export async function listStories() {
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

export function attachCardStatus(story, cards) {
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

export function findSentence(story, sentenceId) {
  for (const paragraph of story.paragraphs || []) {
    const sentence = (paragraph.sentences || []).find((item) => item.id === sentenceId);
    if (sentence) return sentence;
  }
  return null;
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
