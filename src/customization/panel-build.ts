import { build } from "esbuild";
import { realpath, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, extname } from "node:path";
import { createRequire } from "node:module";
import { hash } from "../journal.js";
import { safePath, LIMITS, type Resource } from "./resources.js";
import type { PanelDefinition } from "./contracts.js";
export interface BuiltPanel extends PanelDefinition { resource: Resource; bundle: string; css: string; bundleHash: string }
export function validatePanel(panel: PanelDefinition) {
  if (!panel || !/^[a-z][a-z0-9_-]{0,47}$/.test(panel.id) || panel.uiVersion !== 1 || !["sidebar", "result"].includes(panel.slot) || typeof panel.entry !== "string" || !/\.[cm]?[jt]sx?$/.test(panel.entry) || !panel.propsSchema || panel.propsSchema.type !== "object" || !Array.isArray(panel.actions) || panel.actions.length > 3 || new Set(panel.actions).size !== panel.actions.length || panel.actions.some(a => !["workflow.state", "workflow.answer", "workflow.cancel"].includes(a)) || typeof panel.fallback !== "string" || !panel.fallback.trim() || panel.fallback.length > 4000) throw new Error("Invalid panel descriptor");
  if (panel.renderer !== undefined && !/^[a-z][a-z0-9_-]{0,79}$/.test(panel.renderer)) throw new Error("Invalid renderer tool name");
  if (panel.themes && (Object.keys(panel.themes).length > 8 || Object.keys(panel.themes).some(name=>!/^[a-z][a-z0-9-]{0,31}$/.test(name)))) throw new Error("Invalid panel theme choices");
  for (const tokens of [panel.theme, ...Object.values(panel.themes ?? {})]) if(tokens) for (const [name, value] of Object.entries(tokens)) if (!["background", "foreground", "accent", "border"].includes(name) || !/^#[a-f0-9]{6}$/i.test(value)) throw new Error("Invalid panel theme token");
}
/** Only the fixed esbuild API and immutable local inputs; no config files or hooks. */
export async function buildPanel(resource: Resource, panel: PanelDefinition): Promise<BuiltPanel> {
  validatePanel(panel);
  const root = await realpath(resource.root), entry = await safePath(root, panel.entry);
  let bytes = 0, count = 0;
  const result = await build({ entryPoints: [entry], absWorkingDir: root, bundle: true, write: false, outdir: 'panel-output', platform: 'browser', format: 'iife', globalName: 'NekomimiPanel', target: ['es2022'], minify: true, sourcemap: false, legalComments: 'none', logLevel: 'silent', metafile: true, tsconfigRaw: {compilerOptions:{jsx:'react-jsx'}}, define: {'process.env.NODE_ENV':'"production"'}, plugins: [{name:'bounded-local-inputs', setup(builder) {
    builder.onResolve({filter:/.*/}, async args => {
      if (args.path.startsWith('node:') || (!isAbsolute(args.path) && /^[a-z][a-z0-9+.-]*:/i.test(args.path))) throw new Error('Panel external imports prohibited');
      const candidate = args.kind === 'entry-point' || isAbsolute(args.path) ? args.path : args.path.startsWith('.') ? resolve(args.resolveDir, args.path) : createRequire(resolve(args.resolveDir, 'package.json')).resolve(args.path);
      let path: string | undefined;
      for (const suffix of ['', '.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.tsx', '/index.js']) {
        try {const found = await realpath(candidate + suffix);if((await stat(found)).isFile()){path=found;break;}} catch {}
      }
      if (!path || relative(root, path).startsWith('..') || isAbsolute(relative(root, path))) throw new Error('Panel dependency outside immutable package');
      return {path};
    });
    builder.onLoad({filter:/.*/}, async args => {
      if (++count > 512) throw new Error('Panel module count limit');
      const content = await readFile(args.path); bytes += content.length;
      const name = relative(root, args.path).split('\\').join('/');
      const expected = resource.fileHashes?.[name] ?? (resource.files?.[name] === undefined ? undefined : hash(resource.files[name]));
      if (!expected || hash(content) !== expected) throw new Error('Panel immutable input integrity mismatch');
      if (content.length > LIMITS.file || bytes > 16 * LIMITS.file) throw new Error('Panel source size limit');
      const ext = extname(args.path).slice(1);
      const loader = ({ts:'ts',tsx:'tsx',js:'js',jsx:'jsx',mjs:'js',cjs:'js',json:'json',css:'css',svg:'dataurl',png:'dataurl',jpg:'dataurl',webp:'dataurl',woff2:'dataurl'} as const)[ext as 'ts'];
      if (!loader) throw new Error('Unsupported panel asset');
      return {contents:content, loader};
    });
  }}]});
  const bundle = result.outputFiles.find(f=>f.path.endsWith('.js'))?.text ?? '', css = result.outputFiles.find(f=>f.path.endsWith('.css'))?.text ?? '';
  if (!bundle || Buffer.byteLength(bundle + css) > 2 * LIMITS.file) throw new Error('Panel bundle size limit');
  return {...panel,resource,bundle,css,bundleHash:hash(bundle+'\n'+css)};
}
