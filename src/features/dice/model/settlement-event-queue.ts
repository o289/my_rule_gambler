import type { MatchSettlementEvent } from '../../../shared/contracts/dice';

function key(event: MatchSettlementEvent) {
  return `${event.boardSeed}:${event.revision}`;
}

export class SettlementEventQueue {
  private pending: MatchSettlementEvent[] = [];
  private seen = new Set<string>();

  getSnapshot = () => this.pending;

  enqueue(event: MatchSettlementEvent) {
    const id = key(event);
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.pending = [...this.pending, event];
    return true;
  }

  complete(event: MatchSettlementEvent) {
    const current = this.pending[0];
    if (!current || key(current) !== key(event)) return false;
    this.pending = this.pending.slice(1);
    return true;
  }

  clearPending() {
    this.pending = [];
  }
}
