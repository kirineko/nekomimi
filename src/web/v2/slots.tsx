import { useExtensionDisplay } from "./state/extension-display";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { CustomPanel, type PanelView } from "../components/CustomPanel";
import { UiBridgeContext, type UiBridge } from "../ui-bridge";
import { Button } from "../ui/Button";
import { UI_SLOTS } from "../../customization/ui-contract";
import { Badge } from "../ui/Badge";
import { v2Host, v2Key } from "./state/query";
import type { Mode } from "./shell";

/**
 * 模式化扩展 slot 宿主（批次 4 · 9.6，D11）：
 * - slot 声明必须携带 contractVersion=3、模式适用性、目标范围与资源版本；
 * - 旧契约（缺少新字段的声明）明确拒绝并给出诊断，不挂载；
 * - 跨模式声明不挂载；导航/卸载销毁实例并撤销订阅（CustomPanel cleanup 已保证）；
 * - bridge 校验宿主会话/模式/目标，迟到响应不能覆盖另一草稿（实例纪元 + 会话比对）。
 */

export const SLOT_CONTRACT_VERSION = 3;

export interface SlotDeclaration {
  id: string;
  title?: string;
  contractVersion?: number;
  modes?: Mode[];
  targetScope?: "current";
  resourceRevision?: string;
  panel: PanelView;
}

export type SlotVerdict =
  | { ok: true; declaration: SlotDeclaration }
  | { ok: false; reason: string };

export function validateSlot(
  declaration: SlotDeclaration,
  context: { mode: Mode; target: string },
): SlotVerdict {
  if (declaration.contractVersion !== SLOT_CONTRACT_VERSION)
    return {
      ok: false,
      reason: `面板 ${declaration.id} 使用旧契约（contractVersion=${declaration.contractVersion ?? "缺失"}），已拒绝挂载`,
    };
  if (!declaration.modes?.includes(context.mode))
    return {
      ok: false,
      reason: `面板 ${declaration.id} 不适用于${context.mode === "work" ? "工作" : "创造"}模式，未挂载`,
    };
  if (declaration.targetScope !== "current" || !context.target)
    return { ok: false, reason: `面板 ${declaration.id} 缺少当前目标范围，已拒绝挂载` };
  if (!UI_SLOTS.includes(declaration.panel.slot))
    return { ok: false, reason: `面板 ${declaration.id} 使用不支持的区域，已拒绝挂载` };
  if (!declaration.resourceRevision || declaration.resourceRevision !== declaration.panel.revision)
    return { ok: false, reason: `面板 ${declaration.id} 缺少资源版本，已拒绝挂载` };
  return { ok: true, declaration };
}

/**
 * bridge 宿主上下文：携带当前模式/会话；宿主操作在新协议接入前显式拒绝（诚实诊断）。
 * 迟到 bridge 响应不能覆盖另一草稿：CustomPanel 在卸载/导航时关闭端口并丢弃迟到响应
 * （live=false），且服务端回执的 sessionId 与当前会话不一致时拒绝执行。
 */
export function createSlotBridge(base: {
  sessionId?: string;
  mode: Mode;
  enabled?:boolean;
  handle?: UiBridge["handle"];
}): UiBridge {
  return {
    sessionId: base.sessionId,
    enabled: base.enabled,
    handle:
      base.handle ??
      (async () => {
        throw new Error("当前工作台不支持该宿主操作");
      }),
  };
}

