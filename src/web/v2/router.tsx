import { useCallback, useState } from "react";
import { LocateFile } from "../workspace-context";
import { RuntimeBridge } from "./runtime-bridge";
import { WorkbenchTheme } from './theme';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useParams,
  useNavigate,
  redirect,
  Link,
} from "@tanstack/react-router";
import { validId } from "../../shared/protocol";
import { ErrorState } from "../ui/StateCard";
import { Button } from "../ui/Button";
import { Mode, TopBar, useTheme, WorkbenchShell } from "./shell";
import { DevEyebrow } from "./dev-only";
import { detailsDrawer } from "./state/details-drawer";
import { WorkDetails } from "./routes/details";
import { WorkNavigation } from "./routes/work-nav";
import { SessionStreamProvider, useSessionStream } from "./state/sessionStream";

import { deferred } from "./deferred";
import { SettingsHubPage } from "./routes/settings-hub";
import type { DeliverySearch } from "./routes/delivery-candidate";
const CreateDetails = deferred("v2/routes/create-details.tsx", "CreateDetails", "候选与验证", () => import("./routes/create-details").then(module => module.CreateDetails));
const WorkSessionPage = deferred("v2/routes/work-session.tsx", "WorkSessionPage", "工作会话", () => import("./routes/work-session").then(module => module.WorkSessionPage));
const ThemesPage = deferred("v2/routes/themes.tsx", "ThemesPage", "主题管理", () => import("./routes/themes").then(module => module.ThemesPage));
const SettingsPage = deferred("v2/routes/settings.tsx", "SettingsPage", "设置", () => import("./routes/settings").then(module => module.SettingsPage));
const PanelsPage = deferred("v2/routes/panels.tsx", "PanelsPage", "面板管理", () => import("./routes/panels").then(module => module.PanelsPage));
const WorkflowsPage = deferred("v2/routes/workflows.tsx", "WorkflowsPage", "工作流管理", () => import("./routes/workflows").then(module => module.WorkflowsPage));
const PackageManagementPage = deferred("v2/routes/package-management.tsx", "PackageManagementPage", "能力包管理", () => import("./routes/package-management").then(module => module.PackageManagementPage));
const McpManagementPage = deferred("v2/routes/mcp-management.tsx", "McpManagementPage", "MCP 管理", () => import("./routes/mcp-management").then(module => module.McpManagementPage));
const ResourcesPage = deferred("v2/routes/resources.tsx", "ResourcesPage", "能力与权限", () => import("./routes/resources").then(module => module.ResourcesPage));
const ModelsPage = deferred("v2/routes/models.tsx", "ModelsPage", "模型管理", () => import("./routes/models").then(module => module.ModelsPage));
const DeliveryCandidatePage = deferred("v2/routes/delivery-candidate.tsx", "DeliveryCandidatePage", "交付候选", () => import("./routes/delivery-candidate").then(module => module.DeliveryCandidatePage));
const CreateCandidatePage = deferred("v2/routes/create.tsx", "CreateCandidatePage", "创造空间", () => import("./routes/create").then(module => module.CreateCandidatePage));
const CreateHomePage = deferred("v2/routes/create.tsx", "CreateHomePage", "创造空间", () => import("./routes/create").then(module => module.CreateHomePage));
const CreateNavigation = deferred("v2/routes/create.tsx", "CreateNavigation", "创造空间", () => import("./routes/create").then(module => module.CreateNavigation));
const CoreCandidatePage = deferred("v2/routes/core-candidate.tsx", "CoreCandidatePage", "核心候选", () => import("./routes/core-candidate").then(module => module.CoreCandidatePage));
const DevUiPage = deferred("v2/routes/dev-ui.tsx", "DevUiPage", "组件预览", () => import("./routes/dev-ui").then(module => module.DevUiPage));

/**
 * work/create 路由与深链接（批次 4 · 9.2）：
 * 导航只发只读请求；无效/无权目标显示明确诊断，不回退执行；刷新恢复到同会话/候选视图。
 */

function WorkLayout() {
  const theme = useTheme(), { sessionId } = useParams({ strict: false });
  return (
    <SessionStreamProvider key={sessionId ?? "host"} sessionId={sessionId}><RuntimeBridge key={sessionId ?? "host"} sessionId={sessionId} mode="work"><WorkbenchTheme sessionId={sessionId}><div className="ds flex h-dvh flex-col bg-background text-foreground">
      <TopBar
        mode="work"
        target="用户项目"
        theme={theme.theme}
        onTheme={theme.setTheme}
      />
      <Outlet />
    </div></WorkbenchTheme></RuntimeBridge></SessionStreamProvider>
  );
}

