export const SCORE_STAGGER_MS = 92;
export const SCORE_BEAM_MS = 410;
export const SCORE_PLATE_MS = 680;
export const REDUCED_SCORE_MS = 780;

export function scoreTimings(columns: number) {
  const beamDelay = Math.max(0, columns - 1) * SCORE_STAGGER_MS + 170;
  const plateDelay = beamDelay + SCORE_BEAM_MS - 40;
  return { beamDelay, plateDelay, total: plateDelay + SCORE_PLATE_MS };
}
