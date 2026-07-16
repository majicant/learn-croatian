import { Check, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type StoryTextEditModalProps = {
  storyTitle: string;
  text: string;
  onClose: () => void;
  onDirtyChange: (isDirty: boolean) => void;
  onSave: (text: string) => void;
};

export function StoryTextEditModal({
  storyTitle,
  text,
  onClose,
  onDirtyChange,
  onSave
}: StoryTextEditModalProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const onCloseRef = useRef(onClose);
  const [draft, setDraft] = useState(text);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setDraft(text);
  }, [text]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    function handleDialogKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []
      ).filter((element) => !element.hidden);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleDialogKeyDown);
      returnFocusTo?.focus();
    };
  }, []);

  const cleanDraft = draft.trim();
  const paragraphCount = useMemo(() => {
    if (!cleanDraft) return 0;
    return cleanDraft.replace(/\r\n/g, "\n").split(/\n\s*\n/g).filter((paragraph) => paragraph.trim()).length;
  }, [cleanDraft]);
  const textChanged = draft !== text;

  useEffect(() => {
    onDirtyChange(textChanged);
    return () => onDirtyChange(false);
  }, [onDirtyChange, textChanged]);

  const modal = (
    <div
      className="card-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="card-modal story-text-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-text-edit-title"
      >
        <div className="card-modal-head">
          <div>
            <div className="card-modal-kicker">
              <span className="pill">Full story</span>
              <span className="sync-pill">
                {paragraphCount} {paragraphCount === 1 ? "paragraph" : "paragraphs"}
              </span>
              {textChanged && <span className="sync-pill stale">Edited</span>}
            </div>
            <h2 id="story-text-edit-title">Edit story text</h2>
            <p>{storyTitle}</p>
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
            if (cleanDraft) onSave(draft);
          }}
        >
          <label>
            Croatian story
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={18}
              lang="hr"
              spellCheck
              required
              aria-describedby={cleanDraft ? "story-text-edit-hint" : "story-text-edit-hint story-text-edit-error"}
              aria-errormessage={!cleanDraft ? "story-text-edit-error" : undefined}
              aria-invalid={!cleanDraft || undefined}
            />
          </label>
          <p className="story-text-edit-hint" id="story-text-edit-hint">
            Use a blank line between paragraphs. Okay stages these changes; Save applies them to the story.
          </p>
          {!cleanDraft && (
            <p className="field-error" id="story-text-edit-error" role="alert">
              Story text is required.
            </p>
          )}

          <div className="button-row card-edit-actions story-text-edit-actions">
            <button type="button" className="secondary" onClick={onClose}>
              <X size={16} aria-hidden="true" />
              Cancel
            </button>
            <button type="submit" disabled={!cleanDraft}>
              <Check size={16} aria-hidden="true" />
              Okay
            </button>
          </div>
        </form>
      </section>
    </div>
  );

  return createPortal(modal, document.body);
}
