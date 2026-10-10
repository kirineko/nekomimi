import { Link } from "@tanstack/react-router";
import type { Mode } from "../shell";
import { managementPages, pageHref, type ManagementPageInfo } from "../management-pages";

export function SettingsHubPage({ mode, sessionId }: { mode: Mode; sessionId?: string }) {
  const groups = new Map<string, ManagementPageInfo[]>();
  for (const page of managementPages) {
    if (!page.modes.includes(mode)) continue;
    const list = groups.get(page.group) ?? [];
    list.push(page);
    groups.set(page.group, list);
  }
  return (
    <section aria-labelledby="settings-hub-title" className="max-w-3xl space-y-6">
      <h1 id="settings-hub-title">设置</h1>
      {[...groups.entries()].map(([group, pages]) => (
        <section key={group} aria-label={group} className="space-y-2">
          <h2 className="text-sm text-muted">{group}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {pages.map((page) => (
              <li key={page.id}>
                <Link
                  to={pageHref(mode, page, sessionId) as never}
                  className="block rounded-xl border border-line bg-background p-4 hover:border-brand focus-visible:border-brand"
                >
                  <span className="block font-semibold">{page.title}</span>
                  <span className="block text-xs text-muted">{page.hint}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
