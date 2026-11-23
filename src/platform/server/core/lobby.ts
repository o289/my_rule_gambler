import { MIN_PLAYERS } from '../../../shared/contracts/casino-entry';
import type { LobbyState, Seat } from '../../../shared/contracts/casino-entry';

export interface LobbyParticipant {
  id: string;
  name: string;
  slot: number;
  ready: boolean;
  online: boolean;
}

export function updateLobbyReady<T extends { id: string; ready: boolean }>(
  participants: readonly T[],
  playerId: string,
  ready: boolean,
  started: boolean,
): T[] | null {
  if (started) return null;
  const index = participants.findIndex(participant => participant.id === playerId);
  if (index < 0 || participants[index]?.ready === ready) return null;
  const next = [...participants];
  next[index] = { ...next[index]!, ready };
  return next;
}

export interface LobbyCountdownState {
  startAt: number | null;
  generation: number;
  startedPlayers: readonly Seat[] | null;
}

export function initialLobbyCountdownState(): LobbyCountdownState {
  return { startAt: null, generation: 0, startedPlayers: null };
}

export function isLobbyEligible(participants: readonly LobbyParticipant[], minimum = MIN_PLAYERS) {
  const online = participants.filter(participant => participant.online);
  return online.length >= minimum && online.every(participant => participant.ready);
}

export function freezeStartedPlayers(participants: readonly LobbyParticipant[]): Seat[] | null {
  if (!isLobbyEligible(participants)) return null;
  return [...participants]
    .filter(participant => participant.online)
    .sort((left, right) => left.slot - right.slot)
    .map(({ id, name, slot, ready, online }) => ({ id, name, slot, ready, online }));
}

export function scheduleLobbyCountdown(
  state: LobbyCountdownState,
  participants: readonly LobbyParticipant[],
  now: number,
  durationMs: number,
): LobbyCountdownState {
  if (state.startedPlayers !== null || state.startAt !== null || !isLobbyEligible(participants)) return state;
  return { ...state, startAt: now + durationMs, generation: state.generation + 1 };
}

export function cancelLobbyCountdown(state: LobbyCountdownState): LobbyCountdownState {
  return state.startAt === null ? state : { ...state, startAt: null, generation: state.generation + 1 };
}

export type LobbyCountdownResolution =
  | { status: 'stale'; state: LobbyCountdownState }
  | { status: 'early'; state: LobbyCountdownState; remainingMs: number }
  | { status: 'waiting'; state: LobbyCountdownState }
  | { status: 'started'; state: LobbyCountdownState };

export function resolveLobbyCountdown(
  state: LobbyCountdownState,
  participants: readonly LobbyParticipant[],
  generation: number,
  now: number,
): LobbyCountdownResolution {
  if (state.startAt === null || state.generation !== generation) return { status: 'stale', state };
  if (now < state.startAt) return { status: 'early', state, remainingMs: state.startAt - now };
  const startedPlayers = freezeStartedPlayers(participants);
  if (!startedPlayers) return { status: 'waiting', state: { ...state, startAt: null, generation: state.generation + 1 } };
  return {
    status: 'started',
    state: { ...state, startAt: null, generation: state.generation + 1, startedPlayers },
  };
}

export function createLobbyState(
  participants: readonly LobbyParticipant[],
  countdown: LobbyCountdownState,
  serverTime: number,
): LobbyState {
  const seats = participants.map(({ id, name, slot, ready, online }) => ({ id, name, slot, ready, online }));
  const started = countdown.startedPlayers !== null;
  const phase = started ? 'started' : countdown.startAt !== null ? 'countdown' : 'waiting';
  return {
    seats,
    startedPlayers: countdown.startedPlayers?.map(seat => ({ ...seat })) ?? null,
    phase,
    hostId: seats.find(seat => seat.online)?.id ?? null,
    startAt: started ? null : countdown.startAt,
    serverTime,
  };
}
