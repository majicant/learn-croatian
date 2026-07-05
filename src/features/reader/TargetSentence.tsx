import { targetParts } from "../../domain/stories";

type TargetSentenceProps = {
  sentence: string;
  target: string;
};

export function TargetSentence({ sentence, target }: TargetSentenceProps) {
  const parts = targetParts(sentence, target);
  if (!parts.target) return <p>{sentence}</p>;
  return (
    <p>
      {parts.before}
      <span className="target-mark">[...]</span>
      {parts.after}
    </p>
  );
}
