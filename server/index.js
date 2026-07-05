import express from "express";
import { mediaDir, port } from "./config.js";
import { ankiRouter } from "./routes/anki.js";
import { cardsRouter } from "./routes/cards.js";
import { progressRouter } from "./routes/progress.js";
import { settingsRouter } from "./routes/settings.js";
import { textsRouter } from "./routes/texts.js";
import { ensureStorage } from "./storage/ensureStorage.js";

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use("/media", express.static(mediaDir));

app.use("/api/texts", textsRouter);
app.use("/api/cards", cardsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/anki", ankiRouter);
app.use("/api/progress", progressRouter);

app.use((error, _request, response, _next) => {
  const status = error.status || 500;
  response.status(status).json({ error: error.message || "Unexpected server error." });
});

await ensureStorage();

app.listen(port, "127.0.0.1", () => {
  console.log(`Croatian reader API listening on http://127.0.0.1:${port}`);
});
