export function CrownIcon({ className = '' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path d="m3 8 4.8 4.1L12 5l4.2 7.1L21 8l-2.4 10.5H5.4L3 8Z M6 21h12" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    <circle cx="3" cy="7.8" r="1.3" fill="currentColor" /><circle cx="12" cy="4.9" r="1.3" fill="currentColor" /><circle cx="21" cy="7.8" r="1.3" fill="currentColor" />
  </svg>;
}

export function DiceIcon() {
  return <svg viewBox="0 0 24 24" fill="none" className="dice-icon" aria-hidden="true">
    <path d="m12 2.6 8.4 4.7v9.4L12 21.4l-8.4-4.7V7.3L12 2.6Zm0 9.4 8.4-4.7M12 12v9.4M12 12 3.6 7.3" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
    <circle cx="12" cy="7.3" r="1" fill="currentColor" /><circle cx="7.8" cy="14.1" r="1" fill="currentColor" /><circle cx="16.3" cy="13.6" r="1" fill="currentColor" />
  </svg>;
}

export function ChevronIcon({ back = false }: { back?: boolean }) {
  return <svg viewBox="0 0 16 16" fill="none" className="chevron-icon" aria-hidden="true">
    <path d={back ? 'm10 3-5 5 5 5' : 'm6 3 5 5-5 5'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