function WorkIndex() {
  return (
    <WorkbenchShell
      mode="work"
      navigation={<WorkNavigation />}
      main={
        <main className="flex h-full flex-col px-6 pt-4 max-[760px]:px-4">
          <DevEyebrow>WORK MODE</DevEyebrow>
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl">开始一个任务</h1>
            <Button size="sm" variant="outline" onClick={() => detailsDrawer.toggle()}>
              详情
            </Button>
          </div>
          <p className="mt-2 text-sm text-muted">从左侧选择任务，或新建一个。</p>
        </main>
      }
      details={<WorkDetails />}
    />
  );
}

function WorkSession() {
  const navigate = useNavigate();
  const { sessionId } = workSessionRoute.useParams();
  const valid = validId(sessionId);
  const stream = useSessionStream(valid ? sessionId : undefined);
  const [location,setLocation]=useState<{sessionId:string;path:string;revision:number}>();
  const locate=useCallback((path:string)=>setLocation(previous=>({sessionId,path,revision:(previous?.revision ?? 0)+1})),[sessionId]);
  const current=location?.sessionId===sessionId?location:undefined;
  return (
    <LocateFile.Provider value={locate}>
    <WorkbenchShell
      mode="work"
      revealDetails={current?.revision}
      navigation={<WorkNavigation active={sessionId} />}
      main={<WorkSessionPage key={sessionId} loadClose={() => { void navigate({ to: "/work" }); }} />}
      details={<WorkDetails key={sessionId} snapshot={stream.snapshot} location={current} />}
    /></LocateFile.Provider>
  );
}

function CreateLayout() {
  const theme = useTheme(), { sessionId } = useParams({ strict: false });
  return (
    <SessionStreamProvider key={sessionId ?? "host"} sessionId={sessionId}><RuntimeBridge key={sessionId ?? "host"} sessionId={sessionId} mode="create"><WorkbenchTheme sessionId={sessionId}><div className="ds flex h-dvh flex-col bg-background text-foreground">
      <TopBar
        mode="create"
        target="Nekomimi"
        theme={theme.theme}
        onTheme={theme.setTheme}
      />
      <Outlet />
    </div></WorkbenchTheme></RuntimeBridge></SessionStreamProvider>
  );
}

function CreateIndex() {
  return (
    <WorkbenchShell
      mode="create"
      navigation={<CreateNavigation />}
      main={<CreateHomePage />}
      details={<CreateDetails />}
    />
  );
}

function CreateCandidate() {
  const { candidateId } = createCandidateRoute.useParams();
  return (
    <WorkbenchShell
      mode="create"
      navigation={<CreateNavigation active={candidateId} />}
      main={<CreateCandidatePage candidateId={candidateId} />}
      details={<CreateDetails />}
    />
  );
}
function CreateSession() {
  const { sessionId } = createSessionRoute.useParams();
  return <WorkbenchShell mode="create" navigation={<CreateNavigation sessionId={sessionId} />} main={<CreateHomePage sessionId={sessionId} />} details={<CreateDetails sessionId={sessionId} />} />;
}
function CreateSessionCore() {
  const { sessionId } = createSessionCoreRoute.useParams();
  return <WorkbenchShell mode="create" navigation={<CreateNavigation sessionId={sessionId} />} main={<CoreCandidatePage sessionId={sessionId} />} details={<CreateDetails sessionId={sessionId} />} />;
}
function CreateSessionCandidate() {
  const { sessionId, candidateId } = createSessionCandidateRoute.useParams();
  const selection = createSessionCandidateRoute.useSearch();
  return <WorkbenchShell mode="create" navigation={<CreateNavigation active={candidateId} sessionId={sessionId} />} main={Object.keys(selection).length ? <DeliveryCandidatePage sessionId={sessionId} candidateId={candidateId} selection={selection} /> : <CreateCandidatePage candidateId={candidateId} sessionId={sessionId} />} details={<CreateDetails sessionId={sessionId} />} />;
}

const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: () => (
    <main className="ds p-6">
      <ErrorState
        title="页面不存在"
        detail="该地址不对应任何工作台视图，未执行任何操作。"
      />
    </main>
  ),
});

