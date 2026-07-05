import { FilePlus2, Upload } from "lucide-react";
import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { apiJson } from "../../api/client";
import { READING_LEVELS } from "../../constants";
import { splitPreview } from "../../domain/stories";

type ImportProps = {
  onImported: (storyId: string) => Promise<void>;
  setError: (message: string) => void;
};

export function ImportView({ onImported, setError }: ImportProps) {
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState("A2");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const preview = useMemo(() => splitPreview(text), [text]);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ""));
    reader.readAsText(file);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = await apiJson<{ storyId: string }>("/api/texts/import", {
        method: "POST",
        body: JSON.stringify({ title, level, text })
      });
      setTitle("");
      setText("");
      await onImported(payload.storyId);
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
          </div>
          <label className="file-input">
            <Upload size={16} aria-hidden="true" />
            Upload .txt
            <input type="file" accept=".txt,text/plain" onChange={handleFile} />
          </label>
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
