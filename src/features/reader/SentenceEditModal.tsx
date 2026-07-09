import { Save, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Sentence } from "../../types";

type SentenceEditModalProps = {
  sentence: Sentence;
  onClose: () => void;
  onSave: (sentence: Sentence, croatian: string) => Promise<void>;
  onDelete: (sentence: Sentence) => Promise<void>;
};

function cleanSentenceText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function SentenceEditModal({ sentence, onClose, onSave, onDelete }: SentenceEditModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState(sentence.croatian);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(sentence.croatian);
    setSaving(false);
  }, [sentence]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [sentence.id]);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, saving]);

  async function saveSentence() {
    const croatian = cleanSentenceText(draft);
    if (!croatian || saving) return;

    setSaving(true);
    try {
      await onSave(sentence, croatian);
    } finally {
      setSaving(false);
    }
  }

  async function deleteSentence() {
    if (saving) return;

    setSaving(true);
    try {
      await onDelete(sentence);
    } finally {
      setSaving(false);
    }
  }

  const cleanDraft = cleanSentenceText(draft);
  const textChanged = cleanDraft !== sentence.croatian;
  const canSave = Boolean(cleanDraft && !saving);

  const modal = (
    <div
      className="card-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section className="card-modal sentence-edit-modal" role="dialog" aria-modal="true" aria-labelledby="sentence-edit-title">
        <div className="card-modal-head">
          <div>
            <div className="card-modal-kicker">
              <span className="pill">{sentence.id.toUpperCase()}</span>
              {sentence.analysis && <span className={`sync-pill ${textChanged ? "stale" : ""}`}>{textChanged ? "Analysis reset" : "Analysis"}</span>}
              {sentence.hasCards && (
                <span className="sync-pill">
                  {sentence.cardCount} {sentence.cardCount === 1 ? "card" : "cards"}
                </span>
              )}
            </div>
            <h2 id="sentence-edit-title">Edit sentence</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={saving}
            title="Close editor"
            aria-label="Close editor"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form
          className="card-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveSentence();
          }}
        >
          <label>
            Croatian sentence
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={Math.min(6, Math.max(3, Math.ceil(draft.length / 74)))}
              aria-invalid={!cleanDraft || undefined}
            />
          </label>
          {!cleanDraft && <p className="field-error">Sentence text is required.</p>}

          <div className="button-row card-edit-actions sentence-edit-actions">
            <button type="submit" disabled={!canSave}>
              <Save size={16} aria-hidden="true" />
              {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" className="secondary" onClick={onClose} disabled={saving}>
              <X size={16} aria-hidden="true" />
              Cancel
            </button>
            <button type="button" className="danger" onClick={() => void deleteSentence()} disabled={saving}>
              <Trash2 size={16} aria-hidden="true" />
              Delete
            </button>
          </div>
        </form>
      </section>
    </div>
  );

  return createPortal(modal, document.body);
}
