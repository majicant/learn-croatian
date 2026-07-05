import { Router } from "express";
import { deleteCardsForStories, readCards } from "../repositories/cardsRepository.js";
import { deleteProgressForStories } from "../repositories/progressRepository.js";
import {
  attachCardStatus,
  buildUniqueStoryId,
  deleteStories,
  findSentence,
  listStories,
  moveStoryToFolder,
  readStory,
  updateStoryMetadata,
  writeStory
} from "../repositories/storiesRepository.js";
import {
  assertStoryFolderExists,
  createStoryFolder,
  deleteStoryFolder,
  listStoryFolders,
  renameStoryFolder
} from "../repositories/storyFoldersRepository.js";
import { generateAnalysis } from "../services/analysisService.js";
import { buildStory } from "../services/storyService.js";

export const textsRouter = Router();

textsRouter.get("/", async (_request, response, next) => {
  try {
    response.json({ stories: await listStories() });
  } catch (error) {
    next(error);
  }
});

textsRouter.get("/folders", async (_request, response, next) => {
  try {
    response.json({ folders: await listStoryFolders() });
  } catch (error) {
    next(error);
  }
});

textsRouter.post("/folders", async (request, response, next) => {
  try {
    const folder = await createStoryFolder(request.body.name);
    response.status(201).json({ folder });
  } catch (error) {
    next(error);
  }
});

textsRouter.patch("/folders/:id", async (request, response, next) => {
  try {
    const folder = await renameStoryFolder(request.params.id, request.body.name);
    response.json({ folder });
  } catch (error) {
    next(error);
  }
});

textsRouter.delete("/folders/:id", async (request, response, next) => {
  try {
    const folders = await listStoryFolders();
    if (!folders.some((folder) => folder.id === request.params.id)) {
      return response.status(404).json({ error: "Folder not found." });
    }

    const stories = await listStories();
    const storyIds = stories.filter((story) => story.folderId === request.params.id).map((story) => story.id);

    await deleteStories(storyIds);
    await deleteCardsForStories(storyIds);
    await deleteProgressForStories(storyIds);
    await deleteStoryFolder(request.params.id);

    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

textsRouter.get("/:id", async (request, response, next) => {
  try {
    const story = await readStory(request.params.id);
    if (!story) return response.status(404).json({ error: "Story not found." });
    const cardsState = await readCards();
    response.json({ story: attachCardStatus(story, cardsState.cards) });
  } catch (error) {
    next(error);
  }
});

textsRouter.patch("/:id", async (request, response, next) => {
  try {
    const story = await updateStoryMetadata(request.params.id, {
      ...(Object.prototype.hasOwnProperty.call(request.body || {}, "title") ? { title: request.body.title } : {}),
      ...(Object.prototype.hasOwnProperty.call(request.body || {}, "level") ? { level: request.body.level } : {})
    });
    if (!story) return response.status(404).json({ error: "Story not found." });
    response.json({ storyId: story.id, title: story.title, level: story.level });
  } catch (error) {
    next(error);
  }
});

textsRouter.post("/import", async (request, response, next) => {
  try {
    const title = String(request.body.title || "").trim();
    const text = String(request.body.text || "").trim();
    if (!title) return response.status(400).json({ error: "Title is required." });
    if (!text) return response.status(400).json({ error: "Croatian text is required." });
    const folderId = await assertStoryFolderExists(request.body.folderId);

    const story = buildStory({ title, level: request.body.level, text, folderId });
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

textsRouter.patch("/:id/folder", async (request, response, next) => {
  try {
    const folderId = await assertStoryFolderExists(request.body.folderId);
    const story = await moveStoryToFolder(request.params.id, folderId);
    if (!story) return response.status(404).json({ error: "Story not found." });
    response.json({ storyId: story.id, folderId: story.folderId || "" });
  } catch (error) {
    next(error);
  }
});

textsRouter.delete("/:id", async (request, response, next) => {
  try {
    const deletedStories = await deleteStories([request.params.id]);
    if (!deletedStories.length) return response.status(404).json({ error: "Story not found." });

    await deleteCardsForStories([request.params.id]);
    await deleteProgressForStories([request.params.id]);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

textsRouter.post("/:id/sentences/:sentenceId/analyze", async (request, response, next) => {
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
