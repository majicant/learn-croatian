import express, { Router } from "express";
import { readCards } from "../repositories/cardsRepository.js";
import { deleteProgressForStories, readProgress } from "../repositories/progressRepository.js";
import {
  attachCardStatus,
  buildUniqueStoryId,
  deleteStories,
  findSentence,
  findSentenceContext,
  listStories,
  moveStoryToFolder,
  readStory,
  updateStoryMetadata,
  updateStoryFolderIds,
  writeStory
} from "../repositories/storiesRepository.js";
import {
  assertStoryFolderExists,
  createStoryFolder,
  deleteStoryFolder,
  listStoryFolders,
  moveStoryFolder,
  renameStoryFolder
} from "../repositories/storyFoldersRepository.js";
import { generateAnalysis } from "../services/analysisService.js";
import { deleteAudioFile, renderStoryAudioClip, saveUploadedStoryAudio } from "../services/audioService.js";
import { buildStory } from "../services/storyService.js";
import { isSameOrDescendantFolder } from "../utils/folders.js";

export const textsRouter = Router();

const audioBodyParser = express.raw({
  limit: "100mb",
  type: (request) => {
    const contentType = String(request.headers["content-type"] || "").toLowerCase();
    return contentType.startsWith("audio/") || contentType.startsWith("application/octet-stream");
  }
});

function decodedUploadFileName(request) {
  const value = request.get("x-file-name") || "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function deleteStoryAudioFiles(stories) {
  await Promise.all(stories.map((story) => deleteAudioFile(story.audioFile)));
}

function cleanSentenceText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function removeSentence(story, sentenceId) {
  let removed = false;
  const paragraphs = [];

  for (const paragraph of story.paragraphs || []) {
    const nextSentences = [];
    for (const sentence of paragraph.sentences || []) {
      if (sentence.id === sentenceId) {
        removed = true;
      } else {
        nextSentences.push(sentence);
      }
    }
    if (nextSentences.length) paragraphs.push({ ...paragraph, sentences: nextSentences });
  }

  if (!removed) return false;
  story.paragraphs = paragraphs;
  return true;
}

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
    const folder = await createStoryFolder(request.body.name, request.body.parentId);
    response.status(201).json({ folder });
  } catch (error) {
    next(error);
  }
});

