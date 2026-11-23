import type { CasinoRoomInfo } from '../../../shared/contracts/casino-entry';
import { Room, PREVIEW_ROOM_PREFIX } from './room';
import type { RoomRuntime } from './ports';

export const MAX_ROOMS = 24;
export const NORMAL_ROOM_ID = /^[a-f0-9]{8}$/;

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private disposed = false;

  constructor(private readonly runtime: RoomRuntime, private readonly countdownMs?: number) {}

  get size() { return this.rooms.size; }
  count(mode: 'standard' | 'preview') {
    let count = 0;
    for (const room of this.rooms.values()) if (room.mode === mode) count += 1;
    return count;
  }
  canCreate(mode: 'standard' | 'preview') { return !this.disposed && this.count(mode) < MAX_ROOMS; }
  get(id: string) { return this.rooms.get(id); }
  getPreview(name: string) {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'salon';
    return this.rooms.get(`${PREVIEW_ROOM_PREFIX}${safeName}`);
  }
  values() { return this.rooms.values(); }

  create(info: CasinoRoomInfo) {
    if (!this.canCreate('standard') || !NORMAL_ROOM_ID.test(info.id) || this.rooms.has(info.id)) return null;
    const room = new Room(info, this.runtime, { mode: 'standard', countdownMs: this.countdownMs });
    this.rooms.set(info.id, room);
    return room;
  }

  createPreview(name: string) {
    if (this.disposed) return null;
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'salon';
    const id = `${PREVIEW_ROOM_PREFIX}${safeName}`;
    let room = this.rooms.get(id);
    if (!room) {
      if (!this.canCreate('preview')) return null;
      room = new Room({ id, name: 'プレビュー卓' }, this.runtime, { mode: 'preview', countdownMs: this.countdownMs });
      this.rooms.set(id, room);
    }
    return room;
  }

  prune(now: number) {
    for (const [id, room] of this.rooms) {
      if (room.prune(now)) {
        room.dispose();
        this.rooms.delete(id);
      }
    }
  }

  deleteIfEmpty(id: string) {
    const room = this.rooms.get(id);
    if (!room?.empty) return;
    room.dispose();
    this.rooms.delete(id);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
  }
}
