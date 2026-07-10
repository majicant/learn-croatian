import { progressFile } from "../config.js";
import { readJson, writeJsonSafe } from "../storage/jsonStore.js";

function normalizeStoryProgress(value) {
  if (value === true) return { completed: true };
  if (!value || typeof value !== "object") return {};

  const state = {};
  if (value.completed === true) state.completed = true;

  const pageIndex = Number(value.pageIndex);
  if (Number.isInteger(pageIndex) && pageIndex > 0) {
    state.pageIndex = pageIndex;
  }

  return state;
}

function normalizeProgress(raw) {
  const stories = {};
  const rawStories = raw && typeof raw.stories === "object" && raw.stories ? raw.stories : {};
  for (const [storyId, value] of Object.entries(rawStories)) {
    const state = normalizeStoryProgress(value);
    if (state.completed || state.pageIndex > 0) {
      stories[storyId] = state;
    }
  }

  return { stories };
}

export async function readProgress() {
  const raw = await readJson(progressFile, { stories: {} });
  return normalizeProgress(raw);
}

export async function writeProgress(progress) {
  await writeJsonSafe(progressFile, normalizeProgress(progress));
}

export async function deleteProgressForStories(storyIds) {
  const progress = await readProgress();
  for (const storyId of storyIds) {
    delete progress.stories[storyId];
  }
  await writeProgress(progress);
}