const workLayout = createRoute({
  getParentRoute: () => rootRoute,
  path: "/work",
  component: WorkLayout,
});
const workIndexRoute = createRoute({
  getParentRoute: () => workLayout,
  path: "/",
  component: WorkIndex,
});
const workSessionRoute = createRoute({
  getParentRoute: () => workLayout,
  path: "/session/$sessionId",
  component: WorkSession,
  validateSearch: (search: Record<string, unknown>): { delivery?: string } => typeof search.delivery === "string" && /^[a-f0-9]{64}$/.test(search.delivery) ? { delivery: search.delivery } : {},
});

const createLayout = createRoute({
  getParentRoute: () => rootRoute,
  path: "/create",
  component: CreateLayout,
});
const createIndexRoute = createRoute({
  getParentRoute: () => createLayout,
  path: "/",
  component: CreateIndex,
});
const createCandidateRoute = createRoute({
  getParentRoute: () => createLayout,
  path: "/candidate/$candidateId",
  component: CreateCandidate,
});
const createSessionRoute = createRoute({ getParentRoute: () => createLayout, path: '/session/$sessionId', component: CreateSession });
const createSessionCoreRoute = createRoute({ getParentRoute: () => createLayout, path: '/session/$sessionId/core', component: CreateSessionCore });
const createSessionCandidateRoute = createRoute({ getParentRoute: () => createLayout, path: '/session/$sessionId/candidate/$candidateId', component: CreateSessionCandidate, validateSearch: (search: Record<string, unknown>): DeliverySearch => Object.fromEntries(['deliverySession', 'handoff', 'revision'].filter(key => key in search).map(key => [key, typeof search[key] === 'string' ? search[key] : ''])) });


/** 管理页外壳：统一导航/主区包装与“返回任务”，深链接路径不变（design D5）。 */
function ManagementMain({ mode, sessionId, children }: { mode: Mode; sessionId?: string; children: React.ReactNode }) {
  return (
    <main className="h-full min-w-0 overflow-auto px-6 py-4 max-[760px]:px-4">
      <p className="mb-3">
        <Link
          to={sessionId ? (mode === "work" ? "/work/session/$sessionId" : "/create/session/$sessionId") : (mode === "work" ? "/work" : "/create")}
          params={sessionId ? { sessionId } : {}}
          className="text-sm"
        >
          ← 返回任务
        </Link>
      </p>
      {children}
    </main>
  );
}
function managementPage(mode: Mode, page: (props: { sessionId?: string }) => React.ReactNode) {
  return function Page() {
    const { sessionId } = useParams({ strict: false });
    return (
      <WorkbenchShell
        mode={mode}
        navigation={mode === "work" ? <WorkNavigation active={sessionId} /> : <CreateNavigation sessionId={sessionId} />}
        main={<ManagementMain mode={mode} sessionId={sessionId}>{page({ sessionId })}</ManagementMain>}
        details={mode === "work" ? <WorkDetails /> : <CreateDetails sessionId={sessionId} />}
      />
    );
  };
}

const workThemesRoute = createRoute({ getParentRoute: () => workLayout, path: '/themes', component: managementPage("work", () => <ThemesPage />) });
const createThemesRoute = createRoute({ getParentRoute: () => createLayout, path: '/themes', component: managementPage("create", () => <ThemesPage />) });
const createSessionThemesRoute = createRoute({ getParentRoute: () => createLayout, path: '/session/$sessionId/themes', component: managementPage("create", () => <ThemesPage />) });

const workSettingsRoute = createRoute({ getParentRoute: () => workLayout, path: '/settings', component: managementPage("work", () => <SettingsPage />) });
const createSettingsRoute = createRoute({ getParentRoute: () => createLayout, path: '/settings', component: managementPage("create", () => <SettingsPage />) });
const workSettingsHubRoute = createRoute({ getParentRoute: () => workLayout, path: '/settings-hub', component: managementPage("work", ({ sessionId }) => <SettingsHubPage mode="work" sessionId={sessionId} />) });
const createSettingsHubRoute = createRoute({ getParentRoute: () => createLayout, path: '/settings-hub', component: managementPage("create", ({ sessionId }) => <SettingsHubPage mode="create" sessionId={sessionId} />) });
const workSessionSettingsHubRoute = createRoute({ getParentRoute: () => workLayout, path: '/session/$sessionId/settings-hub', component: managementPage("work", ({ sessionId }) => <SettingsHubPage mode="work" sessionId={sessionId} />) });
const createSessionSettingsHubRoute = createRoute({ getParentRoute: () => createLayout, path: '/session/$sessionId/settings-hub', component: managementPage("create", ({ sessionId }) => <SettingsHubPage mode="create" sessionId={sessionId} />) });

