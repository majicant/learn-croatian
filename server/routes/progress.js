import { Router } from "express";
import { readProgress, writeProgress } from "../repositories/progressRepository.js";
import { assertStoryId } from "../repositories/storiesRepository.js";

export const progressRouter = Router();

progressRouter.patch("/:storyId", async (request, response, next) => {
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