export function ModeSlot({
  slot,
  mode,
  target,
  sessionId,
  declarations,
  props = {},
  children,
}: {
  slot: string;
  mode: Mode;
  target: string;
  sessionId?: string;
  declarations: SlotDeclaration[];
  props?:Record<string,unknown>;
  children?:React.ReactNode;
}) {
  const visible = useExtensionDisplay();
  const exclusive = slot === "message-content" || slot === "tool-result";
  const [opened, setOpened] = React.useState<string[]>([]);
  const inheritedBridge = React.useContext(UiBridgeContext);
  const verdicts = declarations.filter(item => item.panel.slot === slot).sort((a,b) => (a.panel.order ?? 0)-(b.panel.order ?? 0) || a.panel.resourceId.localeCompare(b.panel.resourceId) || a.id.localeCompare(b.id)).map((declaration) => validateSlot(declaration, { mode, target }));
  const rejected = verdicts.filter((v): v is Extract<SlotVerdict, { ok: false }> => !v.ok);
  const accepted = verdicts.filter((v): v is Extract<SlotVerdict, { ok: true }> => v.ok);
  const bridge = React.useMemo(
    () => createSlotBridge({ sessionId, mode, enabled:inheritedBridge.enabled, handle: inheritedBridge.sessionId === sessionId ? inheritedBridge.handle : undefined }),
    [sessionId, mode, inheritedBridge],
  );
  React.useEffect(() => { if (!visible) setOpened([]); }, [visible]);
  if (!visible) return children ?? null;
  if (verdicts.length === 0) return children ?? null;
  return (
    <section aria-label={`扩展区域 ${slot}`} className="flex flex-col gap-2">
      {exclusive && opened.length > 0 && <Button size="sm" variant="outline" onClick={() => setOpened([])}>保留默认展示</Button>}
      {(!exclusive || !accepted.some(({declaration}) => opened.includes(`${declaration.panel.resourceId}:${declaration.id}:${declaration.resourceRevision}`))) && children}
      {rejected.map((verdict) => (
        <p key={verdict.reason} role="status" className="m-0 text-xs text-muted">
          <Badge state="warning">未挂载</Badge> {verdict.reason}
        </p>
      ))}
      {accepted.map(({ declaration }) => {
        const key = `${declaration.panel.resourceId}:${declaration.id}:${declaration.resourceRevision}`;
        const open = opened.includes(key);
        return <section key={key} className="rounded-md border border-line p-2">
          <Button variant="outline" size="sm" disabled={!sessionId || inheritedBridge.enabled===false} onClick={() => setOpened(keys => open ? keys.filter(value => value !== key) : exclusive ? [key] : [...keys, key])}>{open ? '关闭' : '打开'}{declaration.title ?? declaration.id}</Button>
          {!open && <p className="text-xs text-muted">{declaration.panel.fallback}</p>}
          {open && <PanelBoundary fallback={declaration.panel.fallback}><UiBridgeContext.Provider value={bridge}>
            <CustomPanel panel={declaration.panel} propsJson={JSON.stringify(props)} />
          </UiBridgeContext.Provider></PanelBoundary>}
        </section>;
      })}
    </section>
  );
}

/** 读取宿主运行时 UI 目录（只读）；新契约字段由后端随 sdkVersion=3 提供，缺失时按旧契约拒绝。 */
export function useRuntimeUi(mode: Mode, sessionId?:string) {
  return useQuery({
    queryKey: v2Key(v2Host(), mode, sessionId ?? "host", sessionId, "runtime-ui"),
    enabled: mode === "work" || !!sessionId,
    refetchInterval: sessionId ? 3000 : false,
    queryFn: ({ signal }) =>
      api<{ scope?:{sessionId:string;mode:Mode;targetId:string}; panels?: (PanelView & Partial<SlotDeclaration>)[] }>("/runtime-ui" + (sessionId ? "?session=" + encodeURIComponent(sessionId) : ""), undefined, signal),
  });
}

/** A malformed contribution must never unmount the host composer or stop controls. */
export class PanelBoundary extends React.Component<{fallback:string;children:React.ReactNode},{failed:boolean}> {
  state = {failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  render() { return this.state.failed ? <div role="alert" className="text-sm"><p>面板显示失败，已停止该实例。</p><p>{this.props.fallback}</p></div> : this.props.children; }
}

export function RuntimeSlot({slot,mode,sessionId,props,role,tool,children}:{slot:PanelView['slot'];mode:Mode;sessionId?:string;props?:Record<string,unknown>;role?:string;tool?:string;children?:React.ReactNode}) {
  const query=useRuntimeUi(mode,sessionId);
  const declarations=(query.data?.panels ?? []).filter(panel => (!panel.match?.role || panel.match.role===role) && (!panel.match?.tool || panel.match.tool===tool)).map(panel=>({...panel,resourceRevision:panel.resourceRevision ?? panel.revision,panel}));
  return <ModeSlot key={sessionId ?? mode} slot={slot} mode={mode} target={query.data?.scope?.targetId ?? 'current'} sessionId={sessionId} declarations={declarations} props={props}>{children}</ModeSlot>;
}
