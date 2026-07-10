import { Router } from "express";
import { readProgress, writeProgress } from "../repositories/progressRepository.js";
import { assertStoryId } from "../repositories/storiesRepository.js";

export const progressRouter = Router();

function hasBodyProperty(body, property) {
  return Object.prototype.hasOwnProperty.call(body || {}, property);
}

function cleanPageIndex(value) {
  const pageIndex = Number(value);
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    const error = new Error("Page index must be a non-negative integer.");
    error.status = 400;
    throw error;
  }
  return pageIndex;
}

progressRouter.patch("/:storyId", async (request, response, next) => {
  try {
    const storyId = request.params.storyId;
    assertStoryId(storyId);

    const progress = await readProgress();
    const state = { ...(progress.stories[storyId] || {}) };

    if (hasBodyProperty(request.body, "completed")) {
      if (request.body.completed) {
        state.completed = true;
      } else {
        delete state.completed;
      }
    }

    if (hasBodyProperty(request.body, "pageIndex")) {
      const pageIndex = cleanPageIndex(request.body.pageIndex);
      if (pageIndex > 0) {
        state.pageIndex = pageIndex;
      } else {
        delete state.pageIndex;
      }
    }

    if (state.completed || state.pageIndex > 0) {
      progress.stories[storyId] = state;
    } else {
      delete progress.stories[storyId];
    }

    await writeProgress(progress);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});
