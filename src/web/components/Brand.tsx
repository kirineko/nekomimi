/** Shared cat-ear mark for the product and assistant identity. */
export function CatMark({ className = "" }: { className?: string }) {
  return <svg className={`cat-mark ${className}`} viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <path d="M7 19 6 7q0-2 2-1l9 6q3-1 6 0l9-6q2-1 2 1l-1 12c5 15-31 15-26 0Z" fill="currentColor" />
    <path d="m10 11 5 4-5 2Zm20 0-5 4 5 2Z" fill="#f3c8df" />
    <path d="M13 22v2m14-2v2m-10 2q3 4 6 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    <ellipse cx="10" cy="26" rx="2" ry="1" fill="#edb9d4" /><ellipse cx="30" cy="26" rx="2" ry="1" fill="#edb9d4" />
  </svg>;
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className={`nekomimi-brand ${compact ? "compact" : ""}`}><CatMark /><span className="brand-word">neko<span>mimi</span></span></span>;
}
