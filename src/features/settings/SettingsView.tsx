import { Library, RefreshCw, Save } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiJson } from "../../api/client";
import type { SettingsState } from "../../types";

type SettingsProps = {
  settings: SettingsState;
  reloadSettings: () => Promise<void>;
  setError: (message: string) => void;
};

export function SettingsView({ settings, reloadSettings, setError }: SettingsProps) {
  const [draft, setDraft] = useState<SettingsState>(settings);
  const [decks, setDecks] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [loadingDecks, setLoadingDecks] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const deckOptions = useMemo(() => Array.from(new Set([draft.deckName, ...decks].filter(Boolean))), [decks, draft.deckName]);

  useEffect(() => setDraft(settings), [settings]);

  async function testConnection() {
    setTesting(true);
    setMessage("");
    setError("");
    try {
      const payload = await apiJson<{ version: number }>("/api/anki/test", {
        method: "POST",
        body: JSON.stringify({ ankiUrl: draft.ankiUrl })
      });
      setMessage(`Connected to AnkiConnect v${payload.version}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connection failed.");
    } finally {
      setTesting(false);
    }
  }

  async function loadDecks() {
    setLoadingDecks(true);
    setMessage("");
    setError("");
    try {
      const payload = await apiJson<{ decks: string[] }>("/api/anki/decks", {
        method: "POST",
        body: JSON.stringify({ ankiUrl: draft.ankiUrl })
      });
      setDecks(payload.decks);
      setMessage(`Found ${payload.decks.length} decks.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load decks.");
    } finally {
      setLoadingDecks(false);
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await apiJson("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(draft)
      });
      await reloadSettings();
      setMessage("Settings saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Settings save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="settings-view">
      <section className="settings-panel">
        <div className="cards-toolbar">
          <div>
            <h1>Settings</h1>
            <p>Anki sync and card defaults</p>
          </div>
        </div>

        {message && <p className="success-line">{message}</p>}

        <form className="settings-form" onSubmit={(event) => void saveSettings(event)}>
          <label>
            AnkiConnect URL
            <input value={draft.ankiUrl} onChange={(event) => setDraft({ ...draft, ankiUrl: event.target.value })} />
          </label>

          <div className="button-row">
            <button type="button" className="secondary" onClick={() => void testConnection()} disabled={testing}>
              <RefreshCw size={16} aria-hidden="true" />
              {testing ? "Testing..." : "Test connection"}
            </button>
            <button type="button" className="secondary" onClick={() => void loadDecks()} disabled={loadingDecks}>
              <Library size={16} aria-hidden="true" />
              {loadingDecks ? "Loading..." : "Load decks"}
            </button>
          </div>

          <label>
            Deck
            <select
              value={draft.deckName}
              onChange={(event) => event.target.value && setDraft({ ...draft, deckName: event.target.value })}
            >
              {deckOptions.map((deck) => (
                <option key={deck} value={deck}>
                  {deck}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" disabled={saving}>
            <Save size={16} aria-hidden="true" />
            {saving ? "Saving..." : "Save settings"}
          </button>
        </form>
      </section>
    </main>
  );
}