textsRouter.patch("/folders/:id", async (request, response, next) => {
  try {
    const result = await renameStoryFolder(request.params.id, request.body.name);
    await updateStoryFolderIds(result.oldFolderId, result.newFolderId);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

textsRouter.patch("/folders/:id/parent", async (request, response, next) => {
  try {
    const result = await moveStoryFolder(request.params.id, request.body.parentId);
    await updateStoryFolderIds(result.oldFolderId, result.newFolderId);
    response.json(result);
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
    const storyIds = stories
      .filter((story) => story.folderId === request.params.id || isSameOrDescendantFolder(story.folderId, request.params.id))
      .map((story) => story.id);

    const deletedStories = await deleteStories(storyIds);
    await deleteStoryAudioFiles(deletedStories);
    await deleteProgressForStories(storyIds);
    await deleteStoryFolder(request.params.id);

    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

textsRouter.get("/:id/audio/clip-preview", async (request, response, next) => {
  const controller = new AbortController();
  const abortOnDisconnect = () => {
    if (!response.writableEnded) controller.abort();
  };
  response.on("close", abortOnDisconnect);

  try {
    const story = await readStory(request.params.id);
    if (!story) return response.status(404).json({ error: "Story not found." });

    const audio = await renderStoryAudioClip({
      story,
      start: request.query.start,
      end: request.query.end,
      signal: controller.signal
    });
    if (controller.signal.aborted) return;
    response.set("Cache-Control", "no-store");
    response.type("audio/wav").send(audio);
  } catch (error) {
    if (!controller.signal.aborted) next(error);
  } finally {
    response.off("close", abortOnDisconnect);
  }
});

textsRouter.get("/:id", async (request, response, next) => {
  try {
    const story = await readStory(request.params.id);
    if (!story) return response.status(404).json({ error: "Story not found." });
    const cardsState = await readCards();
    const progress = await readProgress();
    const storyProgress = progress.stories[story.id] || {};
    response.json({
      story: {
        ...attachCardStatus(story, cardsState.cards),
        pageIndex: storyProgress.pageIndex || 0
      }
    });
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

textsRouter.put("/:id/audio", audioBodyParser, async (request, response, next) => {
  try {
    const story = await readStory(request.params.id);
    if (!story) return response.status(404).json({ error: "Story not found." });

    const audioFile = await saveUploadedStoryAudio({
      storyId: story.id,
      originalName: decodedUploadFileName(request),
      mimeType: request.get("content-type") || "",
      buffer: request.body,
      previousAudioFile: story.audioFile
    });

    story.audioFile = audioFile;
    await writeStory(story);
    response.json({ storyId: story.id, audioFile });
  } catch (error) {
    next(error);
  }
});

textsRouter.delete("/:id/audio", async (request, response, next) => {
  try {
    const story = await readStory(request.params.id);
    if (!story) return response.status(404).json({ error: "Story not found." });

    if (story.audioFile) {
      await deleteAudioFile(story.audioFile);
      story.audioFile = null;
      await writeStory(story);
    }

    response.json({ storyId: story.id, audioFile: null });
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

    await deleteStoryAudioFiles(deletedStories);
    await deleteProgressForStories([request.params.id]);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

textsRouter.patch("/:id/sentences/:sentenceId", async (request, response, next) => {
  try {
    const story = await readStory(request.params.id);
    if (!story) return response.status(404).json({ error: "Story not found." });

    const sentence = findSentence(story, request.params.sentenceId);
    if (!sentence) return response.status(404).json({ error: "Sentence not found." });

    const croatian = cleanSentenceText(request.body?.croatian);
    if (!croatian) return response.status(400).json({ error: "Sentence text is required." });

    const textChanged = sentence.croatian !== croatian;
    if (textChanged) {
      sentence.croatian = croatian;
      delete sentence.analysis;
      await writeStory(story);
    }

    const cardsState = await readCards();
    const clientStory = attachCardStatus(story, cardsState.cards);
    response.json({
      sentence: findSentence(clientStory, request.params.sentenceId)
    });
  } catch (error) {
    next(error);
  }
});

textsRouter.delete("/:id/sentences/:sentenceId", async (request, response, next) => {
  try {
    const story = await readStory(request.params.id);
    if (!story) return response.status(404).json({ error: "Story not found." });

    if (!removeSentence(story, request.params.sentenceId)) {
      return response.status(404).json({ error: "Sentence not found." });
    }

    await writeStory(story);

    const cardsState = await readCards();
    response.json({ story: attachCardStatus(story, cardsState.cards) });
  } catch (error) {
    next(error);
  }
});

textsRouter.post("/:id/sentences/:sentenceId/analyze", async (request, response, next) => {
  try {
    const story = await readStory(request.params.id);
    if (!story) return response.status(404).json({ error: "Story not found." });

    const context = findSentenceContext(story, request.params.sentenceId);
    if (!context) return response.status(404).json({ error: "Sentence not found." });
    const { sentence, previousSentence, nextSentence } = context;
    const forceAnalysis = request.body?.force === true;
    if (!forceAnalysis && sentence.analysis) {
      return response.json({ analysis: sentence.analysis });
    }

    sentence.analysis = await generateAnalysis({
      croatian: sentence.croatian,
      level: story.level,
      storyTitle: story.title,
      previousCroatian: previousSentence?.croatian || "",
      nextCroatian: nextSentence?.croatian || ""
    });
    await writeStory(story);
    response.json({ analysis: sentence.analysis });
  } catch (error) {
    next(error);
  }
});
