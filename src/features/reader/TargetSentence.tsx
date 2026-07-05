import { targetParts } from "../../domain/stories";

type TargetSentenceProps = {
  sentence: string;
  target: string;
  targetStart?: number;
  targetEnd?: number;
};

export function TargetSentence({ sentence, target, targetStart, targetEnd }: TargetSentenceProps) {
  const parts = targetParts(sentence, target, targetStart, targetEnd);
  if (!parts.target) return <p>{sentence}</p>;
  return (
    <p>
      {parts.before}
      <span className="target-mark">[...]</span>
      {parts.after}
    </p>
  );
}
