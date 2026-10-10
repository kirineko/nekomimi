import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { validId } from "../../shared/protocol";
import { Button } from "../ui/Button";
import { Menu, type MenuItem } from "../ui/Menu";
import { deferred } from "./deferred";
import { useSessionStream } from "./state/sessionStream";
import { useWorkbenchTheme } from "./theme";
import { useDeveloperView } from "./state/developer-view";
import { CoreRecoveryDialog } from "./routes/core-recovery";
import type { Mode } from "./shell";

const MoreDialog = deferred("v2/more-dialog.tsx", "MoreDialog", "对话框", () => import("./more-dialog").then((module) => module.MoreDialog));

export interface SettingsMenuHandle {
  openRecovery: () => void;
}

/** 会话级管理页有 sessionId 深链接；其余为模式级。 */
const sessionPages = new Set(["models", "themes", "panels", "workflows", "resources", "mcp", "packages"]);

/**
 * 顶栏唯一的设置入口（compact-header 规格）：外观、模型与凭证、全部设置、
 * 导出、版本与恢复、开发者视图开关。宿主恢复操作（CoreRecoveryDialog）静态导入，
 * 不依赖可选 chunk 或插件加载成功。
 */
export const SettingsMenu = forwardRef<
  SettingsMenuHandle,
  { mode: Mode; theme: "light" | "dark"; onTheme: (value: "light" | "dark") => void }
>(function SettingsMenu({ mode, theme, onTheme }, ref) {
  const navigate = useNavigate();
  const custom = useWorkbenchTheme();
  const developer = useDeveloperView();
  const { sessionId } = useParams({ strict: false });
  const valid = sessionId && validId(sessionId) ? sessionId : undefined;
  const stream = useSessionStream(valid);
  const session = stream.snapshot?.session;
  const canExport =
    !!session &&
    !["running", "accepted", "cancelling"].includes(session.status) &&
    stream.status !== "deleted" &&
    stream.status !== "unauthorized";
  const [dialog, setDialog] = useState<"appearance" | "export" | "recovery">();
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    custom.setPreview(undefined);
    setDialog(undefined);
  };
  useImperativeHandle(ref, () => ({ openRecovery: () => setDialog("recovery") }));
  // 运行中不允许导出：立即派生关闭状态，运行不会留下导出入口。
  if (dialog === "export" && !canExport) setDialog(undefined);

  const go = (page: string) =>
    void navigate({
      to: valid && sessionPages.has(page) ? `/${mode}/session/$sessionId/${page}` : `/${mode}/${page}`,
      params: valid && sessionPages.has(page) ? { sessionId: valid } : {},
    } as never);

  const items: MenuItem[] = [
    { id: "appearance", label: "外观", onSelect: () => setDialog("appearance") },
    { id: "models", label: "模型与凭证", onSelect: () => go("models") },
    { id: "all", label: "全部设置", hint: "能力、MCP、面板、工作流…", onSelect: () => go("settings-hub") },
    { kind: "separator", id: "s1" },
    { id: "export", label: "导出当前会话", disabled: !canExport, onSelect: () => setDialog("export") },
    { id: "recovery", label: "版本与恢复", onSelect: () => setDialog("recovery") },
    { kind: "separator", id: "s2" },
    {
      kind: "checkbox",
      id: "developer",
      label: "开发者视图",
      checked: developer.enabled,
      onCheckedChange: developer.setEnabled,
    },
  ];

  return (
    <>
      <Menu
        align="end"
        ariaLabel="设置"
        trigger={
          <Button ref={trigger} size="sm" variant="outline">
            设置
          </Button>
        }
        items={items}
      />
      {dialog === "recovery" && (
        <CoreRecoveryDialog
          close={close}
          restore={() => trigger.current?.focus()}
        />
      )}
      {dialog && dialog !== "recovery" && (
        <MoreDialog
          dialog={dialog}
          close={close}
          restore={() => trigger.current?.focus()}
          theme={theme}
          onTheme={onTheme}
          sessionId={valid}
          loadClose={() => {
            close();
            trigger.current?.focus();
          }}
        />
      )}
    </>
  );
});
