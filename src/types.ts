export type View = "read" | "import" | "cards" | "settings";
export type CardType = "basic" | "cloze";
export type SyncStatus = "pending" | "synced" | "error";

export type Analysis = {
  english: string;
  notes: string[];
};

export type Sentence = {
  id: string;
  croatian: string;
  analysis?: Analysis;
  hasCards?: boolean;
  cardCount?: number;
};

export type Paragraph = {
  id: string;
  sentences: Sentence[];
};

export type Story = {
  id: string;
  title: string;
  level: string;
  paragraphs: Paragraph[];
};

export type StorySummary = {
  id: string;
  title: string;
  level: string;
  completed: boolean;
};

export type MinedCard = {
  id: string;
  type: CardType;
  storyId: string;
  sentenceId: string;
  croatianSentence: string;
  targetText?: string;
  englishTranslation: string;
  hint?: string;
  note?: string;
  audioFile?: string | null;
  syncStatus: SyncStatus;
  syncError?: string | null;
};

export type SettingsState = {
  ankiUrl: string;
  deckName: string;
};

export type ImportPreview = {
  paragraphs: string[][];
  sentenceCount: number;
};
