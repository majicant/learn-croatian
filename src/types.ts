export type View = "read" | "import" | "cards" | "settings";
export type CardType = "basic" | "cloze";
type SyncStatus = "pending" | "synced" | "error";

export type SuggestedCard = {
  croatian: string;
  english: string;
};

export type Analysis = {
  english: string;
  notes: string[];
  suggestedCards: SuggestedCard[];
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
  folderId: string;
  audioFile?: string | null;
  paragraphs: Paragraph[];
};

export type StorySummary = {
  id: string;
  title: string;
  level: string;
  folderId: string;
  hasAudio?: boolean;
  completed: boolean;
};

export type StoryFolder = {
  id: string;
  name: string;
  parentId: string;
};

export type MinedCard = {
  id: string;
  type: CardType;
  storyId: string;
  sentenceId: string;
  croatianSentence: string;
  targetText?: string;
  targetStart?: number;
  targetEnd?: number;
  englishTranslation: string;
  hint?: string;
  note?: string;
  audioFile?: string | null;
  createAudioOnlyCard?: boolean;
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
