import { CasinoFlow } from '../../features/casino-entry/ui/casino-flow';
import { CasinoConnection } from '../../features/casino-entry/ui/connection';
import { EntranceSound } from '../../features/casino-entry/ui/sound';

const params = new URLSearchParams(location.search);
const connection = new CasinoConnection(params.get('room') ?? 'salon');
const audio = new EntranceSound();

export default function CasinoEntryPreview() {
  return <CasinoFlow connection={connection} audio={audio} />;
}
