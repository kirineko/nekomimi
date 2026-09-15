import { useEffect, useRef, useState } from "react";
import { api } from "../api";
interface Entry {
  path: string;
  name: string;
  type: "file" | "directory" | "unavailable";
}
interface Page {
  entries: Entry[];
  next?: string;
}
export function FileBrowser({
  revision,
  locate,
  workspace,
  locateRevision = 0,
}: {
  revision: number;
  locate?: string;
  workspace: string;
  locateRevision?: number;
}) {
  const [hidden, setHidden] = useState(false);
  const [pages, setPages] = useState<Record<string, Page>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["."]));
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const opening = useRef(false);
  const generation = useRef(0);
  const control = useRef(new AbortController());
  const load = async (
    path: string,
    cursor?: string,
    signal = control.current.signal,
    version = generation.current,
  ) => {
    try {
      const p = await api<Page>(
        `/workspace/files?path=${encodeURIComponent(path)}&hidden=${hidden}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        undefined,
        signal,
      );
      if (!signal.aborted && version === generation.current)
        setPages((old) => ({
          ...old,
          [path]: {
            ...p,
            entries: cursor
              ? [
                  ...new Map(
                    [...(old[path]?.entries ?? []), ...p.entries].map((e) => [
                      e.path,
                      e,
                    ]),
                  ).values(),
                ]
              : p.entries,
          },
        }));
    } catch (e) {
      if (!signal.aborted && version === generation.current)
        setError(String(e));
    }
  };
  useEffect(() => {
    control.current.abort();
    control.current = new AbortController();
    generation.current++;
    setPages({});
    setError("");
    const abort = control.current;
    const version = generation.current;
    if (!target) for (const path of expanded) void load(path);
    else
      void (async () => {
        try {
          const parts = target.split("/");
          const dirs = [
            ".",
            ...parts
              .slice(0, -1)
              .map((_, i) => parts.slice(0, i + 1).join("/")),
          ];
          for (const dir of expanded)
            if (!dirs.includes(dir))
              void load(dir, undefined, abort.signal, version);
          for (let i = 0; i < dirs.length; i++) {
            const path = dirs[i]!;
            let cursor: string | undefined;
            const entries: Entry[] = [];
            let found = false;
            do {
              const p: Page = await api<Page>(
                `/workspace/files?path=${encodeURIComponent(path)}&hidden=${hidden}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
                undefined,
                abort.signal,
              );
              entries.push(...p.entries);
              cursor = p.next;
              found = entries.some((e) => e.name === parts[i]);
            } while (!found && cursor);
            if (abort.signal.aborted || generation.current !== version) return;
            setPages((old) => ({ ...old, [path]: { entries, next: cursor } }));
            if (!found)
              throw new Error("当前文件不存在或被隐藏，请刷新或检查显示设置");
          }
          setNotice(`已定位：${target}`);
        } catch (e) {
          if (!abort.signal.aborted) setError(String(e));
        }
      })();
    return () => control.current.abort();
  }, [hidden, refresh, revision, target]);
  useEffect(() => {
    if (!locate) return;
    const windows = /^[a-z]:/i.test(workspace);
    const normalized = windows ? locate.replace(/\\/g, "/") : locate,
      root = (windows ? workspace.replace(/\\/g, "/") : workspace).replace(
        /\/$/,
        "",
      );
    const path = normalized.startsWith(root + "/")
      ? normalized.slice(root.length + 1)
      : normalized;
    setSelected(path);
    setTarget(path);
    setHidden(true);
    const parts = path.split("/");
    const dirs = [
      ".",
      ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/")),
    ];
    setExpanded((old) => new Set([...old, ...dirs]));
    setRefresh((n) => n + 1);
    setNotice(`正在定位：${path}`);
  }, [locate, workspace, locateRevision]);
  const open = async (path: string) => {
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/workspace/open", { path });
      setNotice("已提交给本机默认程序");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      opening.current = false;
    }
  };
  const toggle = (path: string) => {
    setExpanded((old) => {
      const next = new Set(old);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
    if (!pages[path]) void load(path);
  };
  const render = (path: string, depth: number) => (
    <div
      role={depth ? "group" : "tree"}
      aria-label={depth ? undefined : "项目文件"}
    >
      {!pages[path] && <p className="panel-muted">加载目录…</p>}
      {pages[path]?.entries.map((e) => (
        <div key={e.path}>
          <button
            role="treeitem"
            aria-selected={selected === e.path}
            aria-expanded={
              e.type === "directory" ? expanded.has(e.path) : undefined
            }
            className={`file-entry ${selected === e.path ? "selected" : ""}`}
            style={{ paddingLeft: 12 + depth * 16 }}
            title={e.path}
            onClick={() => {
              setSelected(e.path);
              if (e.type === "directory") toggle(e.path);
            }}
            onDoubleClick={() => {
              if (e.type === "file") void open(e.path);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && e.type === "file") {
                event.preventDefault();
                void open(e.path);
              }
              if (
                event.key === "ArrowRight" &&
                e.type === "directory" &&
                !expanded.has(e.path)
              ) {
                event.preventDefault();
                toggle(e.path);
              }
              if (event.key === "ArrowLeft" && expanded.has(e.path)) {
                event.preventDefault();
                toggle(e.path);
              }
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const items = [
                  ...event.currentTarget
                    .closest('[role="tree"]')!
                    .querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
                ];
                const i = items.indexOf(event.currentTarget);
                items[
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : Math.max(
                          0,
                          Math.min(
                            items.length - 1,
                            i + (event.key === "ArrowDown" ? 1 : -1),
                          ),
                        )
                ]?.focus();
              }
            }}
          >
            <span aria-hidden="true">
              {e.type === "directory"
                ? expanded.has(e.path)
                  ? "▾"
                  : "▸"
                : e.type === "file"
                  ? "▤"
                  : "⊘"}
            </span>
            <span>{e.name}</span>
          </button>
          {e.type === "directory" &&
            expanded.has(e.path) &&
            render(e.path, depth + 1)}
        </div>
      ))}
      {pages[path]?.entries.length === 0 && (
        <p className="panel-muted">空目录</p>
      )}
      {pages[path]?.next && (
        <button onClick={() => void load(path, pages[path]?.next)}>
          加载更多文件
        </button>
      )}
    </div>
  );
  return (
    <section className="file-browser">
      <div className="panel-toolbar">
        <label>
          <input
            type="checkbox"
            checked={hidden}
            onChange={(e) => setHidden(e.target.checked)}
          />
          显示隐藏文件
        </label>
        <button onClick={() => setRefresh((n) => n + 1)}>刷新</button>
      </div>
      <p className="panel-muted">双击文件，用本机默认程序打开</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="panel-muted">
          {notice}
        </p>
      )}
      {render(".", 0)}
      {selected &&
        Object.values(pages).some((p) =>
          p.entries.some((e) => e.path === selected && e.type === "file"),
        ) && (
          <footer className="file-selection">
            <code>{selected}</code>
            <button disabled={busy} onClick={() => void open(selected)}>
              {busy ? "打开中…" : "用默认程序打开"}
            </button>
          </footer>
        )}
    </section>
  );
}
