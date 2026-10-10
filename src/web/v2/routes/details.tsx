import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Snapshot } from "../../../shared/protocol";
import { api } from "../../api";
import { Tabs, TabPanel } from "../../ui/Tabs";
import { ModeSlot, useRuntimeUi, type SlotDeclaration } from "../slots";
import { v2Host, v2Key } from "../state/query";
import type { Mode } from "../shell";
import { DevEyebrow, DevValue } from "../dev-only";
import { InspectionButton } from "./inspection-button";
import { useDetailsDrawer, type DetailsTab } from "../state/details-drawer";

import { deferred } from '../deferred';
const Changes = deferred('components/Changes.tsx', 'Changes', '变更', () => import('../../components/Changes').then(module => module.Changes));
const FileBrowser = deferred('components/FileBrowser.tsx', 'FileBrowser', '文件', () => import('../../components/FileBrowser').then(module => module.FileBrowser));

/** 扩展 slot 区域：声明来自运行时 UI 目录，旧契约/跨模式声明在此被拒绝并显示诊断。 */
export function SlotArea({ mode, sessionId }: { mode: Mode; sessionId?: string }) {  const query = useRuntimeUi(mode, sessionId);
  const declarations: SlotDeclaration[] = (query.data?.panels ?? []).map((panel) => ({
    id: panel.id,
    title: panel.title,
    contractVersion: panel.contractVersion,
    modes: panel.modes,
    targetScope: panel.targetScope,
    resourceRevision: panel.resourceRevision ?? panel.revision,
    panel,
  }));
  if (!declarations.length) return null;
  return <ModeSlot key={sessionId ?? mode} slot="sidebar-widget" mode={mode} target="current" sessionId={sessionId} declarations={declarations} />;
}

/** 工作台证据侧栏：上下文占用来自当前会话投影；容量未知时不编造百分比。
 *  变更/文件区域复用既有只读组件，按会话加载。 */
export function WorkDetails({ snapshot, location }: { snapshot?: Snapshot; location?:{path:string;revision:number} }) {
  const context = snapshot?.context;
  const drawer = useDetailsDrawer();
  const [tab, setTab] = useState<DetailsTab>("evidence");
  const [locatePath, setLocatePath] = useState<string | undefined>(undefined);
  const sessionId = snapshot?.session.id;
  useEffect(()=>{if(location){setLocatePath(location.path);setTab("files");}},[location]);
  // 外部入口（会话头部“变更”、文件定位）指定抽屉标签
  useEffect(()=>{if(drawer.open)setTab(drawer.tab === "extensions" ? "evidence" : drawer.tab);},[drawer.open,drawer.tab,drawer.revision]);
  const config = useQuery({
    queryKey: v2Key(v2Host(), "work", "default", undefined, "config"),
    queryFn: ({ signal }) => api<{ workspace: string }>("/config", undefined, signal),
  });
  return (
    <aside aria-label="结果与证据" className="flex flex-col gap-3">
      <DevEyebrow>INSPECTOR</DevEyebrow>
      <Tabs
        ariaLabel="侧栏区域"
        value={tab}
        onChange={(next) => {
          setTab(next as DetailsTab);
          if (next !== "files") setLocatePath(undefined);
        }}
        items={[
          { id: "evidence", label: "证据" },
          { id: "changes", label: "变更" },
          { id: "files", label: "文件" },
        ]}
      />
      <TabPanel id="evidence" active={tab === "evidence"}>
        <div className="rounded-xl border border-line bg-background p-4">
          <h3 className="text-sm">上下文占用</h3>
          {context ? (
            <>
              <p className="text-sm">
                {context.contextWindow
                  ? `约 ${Math.min(100, Math.round((context.totalTokens / context.contextWindow) * 100))}%`
                  : "容量未知"}
                <span className="text-muted">
                  {" "}· {context.method === "estimated" ? "估算" : "已校准"} {context.totalTokens.toLocaleString()} tokens
                </span>
              </p>
              {context.contextWindow ? (
                <div
                  role="meter"
                  aria-label="上下文占用"
                  aria-valuemin={0}
                  aria-valuemax={context.contextWindow}
                  aria-valuenow={context.totalTokens}
                  className="my-2 h-1.5 rounded bg-panel"
                >
                  <span
                    className="block h-1.5 rounded bg-brand"
                    style={{
                      width: `${Math.min(100, (context.totalTokens / context.contextWindow) * 100)}%`,
                    }}
                  />
                </div>
              ) : (
                <p className="text-xs text-muted">模型容量未知，不显示百分比。</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">开始任务后可在这里查看上下文占用。</p>
          )}
        </div>
        <div className="mt-3 rounded-xl border border-line bg-background p-4">
          <h3 className="text-sm">调用证据</h3>
          {sessionId ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">逐次查看模型请求、工具调用与用量；只读，不会重新执行。</p>
              <div className="flex flex-wrap items-center gap-2">
                <InspectionButton sessionId={sessionId} runId={snapshot?.session.runId} />
                {snapshot?.session.runId && <DevValue label="运行 ID" value={snapshot.session.runId} />}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">选择会话后可查看调用证据。</p>
          )}
        </div>
      </TabPanel>
      <TabPanel id="changes" active={tab === "changes"}>
          <Changes
            loadClose={() => { setTab("evidence"); document.getElementById("tab-evidence")?.focus(); }}
            sessionId={sessionId}
            revision={snapshot?.cursor.seq ?? 0}
            locate={(path) => {
              setLocatePath(path);
              setTab("files");
            }}
          />
      </TabPanel>
      <TabPanel id="files" active={tab === "files"}>
          {config.data ? (
            <FileBrowser
              loadClose={() => { setTab("evidence"); document.getElementById("tab-evidence")?.focus(); }}
              revision={snapshot?.cursor.seq ?? 0}
              workspace={config.data.workspace}
              locate={locatePath}
              locateRevision={location?.revision ?? snapshot?.cursor.seq ?? 0}
            />
          ) : (
            <p className="text-sm text-muted">读取工作区…</p>
          )}
      </TabPanel>
      <SlotArea mode="work" sessionId={sessionId} />
    </aside>
  );
}

