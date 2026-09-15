import catMark from "../assets/nekomimi.svg";
/** Shared cat-ear mark for the product and assistant identity. */
export function CatMark({ className = "" }: { className?: string }) {
  return <img className={`cat-mark ${className}`} src={catMark} alt="" aria-hidden="true" />;
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className={`nekomimi-brand ${compact ? "compact" : ""}`}><CatMark /><span className="brand-word">neko<span>mimi</span></span></span>;
}
