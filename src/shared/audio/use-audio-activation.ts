import { useLayoutEffect } from 'react';

const gestures = ['pointerdown', 'pointerup', 'keydown', 'click'] as const;

export function useAudioActivation(unlock: () => void) {
  useLayoutEffect(() => {
    function activate(event: Event) {
      if (event.isTrusted && navigator.userActivation?.isActive !== false) unlock();
    }
    for (const gesture of gestures) document.addEventListener(gesture, activate, true);
    return () => {
      for (const gesture of gestures) document.removeEventListener(gesture, activate, true);
    };
  }, [unlock]);
}
