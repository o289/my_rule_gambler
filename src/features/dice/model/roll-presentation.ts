export const ROLL_RESULT_DISPLAY_MS = 1120;

export function rollPresentationAction({ standard, complete, confirmed, own, reroll }: {
  standard: boolean;
  complete: boolean;
  confirmed: boolean;
  own: boolean;
  reroll: boolean;
}): 'wait' | 'confirm' | 'auto-confirm' | 'show-board' {
  if (!complete) return 'wait';
  if (!standard) return 'confirm';
  if (confirmed) return 'show-board';
  if (!own) return 'wait';
  return reroll ? 'auto-confirm' : 'confirm';
}
