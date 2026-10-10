import type { ReactNode } from "react";
import { useDeveloperView } from "./state/developer-view";
import { cn } from "../ui/utils";

/** 仅开发者视图显示。children 只在开启时渲染，避免隐藏节点仍发请求。 */
export function DevOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useDeveloperView().enabled ? <>{children}</> : <>{fallback}</>;
}

/** 内联开发信息：等宽、弱化、带“开发”标记；长值截断并可复制。 */
export function DevValue({
  label,
  value,
  className,
  truncate = 12,
}: {
  label: string;
  value: string;
  className?: string;
  truncate?: number;
}) {
  const { enabled } = useDeveloperView();
  if (!enabled) return null;
  const short = value.length > truncate ? `${value.slice(0, truncate)}…` : value;
  return (
    <span
      data-dev-value
      className={cn(
        "inline-flex max-w-full items-center gap-1 font-mono text-[11px] text-muted",
        className,
      )}
    >
      <span
        aria-hidden
        className="rounded-sm border border-dashed border-line px-1 text-[10px]"
      >
        开发
      </span>
      <span className="sr-only">{label}：</span>
      <span title={value} className="min-w-0 truncate">
        {short}
      </span>
      {value.length > truncate && (
        <button
          type="button"
          className="rounded-sm px-1 hover:bg-wash"
          aria-label={`复制${label}`}
          onClick={() => void navigator.clipboard?.writeText(value)}
        >
          复制
        </button>
      )}
    </span>
  );
}

/** 英文眉标等纯装饰性开发信息，统一一个组件，便于测试断言其不存在。 */
export function DevEyebrow({ children }: { children: string }) {
  return (
    <DevOnly>
      <p data-dev-eyebrow className="m-0 font-mono text-[10px] tracking-[2px] text-muted">
        {children}
      </p>
    </DevOnly>
  );
}
