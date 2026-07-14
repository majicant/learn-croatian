import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { mediaDir } from "../config.js";

const uploadedAudioExtensions = new Set([".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".wav", ".webm"]);
const minStoryAudioClipSeconds = 0.25;
const maxStoryAudioClipSeconds = 90;
const storyAudioSampleRate = 44100;
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

function mediaFilePath(fileName) {
  const cleanFileName = String(fileName || "");
  if (!cleanFileName || path.basename(cleanFileName) !== cleanFileName) {
    throw httpError("Audio file name is invalid.", 400);
  }
  return path.join(mediaDir, cleanFileName);
}

function cleanCropTime(value, name) {
  const time = Number(value);
  if (!Number.isFinite(time)) {
    throw httpError(`${name} must be a valid time.`, 400);
  }
  return Math.round(time * 1000) / 1000;
}

function cleanStoryAudioCrop({ start, end }) {
  const storyAudioStart = cleanCropTime(start, "Story audio start");
  const storyAudioEnd = cleanCropTime(end, "Story audio end");
  const duration = Math.round((storyAudioEnd - storyAudioStart) * 1000) / 1000;

  if (storyAudioStart < 0) {
    throw httpError("Story audio start must be at or after 0:00.", 400);
  }
  if (storyAudioEnd <= storyAudioStart) {
    throw httpError("Story audio end must be after the start time.", 400);
  }
  if (duration < minStoryAudioClipSeconds) {
    throw httpError("Story audio clip must be at least 0.25 seconds.", 400);
  }
  if (duration > maxStoryAudioClipSeconds) {
    throw httpError("Story audio clip must be 90 seconds or shorter.", 400);
  }

  return { start: storyAudioStart, end: storyAudioEnd };
}

function abortedFfmpegError() {
  const error = new Error("Audio crop was cancelled.");
  error.name = "AbortError";
  return error;
}

function runFfmpeg(args, { captureStdout = false, signal } = {}) {
  if (!ffmpegPath) {
    throw httpError("Audio cropping is not available because ffmpeg is not installed.", 503);
  }
  if (signal?.aborted) return Promise.reject(abortedFfmpegError());

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const stdout = [];
    let stderr = "";
    let aborted = false;
    let settled = false;

    function settle(callback, value) {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      callback(value);
    }

    function handleAbort() {
      aborted = true;
      child.kill();
    }

    if (captureStdout) child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => settle(reject, error));
    child.on("close", (code) => {
      if (aborted) {
        settle(reject, abortedFfmpegError());
        return;
      }
      if (code === 0) {
        settle(resolve, captureStdout ? Buffer.concat(stdout) : undefined);
        return;
      }

      const error = new Error(stderr.trim() || "Audio crop failed.");
      error.status = 500;
      settle(reject, error);
    });
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

function storyAudioDecodeArgs(sourcePath, crop) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    sourcePath,
    "-vn",
    "-af",
    `atrim=start=${crop.start}:end=${crop.end},asetpts=PTS-STARTPTS`,
    "-c:a",
    "pcm_s16le",
    "-ar",
    String(storyAudioSampleRate),
    "-ac",
    "1"
  ];
}

async function resolveStoryAudioCrop({ story, start, end }) {
  if (!story?.audioFile) {
    throw httpError("Story audio is required for this clip.", 400);
  }

  const crop = cleanStoryAudioCrop({ start, end });
  const sourcePath = mediaFilePath(story.audioFile);
  try {
    await fs.access(sourcePath);
  } catch {
    throw httpError("Story audio file could not be found.", 404);
  }
  return { crop, sourcePath };
}

function monoPcm16Wav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(storyAudioSampleRate, 24);
  header.writeUInt32LE(storyAudioSampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
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
  await fs.writeFile(mediaFilePath(audioFile), audio);
  return audioFile;
}

export async function deleteAudioFile(audioFile) {
  const fileName = String(audioFile || "");
  if (!fileName || path.basename(fileName) !== fileName) return;

  try {
    await fs.unlink(mediaFilePath(fileName));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function deleteCardAudioFile(card) {
  const audioFile = String(card?.audioFile || "");
  const cardId = String(card?.id || "");
  if (!audioFile || !cardId || path.basename(audioFile) !== audioFile) return;
  if (!audioFile.startsWith(`${cardId}.`)) return;

  await deleteAudioFile(audioFile);
}

export async function saveUploadedStoryAudio({ storyId, originalName, mimeType, buffer, previousAudioFile }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw httpError("Audio file is required.", 400);
  }

  const extension = cleanUploadedAudioExtension(originalName, mimeType);
  const audioFile = `story-${storyId}.${randomUUID()}${extension}`;
  await fs.writeFile(mediaFilePath(audioFile), buffer);

  if (previousAudioFile && previousAudioFile !== audioFile) {
    await deleteAudioFile(previousAudioFile);
  }

  return audioFile;
}

export async function cropStoryAudio({ story, cardId, start, end }) {
  const { crop, sourcePath } = await resolveStoryAudioCrop({ story, start, end });
  const audioFile = `${cardId}.${randomUUID()}.wav`;
  const outputPath = mediaFilePath(audioFile);

  try {
    await runFfmpeg([
      "-y",
      ...storyAudioDecodeArgs(sourcePath, crop),
      outputPath
    ]);
  } catch (error) {
    await deleteAudioFile(audioFile);
    throw error;
  }

  return {
    audioFile,
    audioSource: "story-crop",
    storyAudioStart: crop.start,
    storyAudioEnd: crop.end
  };
}

export async function renderStoryAudioClip({ story, start, end, signal }) {
  const { crop, sourcePath } = await resolveStoryAudioCrop({ story, start, end });

  const pcm = await runFfmpeg(
    [
      ...storyAudioDecodeArgs(sourcePath, crop),
      "-f",
      "s16le",
      "pipe:1"
    ],
    { captureStdout: true, signal }
  );
  return monoPcm16Wav(pcm);
}
