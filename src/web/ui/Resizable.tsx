import { Group, Panel, Separator } from "react-resizable-panels";
import type { ComponentProps } from "react";
import { cn } from "./utils";

/** 分栏封装：separator 键盘可调（批次 0 切片已验证 ArrowRight 实际改变尺寸）。 */
export const PanelGroup = ({ className, ...props }: ComponentProps<typeof Group>) => (
  <Group className={cn(className)} {...props} />
);
export const ResizablePanel = Panel;
export const PanelSeparator = ({
  className,
  ...props
}: ComponentProps<typeof Separator>) => (
  <Separator
    className={cn(
      // 视觉 1px 细线，命中区向两侧扩大；focus 时加粗显示品牌色
      "relative w-px bg-line outline-none transition-colors",
      "before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-['']",
      "hover:bg-brand focus-visible:w-[3px] focus-visible:bg-brand",
      className,
    )}
    {...props}
  />
);
