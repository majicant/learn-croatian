import { Pause, Play, Scissors, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { formatAudioTime } from "./StoryAudioPlayer";

export type StoryAudioClip = {
  start: number;
  end: number;
};

type StoryClipHandle = "start" | "end";

type ActiveStoryClipDrag = {
  handle: StoryClipHandle;
  pointerId: number;
  offsetSeconds: number;
};

type StoryAudioBufferLoad = {
  key: string;
  controller: AbortController;
  promise: Promise<AudioBuffer>;
};

type StoryAudioClipValidation = {
  state: "empty" | "loading" | "valid" | "invalid";
  duration: number;
  error: string;
};

type StoryAudioClipEditorProps = {
  storyId: string;
  audioFile: string;
  value: StoryAudioClip | null;
  onChange: (value: StoryAudioClip | null) => void;
  duration: number;
  playhead: number;
  onPreviewStart?: () => void;
  previewStopRequest?: number;
  setError: (message: string) => void;
};

const MIN_STORY_CLIP_DURATION = 0.25;
const MAX_STORY_CLIP_DURATION = 90;
const DEFAULT_STORY_CLIP_DURATION = 5;

function roundedClipTime(value: number) {
  return Math.round(value * 100) / 100;
}

function flooredClipTime(value: number) {
  return Math.floor(value * 100) / 100;
}

function clamped(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(value, maximum));
}

function formatClipTime(value: number) {
  const hundredths = Math.max(0, Math.round(value * 100));
  const seconds = Math.floor(hundredths / 100);
  return `${formatAudioTime(seconds)}.${String(hundredths % 100).padStart(2, "0")}`;
}

export function validateStoryAudioClip(value: StoryAudioClip | null, audioDuration: number): StoryAudioClipValidation {
  if (!value) return { state: "empty", duration: 0, error: "" };
  if (!Number.isFinite(audioDuration) || audioDuration <= 0) {
    return { state: "loading", duration: value.end - value.start, error: "" };
  }

  const rawClipDuration = value.end - value.start;
  const clipDuration = roundedClipTime(rawClipDuration);
  if (!Number.isFinite(value.start) || !Number.isFinite(value.end)) {
    return { state: "invalid", duration: clipDuration, error: "Clip range is invalid." };
  }
  if (value.start < 0) {
    return { state: "invalid", duration: clipDuration, error: "Start must be at or after 0:00." };
  }
  if (rawClipDuration <= 0) {
    return { state: "invalid", duration: clipDuration, error: "End must be after start." };
  }
  if (rawClipDuration < MIN_STORY_CLIP_DURATION) {
    return { state: "invalid", duration: clipDuration, error: "Clip must be at least 0.25 seconds." };
  }
  if (rawClipDuration > MAX_STORY_CLIP_DURATION) {
    return { state: "invalid", duration: clipDuration, error: "Clip must be 90 seconds or shorter." };
  }
  if (value.end > audioDuration) {
    return { state: "invalid", duration: clipDuration, error: "Clip must stay inside the story audio." };
  }
  return { state: "valid", duration: clipDuration, error: "" };
}

function selectionWindowFor(value: StoryAudioClip, audioDuration: number) {
  const usableAudioDuration = flooredClipTime(audioDuration);
  const clipLength = clamped(value.end - value.start, 0, MAX_STORY_CLIP_DURATION);
  const windowLength = Math.min(
    usableAudioDuration,
    Math.max(15, Math.min(MAX_STORY_CLIP_DURATION, clipLength + 10))
  );
  const latestWindowStart = Math.max(0, usableAudioDuration - windowLength);
  let windowStart = clamped(value.start - 5, 0, latestWindowStart);
  if (value.end > windowStart + windowLength) {
    windowStart = clamped(value.end - windowLength, 0, latestWindowStart);
  }

  return {
    start: roundedClipTime(windowStart),
    end: flooredClipTime(Math.min(usableAudioDuration, windowStart + windowLength))
  };
}

