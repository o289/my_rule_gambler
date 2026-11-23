export interface SeatedParticipant { slot: number }

export function availableSeatSlot(participants: readonly SeatedParticipant[], limit: number) {
  const occupied = new Set(participants.map(participant => participant.slot));
  for (let slot = 0; slot < limit; slot += 1) if (!occupied.has(slot)) return slot;
  return null;
}

export function reconnectGraceExpired(leftAt: number | null, now: number, graceMs: number) {
  return leftAt !== null && now - leftAt >= graceMs;
}

export function roomGraceExpired(lastOccupiedAt: number, now: number, graceMs: number) {
  return now - lastOccupiedAt >= graceMs;
}
