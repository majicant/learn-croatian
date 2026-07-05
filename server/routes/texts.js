import { Router } from "express";
import { readCards } from "../repositories/cardsRepository.js";
import {
  attachCardStatus,
  buildUniqueStoryId,
  findSentence,
  listStories,
  readStory,
  writeStory
} from "../repositories/storiesRepository.js";
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

textsRouter.post("/import", async (request, response, next) => {
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
