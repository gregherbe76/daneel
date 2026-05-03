export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 180 180"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="180" height="180" rx="36" fill="#FF3C00" />
      <path d="M52 60 H92" stroke="white" strokeWidth="10" strokeLinecap="round" />
      <path d="M52 90 H108" stroke="white" strokeWidth="10" strokeLinecap="round" />
      <path d="M52 120 H80" stroke="white" strokeWidth="10" strokeLinecap="round" />
      <path
        d="M108 112 L124 128 L150 96"
        stroke="white"
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
