import { Check, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Sentence } from "../../types";

type SentenceEditModalProps = {
  sentence: Sentence;
  onClose: () => void;
  onSave: (sentence: Sentence, croatian: string) => void;
  onDelete: (sentence: Sentence) => void;
};

function cleanSentenceText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function SentenceEditModal({ sentence, onClose, onSave, onDelete }: SentenceEditModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState(sentence.croatian);

  useEffect(() => {
    setDraft(sentence.croatian);
  }, [sentence]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [sentence.id]);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  function saveSentence() {
    const croatian = cleanSentenceText(draft);
    if (!croatian) return;

    onSave(sentence, croatian);
  }

  function deleteSentence() {
    onDelete(sentence);
  }

  const cleanDraft = cleanSentenceText(draft);
  const textChanged = cleanDraft !== sentence.croatian;
  const canConfirm = Boolean(cleanDraft);

  const modal = (
    <div
      className="card-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
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
            saveSentence();
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
            <button type="button" className="danger" onClick={deleteSentence}>
              <Trash2 size={16} aria-hidden="true" />
              Delete
            </button>
            <div className="sentence-confirm-actions">
              <button type="button" className="secondary" onClick={onClose}>
                <X size={16} aria-hidden="true" />
                Cancel
              </button>
              <button type="submit" disabled={!canConfirm}>
                <Check size={16} aria-hidden="true" />
                Okay
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );

  return createPortal(modal, document.body);
}
