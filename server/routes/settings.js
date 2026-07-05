import { Router } from "express";
import { readSettings, writeSettings } from "../repositories/settingsRepository.js";

export const settingsRouter = Router();

settingsRouter.get("/", async (_request, response, next) => {
  try {
    response.json({ settings: await readSettings() });
  } catch (error) {
    next(error);
  }
});

settingsRouter.patch("/", async (request, response, next) => {
  try {
    await writeSettings(request.body);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});
