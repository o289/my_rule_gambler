import './turn-highlight.css';

export function CurrentTurnHighlight({ once = false }: { once?: boolean }) {
  return <span className="turn-highlight" data-once={once || undefined} aria-hidden="true"><i /></span>;
}
