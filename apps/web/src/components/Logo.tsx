interface Props {
  size?: number
  className?: string
}

export function Logo({ size = 24, className }: Props): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Departarr"
    >
      {/* Boarding pass outline */}
      <rect x="1.5" y="6" width="29" height="20" rx="2.5" stroke="currentColor" strokeWidth="2" fill="none" />
      {/* Perforation notches on left side */}
      <circle cx="1.5" cy="13" r="2.5" fill="var(--bg, #F0EDE7)" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="1.5" cy="19" r="2.5" fill="var(--bg, #F0EDE7)" stroke="currentColor" strokeWidth="1.5" />
      {/* Vertical dashed tear line */}
      <line x1="8" y1="8" x2="8" y2="24" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2.5" strokeLinecap="round" />
      {/* Stub fill */}
      <rect x="2" y="6.5" width="6" height="19" fill="currentColor" opacity="0.12" rx="1.5" />
      {/* Route dots */}
      <circle cx="14" cy="16" r="1.5" fill="currentColor" />
      <line x1="16" y1="16" x2="22" y2="16" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" strokeLinecap="round" />
      <path d="M24 14.5 L26.5 16 L24 17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
