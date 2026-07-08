import { promises as fs } from "node:fs";
import path from "node:path";
import { mediaDir } from "../config.js";

export async function generateAudio({ text, cardId }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "TRnNlYQWHAJwo9K75wNE";
  const model = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

  if (!apiKey) {
    const error = new Error("ELEVENLABS_API_KEY is not configured on the backend.");
    error.status = 503;
    throw error;
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        model_id: model
      })
    }
  );

  if (!response.ok) {
    const details = await response.text();
    const error = new Error(`ElevenLabs request failed: ${details}`);
    error.status = 502;
    throw error;
  }

  const audio = Buffer.from(await response.arrayBuffer());
  const audioFile = `${cardId}.mp3`;
  await fs.writeFile(path.join(mediaDir, audioFile), audio);
  return audioFile;
}

export async function deleteAudioFile(audioFile) {
  const fileName = String(audioFile || "");
  if (!fileName || path.basename(fileName) !== fileName) return;

  try {
    await fs.unlink(path.join(mediaDir, fileName));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function addAudioIfRequested(card, shouldGenerateAudio) {
  if (!shouldGenerateAudio) return;
  try {
    card.audioFile = await generateAudio({ text: card.croatianSentence, cardId: card.id });
  } catch {
    card.audioFile = null;
  }
}
