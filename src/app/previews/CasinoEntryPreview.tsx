import { useState } from 'react';
import { CasinoFlow } from '../../features/casino-entry/ui/casino-flow';
import { CasinoConnection } from '../../features/casino-entry/ui/connection';
import { EntranceSound } from '../../features/casino-entry/ui/sound';

const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
const connection = new CasinoConnection(`${scheme}//${location.host}/casino-ws`);
const audio = new EntranceSound();

export default function CasinoEntryPreview() {
  const [invitedRoom, setInvitedRoom] = useState(() => new URLSearchParams(location.search).get('room') ?? undefined);

  function roomChanged(roomId: string | null) {
    const url = new URL(location.href);
    if (roomId) url.searchParams.set('room', roomId);
    else url.searchParams.delete('room');
    if (url.href !== location.href) history.replaceState(history.state, '', url);
    setInvitedRoom(roomId ?? undefined);
  }

  return <CasinoFlow connection={connection} audio={audio} invitedRoom={invitedRoom} onRoomChanged={roomChanged} />;
}
