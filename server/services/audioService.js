import { promises as fs } from "node:fs";
import path from "node:path";
import { mediaDir } from "../config.js";

const uploadedAudioExtensions = new Set([".aac", ".flac", ".m4a", ".mp3", ".mp4", ".oga", ".ogg", ".wav", ".webm"]);
const audioMimeExtensions = new Map([
  ["audio/aac", ".aac"],
  ["audio/flac", ".flac"],
  ["audio/mp3", ".mp3"],
  ["audio/mp4", ".m4a"],
  ["audio/mpeg", ".mp3"],
  ["audio/ogg", ".ogg"],
  ["audio/wav", ".wav"],
  ["audio/webm", ".webm"],
  ["audio/x-m4a", ".m4a"],
  ["audio/x-wav", ".wav"]
]);

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanUploadedAudioExtension(originalName, mimeType) {
  const extension = path.extname(String(originalName || "")).toLowerCase();
  if (uploadedAudioExtensions.has(extension)) return extension;

  const cleanMimeType = String(mimeType || "").split(";")[0].trim().toLowerCase();
  const mimeExtension = audioMimeExtensions.get(cleanMimeType);
  if (mimeExtension) return mimeExtension;

  throw httpError("Audio file must be MP3, M4A, WAV, OGG, WEBM, FLAC, or AAC.", 400);
}

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

export async function saveUploadedStoryAudio({ storyId, originalName, mimeType, buffer, previousAudioFile }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw httpError("Audio file is required.", 400);
  }

  const extension = cleanUploadedAudioExtension(originalName, mimeType);
  const audioFile = `story-${storyId}${extension}`;
  await fs.writeFile(path.join(mediaDir, audioFile), buffer);

  if (previousAudioFile && previousAudioFile !== audioFile) {
    await deleteAudioFile(previousAudioFile);
  }

  return audioFile;
}

export async function addAudioIfRequested(card, shouldGenerateAudio) {
  if (!shouldGenerateAudio) return;
  try {
    card.audioFile = await generateAudio({ text: card.croatianSentence, cardId: card.id });
  } catch {
    card.audioFile = null;
  }
}
