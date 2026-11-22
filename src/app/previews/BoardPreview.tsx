import BoardScreen from '../../features/board/ui/main';
import { SAMPLE_BOARD } from '../../dev/preview-data/sample-board';

export default function BoardPreview() {
  return <BoardScreen board={SAMPLE_BOARD} />;
}
