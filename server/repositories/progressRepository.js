import { progressFile } from "../config.js";
import { readJson, writeJsonSafe } from "../storage/jsonStore.js";

export async function readProgress() {
  const raw = await readJson(progressFile, { stories: {} });
  return { stories: raw && typeof raw.stories === "object" && raw.stories ? raw.stories : {} };
}

export async function writeProgress(progress) {
  await writeJsonSafe(progressFile, { stories: progress.stories });
}

export async function deleteProgressForStories(storyIds) {
  const progress = await readProgress();
  for (const storyId of storyIds) {
    delete progress.stories[storyId];
  }
  await writeProgress(progress);
}
