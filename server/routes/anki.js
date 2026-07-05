import { Router } from "express";
import { cleanSettings, readSettings } from "../repositories/settingsRepository.js";
import { invokeAnki } from "../services/ankiService.js";

export const ankiRouter = Router();

ankiRouter.post("/test", async (request, response, next) => {
  try {
    const settings = cleanSettings({ ...(await readSettings()), ...request.body });
    const version = await invokeAnki("version", {}, settings.ankiUrl);
    response.json({ version });
  } catch (error) {
    next(error);
  }
});

ankiRouter.post("/decks", async (request, response, next) => {
  try {
    const settings = cleanSettings({ ...(await readSettings()), ...request.body });
    const decks = await invokeAnki("deckNames", {}, settings.ankiUrl);
    response.json({ decks });
  } catch (error) {
    next(error);
  }
});
