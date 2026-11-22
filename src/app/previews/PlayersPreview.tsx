import { StrictMode } from 'react';
import PlayersScreen from '../../features/players/ui/main';
import { SAMPLE_BOARD } from '../../dev/preview-data/sample-board';
import { DEMO_PLAYERS } from '../../dev/preview-data/players-demo';
import { PlayerInfoStore } from '../../features/players/model/player-data';

const store = new PlayerInfoStore(DEMO_PLAYERS);

export default function PlayersPreview() {
  return <StrictMode><PlayersScreen board={SAMPLE_BOARD} store={store} /></StrictMode>;
}
