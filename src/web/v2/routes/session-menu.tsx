import { useRef, useState, type ReactNode } from "react";
import type { ContextOccupancy, SessionInfo } from "../../../shared/protocol";
import { Button } from "../../ui/Button";
import { Menu, type MenuItem } from "../../ui/Menu";
import { deferred } from "../deferred";
import { DevOnly, DevValue } from "../dev-only";
import {
  DialogRoot,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "../../ui/Dialog";
import { HandoffCompose } from "./handoff-compose";

const Inspection = deferred("v2/routes/inspection.tsx", "Inspection", "调用证据", () => import("./inspection").then((module) => module.Inspection));
const ContextDetails = deferred("v2/routes/context-details.tsx", "ContextDetails", "上下文详情", () => import("./context-details").then((module) => module.ContextDetails));
const SessionDeleteDialog = deferred("v2/routes/session-delete.tsx", "SessionDeleteDialog", "删除确认", () => import("./session-delete").then((module) => module.SessionDeleteDialog));
const ExportContent = deferred("v2/routes/session-export.tsx", "ExportContent", "会话导出", () => import("./session-export").then((module) => module.ExportContent));

type Panel = "inspection" | "context" | "handoff" | "export" | "info" | "delete";

/** 会话菜单打开的受控对话框：统一标题行、关闭按钮、尺寸与焦点归还（由 onClose 负责）。 */
function PanelDialog({
  title,
  description,
  closeLabel,
  width,
  hideHeaderClose,
  onClose,
  children,
}: {
  title: string;
  description: string;
  closeLabel: string;
  width?: string;
  hideHeaderClose?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto break-words p-4" style={width ? { width } : undefined}>
        <div className="flex items-center justify-between gap-2">
          <DialogTitle>{title}</DialogTitle>
          {!hideHeaderClose && (
            <DialogClose asChild>
              <Button size="sm" variant="outline">{closeLabel}</Button>
            </DialogClose>
          )}
        </div>
        <DialogDescription>{description}</DialogDescription>
        {children}
      </DialogContent>
    </DialogRoot>
  );
}

/**
 * 精简会话头部菜单（web-task-workbench 新增 Requirement）：
 * 调用证据、上下文、交接、导出、会话信息、删除统一从“会话操作”进入；
 * 关闭后焦点归还菜单触发按钮。
 */
export function SessionMenu({
  session,
  running,
  measurement,
}: {
  session: SessionInfo;
  running: boolean;
  measurement?: ContextOccupancy;
}) {
  const [panel, setPanel] = useState<Panel>();
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setPanel(undefined);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const handoffLabel = session.binding?.mode !== "create" ? "交接到创造会话" : "交接到工作会话";
  const percent =
    measurement?.contextWindow && measurement.contextWindow > 0
      ? Math.round((measurement.totalTokens / measurement.contextWindow) * 100)
      : undefined;

  const items: MenuItem[] = [
    { id: "inspection", label: "调用证据", onSelect: () => setPanel("inspection") },
    {
      id: "context",
      label: percent === undefined ? "上下文详情" : `上下文 · ${percent}%`,
      onSelect: () => setPanel("context"),
    },
    { id: "handoff", label: handoffLabel, onSelect: () => setPanel("handoff") },
    { kind: "separator", id: "s1" },
    {
      id: "export",
      label: "导出会话",
      disabled: running,
      hint: running ? "运行结束后可导出" : undefined,
      onSelect: () => setPanel("export"),
    },
    { id: "info", label: "会话信息", onSelect: () => setPanel("info") },
    {
      id: "delete",
      label: "删除会话",
      danger: true,
      disabled: running,
      hint: running ? "运行结束后可删除" : undefined,
      onSelect: () => setPanel("delete"),
    },
  ];

  return (
    <>
      <Menu
        align="end"
        ariaLabel="会话操作"
        trigger={
          <Button ref={trigger} size="sm" variant="outline" aria-label="会话操作">
            ···
          </Button>
        }
        items={items}
      />
      {panel === "inspection" && (
        <PanelDialog title="调用证据" closeLabel="关闭调用证据" width="min(960px,calc(100vw-32px))" onClose={close}
          description="检查嵌套调用、逐次请求与响应，读取已有证据不会执行代码。">
          <Inspection key={session.id} sessionId={session.id} loadClose={close} />
        </PanelDialog>
      )}
      {panel === "context" && (
        <PanelDialog title="上下文详情" closeLabel="关闭详情" onClose={close}
          description="只读查看当前估算、历史选择和压缩来源。">
          <ContextDetails loadClose={close} key={`${session.id}:current`} sessionId={session.id} />
        </PanelDialog>
      )}
      {panel === "handoff" && (
        <PanelDialog title={handoffLabel} closeLabel="关闭交接" width="min(720px,calc(100vw-32px))" onClose={close}
          description="预览只检查目标和选定内容。确认后仅记录交接，目标任务由你另行提交。">
          <HandoffCompose key={`handoff:${session.id}`} sessionId={session.id} mode={session.binding?.mode ?? "work"} initiallyOpen onClose={close} />
        </PanelDialog>
      )}
      {panel === "export" && (
        <PanelDialog title="导出对话" closeLabel="关闭导出" width="min(680px,calc(100vw-32px))" onClose={close}
          description="离线 HTML 用于阅读，诊断包包含会话与执行证据；导出不会重新运行模型、工具或扩展。">
          <ExportContent key={session.id} sessionId={session.id} loadClose={close} />
        </PanelDialog>
      )}
      {panel === "info" && (
        <PanelDialog title="会话信息" closeLabel="关闭" onClose={close} hideHeaderClose
          description="只读查看这个会话绑定的模式与写入目标。">
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="text-muted">模式</dt><dd>{session.binding?.mode !== "create" ? "工作" : "创造"}</dd></div>
            {session.binding?.target.root && (
              <div><dt className="text-muted">写入目标</dt><dd className="break-all">{session.binding.target.root}</dd></div>
            )}
            {session.binding && (
              <div><dt className="text-muted">范围</dt><dd>{session.binding.target.kind === "core" ? "核心源码" : "扩展开发"} · {session.binding.target.scope === "user" ? "用户范围" : "项目范围"}</dd></div>
            )}
            <DevOnly>
              <div><dt className="text-muted">会话标识</dt><dd><DevValue label="会话标识" value={session.id} truncate={16} /></dd></div>
              {session.runId && <div><dt className="text-muted">当前运行</dt><dd><DevValue label="当前运行" value={session.runId} truncate={16} /></dd></div>}
            </DevOnly>
          </dl>
          <DialogClose asChild>
            <Button size="sm" variant="outline" className="mt-4">关闭</Button>
          </DialogClose>
        </PanelDialog>
      )}
      {panel === "delete" && (
        <SessionDeleteDialog
          session={session}
          mode={session.binding?.mode ?? "work"}
          active={session.id}
          opener={trigger.current}
          close={close}
          loadClose={close}
        />
      )}
    </>
  );
}
