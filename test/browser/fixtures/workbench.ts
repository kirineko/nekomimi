import { expect, type Page } from "@playwright/test";

export async function openSettings(page: Page) {
  const trigger = page.getByRole("button", { name: "设置", exact: true });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await expect(page.getByRole("menu")).toBeVisible();
  return trigger;
}
export async function chooseSetting(page: Page, name: string) {
  await openSettings(page);
  const item = page
    .getByRole("menuitem", { name, exact: true })
    .or(page.getByRole("menuitemcheckbox", { name, exact: true }));
  await item.click();
}
export async function enableDeveloperView(page: Page) {
  await page.addInitScript(() => localStorage.setItem("nekomimi:developer-view", "1"));
}
export async function openSessionMenu(page: Page, item?: string) {
  await page.getByRole("button", { name: "会话操作", exact: true }).click();
  if (item) await page.getByRole("menuitem", { name: item }).click();
}
export async function openDetails(page: Page, tab: "变更" | "文件" | "证据" = "变更") {
  await page.getByRole("button", { name: /^变更/ }).click();
  if (tab !== "变更") await page.getByRole("tab", { name: tab }).click();
  await expect(page.getByRole("complementary", { name: "详情" })).toBeVisible();
}
/** Collect CSP violations caused by host resources only (browser-extension injections are ignored). */
export async function collectCspViolations(page: Page) {
  await page.addInitScript(() => {
    (window as any).__csp = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      const source = (event as SecurityPolicyViolationEvent).sourceFile;
      if (!source || source.startsWith(location.origin))
        (window as any).__csp.push(`${(event as SecurityPolicyViolationEvent).violatedDirective} ${source}:${(event as SecurityPolicyViolationEvent).lineNumber}`);
    });
  });
  return () => page.evaluate(() => (window as any).__csp as string[]);
}
export const internalTerms = ["WORK MODE", "CREATE MODE", "INSPECTOR", "WORKSPACE", "CANDIDATE", "投影", "可靠状态", "idle", "宿主"];
export async function expectNoInternalTerms(page: Page) {
  const text = await page.locator("body").innerText();
  for (const term of internalTerms) expect(text, `默认视图出现内部术语：${term}`).not.toContain(term);
}

/** 新建任务：默认一键创建；提供标题时先展开“命名后创建”。 */
export async function createTask(page: Page, title?: string) {
  if (title !== undefined) {
    const summary = page.getByText("命名后创建", { exact: true });
    const details = page.locator("details", { has: summary });
    if ((await details.getAttribute("open")) === null) await summary.click();
    await page.getByLabel("新会话标题").fill(title);
  }
  await page.getByRole("button", { name: "+ 新任务", exact: true }).click();
}

const pagePaths: Record<string, string> = {
  "基础设置": "settings",
  "模型用途与配置": "models",
  "主题与外观": "themes",
  "能力与权限": "resources",
  "MCP 连接与授权": "mcp",
  "能力包管理": "packages",
  "面板管理": "panels",
  "持久工作流管理": "workflows",
};
/** 管理入口迁移：通过设置总览到达管理页（link 名称匹配标题）。 */
export async function gotoManagement(page: Page, title: string) {
  const trigger = await openSettings(page);
  await page.getByRole("menuitem", { name: /^全部设置/ }).click();
  await page.getByRole("link", { name: new RegExp(`^${title}`) }).first().click();
  await trigger; // 保留触发器语义（焦点在导航后由页面接管）
  void pagePaths;
}

/** 幂等设置开发者视图：直接写偏好并派发 storage 事件，不依赖菜单开关状态。 */
export async function setDeveloperView(page: Page, enabled: boolean) {
  await page.evaluate((next) => {
    if (next) localStorage.setItem("nekomimi:developer-view", "1");
    else localStorage.removeItem("nekomimi:developer-view");
    window.dispatchEvent(new StorageEvent("storage", { key: "nekomimi:developer-view" }));
  }, enabled);
}

/** 打开调用证据：会话 `…` 菜单入口（默认视图下头部不再常驻“调用证据”）。 */
export async function openEvidence(page: Page) {
  await openSessionMenu(page, "调用证据");
}
/** 打开详情抽屉并切到指定标签（抽屉收起时先打开）。 */
export async function openDrawerTab(page: Page, tab: "变更" | "文件" | "证据") {
  const tabLocator = page.getByRole("tab", { name: tab, exact: true });
  // 等待会话头部或 /work 首页就绪，避免会话尚未加载时误判入口不存在
  const changes = page.getByRole("button", { name: "变更", exact: true });
  const details = page.getByRole("button", { name: "详情", exact: true });
  await expect(changes.or(details).or(tabLocator).first()).toBeVisible();
  if (!(await tabLocator.isVisible())) {
    if (await changes.isVisible()) await changes.click();
    else await details.click();
  }
  await tabLocator.click();
}
