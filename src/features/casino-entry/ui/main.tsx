import { CasinoFlow } from './casino-flow';
import { CasinoConnection } from './connection';
import { EntranceSound } from './sound';

const params = new URLSearchParams(location.search);
const connection = new CasinoConnection(params.get('room') ?? 'salon');
const audio = new EntranceSound();

export default function CasinoEntryPreview() {
  return <CasinoFlow connection={connection} audio={audio} />;
}
