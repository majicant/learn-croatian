import { FileAudio, FilePlus2, Upload, X } from "lucide-react";
import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { apiJson } from "../../api/client";
import { READING_LEVELS } from "../../constants";
import { folderPickerOptions, splitPreview } from "../../domain/stories";
import type { StoryFolder } from "../../types";

type ImportProps = {
  storyFolders: StoryFolder[];
  onImported: (storyId: string) => Promise<void>;
  setError: (message: string) => void;
};

export function ImportView({ storyFolders, onImported, setError }: ImportProps) {
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState("A2");
  const [folderId, setFolderId] = useState("");
  const [text, setText] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioInputKey, setAudioInputKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const preview = useMemo(() => splitPreview(text), [text]);
  const folderOptions = useMemo(() => folderPickerOptions(storyFolders), [storyFolders]);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ""));
    reader.readAsText(file);
  }

  function handleAudioFile(event: ChangeEvent<HTMLInputElement>) {
    setAudioFile(event.target.files?.[0] || null);
  }

  function clearAudioFile() {
    setAudioFile(null);
    setAudioInputKey((current) => current + 1);
  }

  async function uploadStoryAudio(storyId: string, file: File) {
    const contentType = file.type.startsWith("audio/") ? file.type : "application/octet-stream";
    const response = await fetch(`/api/texts/${encodeURIComponent(storyId)}/audio`, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "X-File-Name": encodeURIComponent(file.name)
      },
      body: file
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      throw new Error(payload?.error || `Audio upload failed with ${response.status}.`);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = await apiJson<{ storyId: string }>("/api/texts/import", {
        method: "POST",
        body: JSON.stringify({ title, level, folderId, text })
      });
      let audioUploadError = "";
      if (audioFile) {
        try {
          await uploadStoryAudio(payload.storyId, audioFile);
        } catch (caught) {
          audioUploadError = caught instanceof Error ? caught.message : "Audio upload failed.";
        }
      }
      setTitle("");
      setText("");
      setAudioFile(null);
      setAudioInputKey((current) => current + 1);
      await onImported(payload.storyId);
      if (audioUploadError) {
        setError(`Story saved, but audio upload failed: ${audioUploadError}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="import-view">
      <section className="import-form">
        <h1>Import story</h1>
        <form onSubmit={(event) => void submit(event)}>
          <div className="field-grid">
            <label>
              Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Priča iz Splita" />
            </label>
            <label>
              Level
              <select value={level} onChange={(event) => setLevel(event.target.value)}>
                {READING_LEVELS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Folder
              <select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
                <option value="">Unfiled</option>
                {folderOptions.map(({ folder, label }) => (
                  <option key={folder.id} value={folder.id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="upload-row">
            <label className="file-input">
              <Upload size={16} aria-hidden="true" />
              Upload .txt
              <input type="file" accept=".txt,text/plain" onChange={handleFile} />
            </label>
            <label className={`file-input ${audioFile ? "selected" : ""}`}>
              <FileAudio size={16} aria-hidden="true" />
              {audioFile ? "Change audio" : "Upload audio"}
              <input
                key={audioInputKey}
                type="file"
                accept="audio/*,.mp3,.m4a,.wav,.ogg,.oga,.webm,.flac,.aac"
                onChange={handleAudioFile}
              />
            </label>
          </div>
          {audioFile && (
            <div className="selected-audio-file">
              <span>
                <FileAudio size={16} aria-hidden="true" />
                {audioFile.name}
              </span>
              <button className="icon-button" type="button" onClick={clearAudioFile} aria-label="Remove audio file" title="Remove audio">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          <label>
            Croatian text
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={14} />
          </label>
          <button type="submit" disabled={saving}>
            <FilePlus2 size={16} aria-hidden="true" />
            {saving ? "Saving..." : "Save story"}
          </button>
        </form>
      </section>

      <aside className="preview-panel">
        <div className="panel-heading">
          <h2>Preview</h2>
          <span>
            {preview.paragraphs.length} paragraphs / {preview.sentenceCount} sentences
          </span>
        </div>
        {preview.paragraphs.length === 0 && <p className="muted">Paste text to preview paragraph and sentence splitting.</p>}
        {preview.paragraphs.slice(0, 4).map((paragraph, index) => (
          <div className="preview-paragraph" key={index}>
            <span>Paragraph {index + 1}</span>
            {paragraph.map((sentence, sentenceIndex) => (
              <p key={`${sentence}-${sentenceIndex}`}>{sentence}</p>
            ))}
          </div>
        ))}
      </aside>
    </main>
  );
}