const workPanelsRoute = createRoute({ getParentRoute: () => workLayout, path: '/panels', component: managementPage("work", () => <PanelsPage mode="work" />) });
const workSessionPanelsRoute = createRoute({ getParentRoute: () => workLayout, path: '/session/$sessionId/panels', component: managementPage("work", ({ sessionId }) => <PanelsPage mode="work" sessionId={sessionId} />) });
const createPanelsRoute = createRoute({ getParentRoute: () => createLayout, path: '/panels', component: managementPage("create", () => <PanelsPage mode="create" />) });
const createSessionPanelsRoute = createRoute({ getParentRoute: () => createLayout, path: '/session/$sessionId/panels', component: managementPage("create", ({ sessionId }) => <PanelsPage mode="create" sessionId={sessionId} />) });

const workWorkflowsRoute = createRoute({ getParentRoute: () => workLayout, path: '/workflows', component: managementPage("work", () => <WorkflowsPage mode="work" />) });
const createWorkflowsRoute = createRoute({ getParentRoute: () => createLayout, path: '/workflows', component: managementPage("create", () => <WorkflowsPage mode="create" />) });
const createSessionWorkflowsRoute = createRoute({ getParentRoute: () => createLayout, path: '/session/$sessionId/workflows', component: managementPage("create", ({ sessionId }) => <WorkflowsPage mode="create" sessionId={sessionId} />) });

const createPackagesRoute = createRoute({ getParentRoute: () => createLayout, path: '/packages', component: managementPage("create", ({ sessionId }) => <PackageManagementPage sessionId={sessionId} />) });
const createSessionPackagesRoute = createRoute({ getParentRoute: () => createLayout, path: '/session/$sessionId/packages', component: managementPage("create", ({ sessionId }) => <PackageManagementPage sessionId={sessionId} />) });

const createMcpRoute = createRoute({ getParentRoute: () => createLayout, path: '/mcp', component: managementPage("create", ({ sessionId }) => <McpManagementPage sessionId={sessionId} />) });
const createSessionMcpRoute = createRoute({ getParentRoute: () => createLayout, path: '/session/$sessionId/mcp', component: managementPage("create", ({ sessionId }) => <McpManagementPage sessionId={sessionId} />) });

const createResourcesRoute = createRoute({ getParentRoute: () => createLayout, path: '/resources', component: managementPage("create", () => <ResourcesPage />) });
const createSessionResourcesRoute = createRoute({ getParentRoute: () => createLayout, path: '/session/$sessionId/resources', component: managementPage("create", ({ sessionId }) => <ResourcesPage sessionId={sessionId} />) });

const workModelsRoute = createRoute({ getParentRoute: () => workLayout, path: '/models', component: managementPage("work", () => <ModelsPage />) });
const workSessionModelsRoute = createRoute({ getParentRoute: () => workLayout, path: '/session/$sessionId/models', component: managementPage("work", ({ sessionId }) => <ModelsPage sessionId={sessionId} />) });
const createModelsRoute = createRoute({ getParentRoute: () => createLayout, path: '/models', component: managementPage("create", () => <ModelsPage mode="create" />) });
const createSessionModelsRoute = createRoute({ getParentRoute: () => createLayout, path: '/session/$sessionId/models', component: managementPage("create", ({ sessionId }) => <ModelsPage mode="create" sessionId={sessionId} />) });
const devUiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dev/ui",
  component: DevUiPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/work" });
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  workLayout.addChildren([workIndexRoute, workSessionRoute, workModelsRoute, workWorkflowsRoute, workPanelsRoute, workSessionPanelsRoute, workSessionModelsRoute, workSettingsRoute, workSettingsHubRoute, workSessionSettingsHubRoute, workThemesRoute]),
  createLayout.addChildren([createIndexRoute, createCandidateRoute, createSessionRoute, createSessionCandidateRoute, createSessionCoreRoute, createModelsRoute, createSessionModelsRoute, createResourcesRoute, createSessionResourcesRoute, createMcpRoute, createSessionMcpRoute, createPackagesRoute, createSessionPackagesRoute, createWorkflowsRoute, createSessionWorkflowsRoute, createPanelsRoute, createSessionPanelsRoute, createSettingsRoute, createSettingsHubRoute, createSessionSettingsHubRoute, createThemesRoute, createSessionThemesRoute]),
  devUiRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export type { Mode };