export function StoryAudioClipEditor({
  storyId,
  audioFile,
  value,
  onChange,
  duration,
  playhead,
  onPreviewStart,
  previewStopRequest = 0,
  setError
}: StoryAudioClipEditorProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const decodedAudioRef = useRef<{ key: string; buffer: AudioBuffer } | null>(null);
  const audioBufferLoadRef = useRef<StoryAudioBufferLoad | null>(null);
  const clipPreviewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const previewGenerationRef = useRef(0);
  const clipRangeRef = useRef<HTMLDivElement | null>(null);
  const activeClipDragRef = useRef<ActiveStoryClipDrag | null>(null);
  const valueRef = useRef<StoryAudioClip | null>(value);
  const [audioClipWindow, setAudioClipWindow] = useState<StoryAudioClip | null>(null);
  const [previewingClip, setPreviewingClip] = useState(false);
  const audioClipWindowStart = audioClipWindow?.start ?? null;
  const audioClipWindowEnd = audioClipWindow?.end ?? null;
  const validation = validateStoryAudioClip(value, duration);
  const canChooseClip = duration >= MIN_STORY_CLIP_DURATION;
  const hasStoryClipEditor = Boolean(
    value &&
      audioClipWindowStart !== null &&
      audioClipWindowEnd !== null &&
      duration >= MIN_STORY_CLIP_DURATION
  );

  valueRef.current = value;

  useEffect(() => {
    stopClipPreview();
    activeClipDragRef.current = null;
    discardDecodedAudio();
    setAudioClipWindow(null);
  }, [audioFile]);

  useEffect(() => {
    if (!value || duration <= 0 || audioClipWindowStart !== null || audioClipWindowEnd !== null) return;
    setAudioClipWindow(selectionWindowFor(value, duration));
  }, [audioClipWindowEnd, audioClipWindowStart, duration, value]);

  useEffect(() => {
    stopClipPreview();
  }, [previewStopRequest]);

  useEffect(() => {
    if (value) return;
    activeClipDragRef.current = null;
    stopClipPreview();
    discardDecodedAudio();
  }, [Boolean(value)]);

  useEffect(() => {
    return () => {
      stopClipPreview(false);
      discardDecodedAudio();
      const audioContext = audioContextRef.current;
      audioContextRef.current = null;
      if (audioContext && audioContext.state !== "closed") void audioContext.close();
    };
  }, []);

  function commitClip(nextValue: StoryAudioClip | null) {
    valueRef.current = nextValue;
    onChange(nextValue);
  }

  function discardDecodedAudio() {
    audioBufferLoadRef.current?.controller.abort();
    audioBufferLoadRef.current = null;
    decodedAudioRef.current = null;
  }

  function getAudioContext() {
    const currentContext = audioContextRef.current;
    if (currentContext && currentContext.state !== "closed") return currentContext;

    const nextContext = new AudioContext();
    audioContextRef.current = nextContext;
    return nextContext;
  }

  function loadDecodedAudio(requestedClip: StoryAudioClip) {
    const previewKey = `${audioFile}:${requestedClip.start}:${requestedClip.end}`;
    const decodedAudio = decodedAudioRef.current;
    if (decodedAudio?.key === previewKey) return Promise.resolve(decodedAudio.buffer);

    const currentLoad = audioBufferLoadRef.current;
    if (currentLoad?.key === previewKey) return currentLoad.promise;
    currentLoad?.controller.abort();

    const controller = new AbortController();
    const audioContext = getAudioContext();
    const promise = (async () => {
      const query = new URLSearchParams({
        start: String(requestedClip.start),
        end: String(requestedClip.end)
      });
      const response = await fetch(`/api/texts/${encodeURIComponent(storyId)}/audio/clip-preview?${query}`, {
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Story audio preview request failed with ${response.status}.`);
      const encodedAudio = await response.arrayBuffer();
      return audioContext.decodeAudioData(encodedAudio);
    })();
    const load = { key: previewKey, controller, promise };
    audioBufferLoadRef.current = load;

    void promise.then(
      (buffer) => {
        if (audioBufferLoadRef.current !== load || controller.signal.aborted) return;
        decodedAudioRef.current = { key: previewKey, buffer };
        audioBufferLoadRef.current = null;
      },
      () => {
        if (audioBufferLoadRef.current === load) audioBufferLoadRef.current = null;
      }
    );
    return promise;
  }

  function stopClipPreview(updateState = true) {
    previewGenerationRef.current += 1;
    const source = clipPreviewSourceRef.current;
    clipPreviewSourceRef.current = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
      source.disconnect();
    }
    if (updateState) setPreviewingClip(false);
  }

  function clearStoryClip() {
    activeClipDragRef.current = null;
    setAudioClipWindow(null);
    stopClipPreview();
    discardDecodedAudio();
    commitClip(null);
  }

  function initialStoryClipRange() {
    const usableAudioDuration = flooredClipTime(duration);
    const clipLength = Math.min(DEFAULT_STORY_CLIP_DURATION, usableAudioDuration);
    const cleanPlayhead = clamped(roundedClipTime(playhead), 0, usableAudioDuration);
    const clipStart = roundedClipTime(Math.min(cleanPlayhead, Math.max(0, usableAudioDuration - clipLength)));
    const clipEnd = flooredClipTime(Math.min(usableAudioDuration, clipStart + clipLength));
    const window = selectionWindowFor({ start: clipStart, end: clipEnd }, duration);

    return { clip: { start: clipStart, end: clipEnd }, window };
  }

  function chooseStoryClip() {
    if (!canChooseClip) return;
    const { clip, window } = initialStoryClipRange();
    setAudioClipWindow(window);
    commitClip(clip);
    void previewStoryClip(clip);
  }

  function changeClipBoundary(handle: StoryClipHandle, requestedTime: number) {
    const currentValue = valueRef.current;
    if (
      !currentValue ||
      audioClipWindowStart === null ||
      audioClipWindowEnd === null
    ) {
      return;
    }

    stopClipPreview();
    if (handle === "start") {
      const nextStart = roundedClipTime(
        Math.max(audioClipWindowStart, Math.min(requestedTime, currentValue.end - MIN_STORY_CLIP_DURATION))
      );
      commitClip({ start: nextStart, end: currentValue.end });
      return;
    }

    const nextEnd = roundedClipTime(
      Math.min(audioClipWindowEnd, Math.max(requestedTime, currentValue.start + MIN_STORY_CLIP_DURATION))
    );
    commitClip({ start: currentValue.start, end: nextEnd });
  }

  function clipTimeFromClientX(clientX: number) {
    const range = clipRangeRef.current;
    if (!range || audioClipWindowStart === null || audioClipWindowEnd === null) return null;
    const bounds = range.getBoundingClientRect();
    if (bounds.width <= 0) return null;
    const ratio = (clientX - bounds.left) / bounds.width;
    return audioClipWindowStart + ratio * (audioClipWindowEnd - audioClipWindowStart);
  }

  function beginClipHandleDrag(handle: StoryClipHandle, event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const currentValue = valueRef.current;
    const pointerTime = clipTimeFromClientX(event.clientX);
    if (!currentValue || pointerTime === null) return;

    const boundaryTime = handle === "start" ? currentValue.start : currentValue.end;
    activeClipDragRef.current = {
      handle,
      pointerId: event.pointerId,
      offsetSeconds: boundaryTime - pointerTime
    };
    stopClipPreview();
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveActiveClipHandle(event: PointerEvent<HTMLDivElement>) {
    const drag = activeClipDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const pointerTime = clipTimeFromClientX(event.clientX);
    if (pointerTime !== null) changeClipBoundary(drag.handle, pointerTime + drag.offsetSeconds);
  }

  function finishActiveClipHandle(event: PointerEvent<HTMLDivElement>) {
    const drag = activeClipDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const pointerTime = clipTimeFromClientX(event.clientX);
    if (pointerTime !== null) changeClipBoundary(drag.handle, pointerTime + drag.offsetSeconds);
    activeClipDragRef.current = null;
    void previewStoryClip();
  }

  function cancelActiveClipHandle(pointerId: number) {
    if (activeClipDragRef.current?.pointerId === pointerId) {
      activeClipDragRef.current = null;
    }
  }

  function moveClipHandleFromKey(handle: StoryClipHandle, event: KeyboardEvent<HTMLButtonElement>) {
    const currentValue = valueRef.current;
    if (!currentValue || audioClipWindowStart === null || audioClipWindowEnd === null) return;

    let nextValue = handle === "start" ? currentValue.start : currentValue.end;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextValue -= 0.05;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") nextValue += 0.05;
    else if (event.key === "PageDown") nextValue -= 1;
    else if (event.key === "PageUp") nextValue += 1;
    else if (event.key === "Home") nextValue = audioClipWindowStart;
    else if (event.key === "End") nextValue = audioClipWindowEnd;
    else return;

    event.preventDefault();
    changeClipBoundary(handle, nextValue);
  }

  function previewClipAfterKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
    void previewStoryClip();
  }

  async function previewStoryClip(requestedClip = valueRef.current) {
    if (validateStoryAudioClip(requestedClip, duration).state !== "valid" || !requestedClip) return;
    stopClipPreview();
    const previewGeneration = previewGenerationRef.current;
    setError("");
    onPreviewStart?.();
    const clip: StoryAudioClip = requestedClip;
    setPreviewingClip(true);

    try {
      const audioContext = getAudioContext();
      const resumePromise = audioContext.state === "suspended" ? audioContext.resume() : Promise.resolve();
      const bufferPromise = loadDecodedAudio(clip);
      const [, buffer] = await Promise.all([resumePromise, bufferPromise]);
      if (previewGenerationRef.current !== previewGeneration) return;
      if (buffer.duration <= 0) throw new Error("The selected clip could not be decoded.");

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        if (clipPreviewSourceRef.current !== source) return;
        clipPreviewSourceRef.current = null;
        source.onended = null;
        source.disconnect();
        setPreviewingClip(false);
      };
      clipPreviewSourceRef.current = source;
      source.start(0, 0, buffer.duration);
    } catch (caught) {
      if (
        previewGenerationRef.current !== previewGeneration ||
        (caught instanceof DOMException && caught.name === "AbortError")
      ) {
        return;
      }
      stopClipPreview();
      setError("Could not decode or play this story audio clip.");
    }
  }

  const windowLength =
    audioClipWindowStart !== null && audioClipWindowEnd !== null
      ? audioClipWindowEnd - audioClipWindowStart
      : 0;
  const clipStartPosition =
    windowLength > 0 && value && audioClipWindowStart !== null
      ? clamped(((value.start - audioClipWindowStart) / windowLength) * 100, 0, 100)
      : 0;
  const clipEndPosition =
    windowLength > 0 && value && audioClipWindowStart !== null
      ? clamped(((value.end - audioClipWindowStart) / windowLength) * 100, 0, 100)
      : 100;

  return (
    <section className="story-clip-control" aria-label="Story audio clip">
      <div className="story-clip-head">
        <span>
          <Scissors size={16} aria-hidden="true" />
          Story audio clip
        </span>
        <span className="story-clip-playhead">Playhead <strong>{formatAudioTime(playhead)}</strong></span>
      </div>
      {!hasStoryClipEditor ? (
        <div className="story-clip-empty">
          {value && validation.state === "loading" ? (
            <p>Audio is still loading.</p>
          ) : (
            <>
              <button type="button" className="secondary story-clip-choose" disabled={!canChooseClip} onClick={chooseStoryClip}>
                <Scissors size={15} aria-hidden="true" />
                Choose clip from playhead
              </button>
              <p>{canChooseClip ? "Start at the current story position, then fine-tune both ends." : "Audio is still loading."}</p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="story-clip-window-label" aria-hidden="true">
            <span>{formatAudioTime(audioClipWindowStart as number)}</span>
            <span>Selection window</span>
            <span>{formatAudioTime(audioClipWindowEnd as number)}</span>
          </div>
          <div
            ref={clipRangeRef}
            className="story-clip-range"
            style={{
              "--clip-start": `${clipStartPosition}%`,
              "--clip-end": `${clipEndPosition}%`
            } as CSSProperties}
            onPointerMove={moveActiveClipHandle}
            onPointerUp={finishActiveClipHandle}
            onPointerCancel={(event) => cancelActiveClipHandle(event.pointerId)}
          >
            <button
              className="story-clip-handle story-clip-handle-start"
              type="button"
              role="slider"
              style={{ left: `${clipStartPosition}%` }}
              onPointerDown={(event) => beginClipHandleDrag("start", event)}
              onLostPointerCapture={(event) => cancelActiveClipHandle(event.pointerId)}
              onKeyDown={(event) => moveClipHandleFromKey("start", event)}
              onKeyUp={previewClipAfterKey}
              aria-label="Clip start"
              aria-valuemin={audioClipWindowStart as number}
              aria-valuemax={(value?.end as number) - MIN_STORY_CLIP_DURATION}
              aria-valuenow={value?.start as number}
              aria-valuetext={formatClipTime(value?.start as number)}
              aria-orientation="horizontal"
            >
              <span aria-hidden="true">S</span>
            </button>
            <button
              className="story-clip-handle story-clip-handle-end"
              type="button"
              role="slider"
              style={{ left: `${clipEndPosition}%` }}
              onPointerDown={(event) => beginClipHandleDrag("end", event)}
              onLostPointerCapture={(event) => cancelActiveClipHandle(event.pointerId)}
              onKeyDown={(event) => moveClipHandleFromKey("end", event)}
              onKeyUp={previewClipAfterKey}
              aria-label="Clip end"
              aria-valuemin={(value?.start as number) + MIN_STORY_CLIP_DURATION}
              aria-valuemax={audioClipWindowEnd as number}
              aria-valuenow={value?.end as number}
              aria-valuetext={formatClipTime(value?.end as number)}
              aria-orientation="horizontal"
            >
              <span aria-hidden="true">E</span>
            </button>
          </div>
          <p className="story-clip-help">Drag S or E. Release to hear the selection.</p>
          <div className={`story-clip-summary ${validation.state === "valid" ? "selected" : ""}`} aria-live="polite">
            <span>
              Start <strong>{formatClipTime(value?.start as number)}</strong>
            </span>
            <span>
              End <strong>{formatClipTime(value?.end as number)}</strong>
            </span>
            <span>
              Length <strong>{formatClipTime(validation.duration)}</strong>
            </span>
          </div>
          <div className="story-clip-actions">
            <button type="button" className="secondary" disabled={!canChooseClip} onClick={chooseStoryClip}>
              Reset here
            </button>
            <button
              type="button"
              className="secondary"
              disabled={validation.state !== "valid"}
              onClick={previewingClip ? () => stopClipPreview() : () => void previewStoryClip()}
            >
              {previewingClip ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
              {previewingClip ? "Stop" : "Replay"}
            </button>
            <button type="button" className="secondary" onClick={clearStoryClip}>
              <X size={14} aria-hidden="true" />
              Clear
            </button>
          </div>
        </>
      )}
      {validation.error && <p className="field-error">{validation.error}</p>}
    </section>
  );
}
