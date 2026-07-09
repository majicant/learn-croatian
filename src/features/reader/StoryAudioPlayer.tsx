import { FastForward, Pause, Play, Rewind, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, PointerEvent } from "react";

type StoryAudioPlayerProps = {
  audioFile: string;
  title: string;
  setError: (message: string) => void;
};

const playbackRates = [1, 0.9, 0.75, 0.5];

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";

  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = String(rounded % 60).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${remainingSeconds}`;
  }

  return `${minutes}:${remainingSeconds}`;
}

function finiteDuration(audio: HTMLAudioElement, fallback: number) {
  return Number.isFinite(audio.duration) ? audio.duration : fallback;
}

export function StoryAudioPlayer({ audioFile, title, setError }: StoryAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const source = `/media/${encodeURIComponent(audioFile)}`;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    audio.pause();
    audio.currentTime = 0;
  }, [audioFile]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const audioElement: HTMLAudioElement = audio;

    function updateDuration() {
      setDuration(finiteDuration(audioElement, 0));
    }

    function updateTime() {
      setCurrentTime(audioElement.currentTime || 0);
    }

    function handleError() {
      setIsPlaying(false);
      setError("Could not play this story's audio file.");
    }

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);

    audioElement.addEventListener("loadedmetadata", updateDuration);
    audioElement.addEventListener("durationchange", updateDuration);
    audioElement.addEventListener("canplay", updateDuration);
    audioElement.addEventListener("timeupdate", updateTime);
    audioElement.addEventListener("play", handlePlay);
    audioElement.addEventListener("pause", handlePause);
    audioElement.addEventListener("ended", handleEnded);
    audioElement.addEventListener("error", handleError);
    updateDuration();
    updateTime();

    return () => {
      audioElement.removeEventListener("loadedmetadata", updateDuration);
      audioElement.removeEventListener("durationchange", updateDuration);
      audioElement.removeEventListener("canplay", updateDuration);
      audioElement.removeEventListener("timeupdate", updateTime);
      audioElement.removeEventListener("play", handlePlay);
      audioElement.removeEventListener("pause", handlePause);
      audioElement.removeEventListener("ended", handleEnded);
      audioElement.removeEventListener("error", handleError);
    };
  }, [audioFile, setError]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      return;
    }

    try {
      await audio.play();
    } catch {
      setIsPlaying(false);
      setError("Could not play this story's audio file.");
    }
  }

  function skipBy(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;

    const max = finiteDuration(audio, duration);
    const nextTime = Math.max(0, Math.min(audio.currentTime + seconds, max || audio.currentTime + seconds));
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function seekTo(nextTime: number) {
    const audio = audioRef.current;
    if (!audio) return;

    const max = finiteDuration(audio, duration);
    const cleanTime = Math.max(0, Math.min(nextTime, max || nextTime));
    audio.currentTime = cleanTime;
    setCurrentTime(cleanTime);
  }

  function seek(event: ChangeEvent<HTMLInputElement>) {
    seekTo(Number(event.currentTarget.value));
  }

  function seekFromPointer(event: PointerEvent<HTMLInputElement>) {
    if (!duration) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    seekTo(ratio * duration);
  }

  function cyclePlaybackRate() {
    const currentIndex = playbackRates.indexOf(playbackRate);
    const nextRate = playbackRates[(currentIndex + 1) % playbackRates.length];
    setPlaybackRate(nextRate);
  }

  return (
    <section className="story-audio-player" aria-label="Story audio player">
      <audio ref={audioRef} src={source} preload="metadata" aria-label={`${title} audio`} />
      <div className="story-audio-head">
        <Volume2 size={17} aria-hidden="true" />
        <span>Story audio</span>
      </div>
      <div className="audio-timeline">
        <span>{formatTime(currentTime)}</span>
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.01"
          value={Math.min(currentTime, duration || 0)}
          onChange={seek}
          onInput={seek}
          onPointerDown={seekFromPointer}
          disabled={!duration}
          aria-label="Audio progress"
          style={{ "--progress": `${progress}%` } as CSSProperties}
        />
        <span>{formatTime(duration)}</span>
        <button
          className="audio-rate-button"
          type="button"
          onClick={cyclePlaybackRate}
          aria-label={`Playback speed ${playbackRate}x. Change speed.`}
          title={`Playback speed: ${playbackRate}x`}
        >
          {playbackRate}x
        </button>
      </div>
      <div className="story-audio-controls">
        <button
          className="audio-skip-button"
          type="button"
          onClick={() => skipBy(-10)}
          aria-label="Back 10 seconds"
          title="Back 10 seconds"
        >
          <Rewind size={19} aria-hidden="true" />
        </button>
        <button
          className="audio-play-toggle"
          type="button"
          onClick={() => void togglePlayback()}
          aria-label={isPlaying ? "Pause audio" : "Play audio"}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={22} aria-hidden="true" /> : <Play size={22} aria-hidden="true" />}
        </button>
        <button
          className="audio-skip-button"
          type="button"
          onClick={() => skipBy(10)}
          aria-label="Forward 10 seconds"
          title="Forward 10 seconds"
        >
          <FastForward size={19} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
