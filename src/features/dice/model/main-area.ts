import type { GameState } from '../../../shared/contracts/dice';

export type DiceMainPanel = 'board' | 'operations';

export function panelForTurnChange(isLocalTurn: boolean): DiceMainPanel {
  return isLocalTurn ? 'operations' : 'board';
}

export function canSwitchDiceMainPanel(input: {
  canAct: boolean;
  phase: GameState['phase'] | undefined;
  hasLegalPlacement: boolean;
  remainingDice: number;
  placedThisRoll: boolean;
  devReroll: boolean;
}) {
  if (!input.canAct) return false;
  if (input.phase === 'ready') return true;
  if (input.phase !== 'placement') return false;
  const canPlace = input.hasLegalPlacement;
  const canUseDice = input.remainingDice > 0 && (input.placedThisRoll || input.devReroll);
  return canPlace || canUseDice;
}

export function canShowPreviewEndTurn(input: {
  preview: boolean;
  canAct: boolean;
  phase: GameState['phase'] | undefined;
  hasLegalPlacement: boolean;
  placedThisRoll: boolean;
  panelCanSwitch: boolean;
}) {
  return input.preview && input.canAct && input.phase === 'placement'
    && (!input.hasLegalPlacement || input.placedThisRoll) && !input.panelCanSwitch;
}
