import { Component, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Button } from '../ui/Button';

class LoadBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Each optional entry shares successful imports. A failed native import needs a
 * fresh URL on explicit retry; late results only populate the cache, never open UI. */
export function deferred<P extends object>(entry: string, name: string, label: string, load: () => Promise<ComponentType<P>>) {
  let component: ComponentType<P> | undefined;
  let pending: Promise<ComponentType<P>> | undefined;
  let attempts = 0;
  async function retryImport() {
    let path = `/${entry}`;
    if (!import.meta.env.DEV) {
      const response = await fetch('/assets/asset-manifest.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('资源目录不可用');
      const manifest = await response.json() as Record<string, { file: string }>;
      const file = manifest[entry]?.file;
      if (!file || !/^assets\/[a-zA-Z0-9_.-]+\.js$/.test(file)) throw new Error('资源入口不可用');
      path = `/${file}`;
    }
    const url = new URL(path, location.origin);
    url.searchParams.set('retry', String(attempts));
    const module = await import(/* @vite-ignore */ url.href);
    if (typeof module[name] !== 'function') throw new Error('界面不可用');
    return module[name] as ComponentType<P>;
  }
  function resolve() {
    if (component) return Promise.resolve(component);
    if (pending) return pending;
    pending = (attempts++ ? retryImport() : load()).then(value => {
      component = value;
      pending = undefined;
      return value;
    }, error => { pending = undefined; throw error; });
    return pending;
  }
  return function Deferred({ loadClose, ...props }: P & { loadClose?: () => void }) {
    const navigate = useNavigate();
    const { sessionId } = useParams({ strict: false });
    const [version, setVersion] = useState(0);
    const [loaded, setLoaded] = useState(() => component);
    const [error, setError] = useState(false);
    useEffect(() => {
      let live = true;
      resolve().then(value => { if (live) setLoaded(() => value); }, () => { if (live) setError(true); });
      return () => { live = false; };
    }, [version]);
    const close = loadClose ?? (() => {
      const create = location.pathname.includes('/create');
      if (sessionId) void navigate({ to: create ? '/create/session/$sessionId' : '/work/session/$sessionId', params: { sessionId } });
      else void navigate({ to: create ? '/create' : '/work' });
    });
    const retry = () => { component = undefined; setLoaded(undefined); setError(false); setVersion(value => value + 1); };
    const feedback = (failed: boolean) => <section className="space-y-3 rounded-lg border border-line bg-panel p-4 text-sm" aria-label={`${label}加载`}>
      <p role={failed ? 'alert' : 'status'}>{failed ? `${label}加载失败，请重试。` : `正在加载${label}…`}</p>
      <div className="flex gap-2">{failed && <Button size="sm" onClick={retry}>重试加载</Button>}<Button size="sm" variant="outline" onClick={close}>关闭加载</Button></div>
    </section>;
    const Loaded = loaded;
    return Loaded ? <LoadBoundary key={version} fallback={feedback(true)}><Loaded {...props as P} /></LoadBoundary> : feedback(error);
  };
}
