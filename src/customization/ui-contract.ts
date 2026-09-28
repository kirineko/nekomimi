import { normalizeColor } from '../shared/color.js';
/** JSON-only runtime UI contracts; safe to import in browser bundles. */
export const UI_SLOTS = ['session-header', 'message-content', 'tool-result', 'composer-toolbar', 'sidebar-widget', 'page'] as const;
export const UI_ACTIONS = ['draft.set', 'command.run', 'session.navigate', 'view.open', 'state.read', 'state.subscribe'] as const;
export type UiSlot = typeof UI_SLOTS[number];
export type UiAction = typeof UI_ACTIONS[number];
export interface ThemeDefinition {
  id: string;
  title: string;
  typography?: { family?: string; fallback?: 'sans-serif' | 'serif' | 'monospace'; size?: number; weight?: number; lineHeight?: number; font?: string };
  /** Literal hex RGB/RGBA, rgb/rgba, hsl/hsla or transparent. No contrast threshold or automatic recoloring. */
  colors?: Partial<Record<'background' | 'surface' | 'foreground' | 'muted' | 'accent' | 'border' | 'userBubble' | 'assistantBubble', string>>;
  spacing?: { scale?: number; messageGap?: number; controlPadding?: number };
  radii?: { control?: number; bubble?: number; panel?: number };
  shadows?: { preset?: 'none' | 'soft' | 'floating' };
  bubbles?: { style?: 'plain' | 'rounded' | 'tail'; maxWidth?: number };
  assets?: { background?: string };
  motion?: { preset?: 'none' | 'fade' | 'float'; duration?: number; intensity?: number };
  density?: 'compact' | 'comfortable';
}
export interface ViewOptions {
  title: string;
  order?: number;
  match?: { tool?: string; role?: 'assistant' | 'user' };
}
const id = /^[a-z][a-z0-9_-]{0,47}$/;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function keys(v: unknown, allowed: string[], name: string): asserts v is Record<string, unknown> {
  if (!object(v) || Object.keys(v).some(k => !allowed.includes(k))) throw new Error(`Invalid ${name} fields`);
}
function number(v: unknown, min: number, max: number, name: string) {
  if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)) throw new Error(`Invalid ${name} range`);
}
function choice(v: unknown, choices: string[], name: string) {
  if (v !== undefined && !choices.includes(v as string)) throw new Error(`Invalid ${name}`);
}
export function assetPath(v: unknown): asserts v is string {
  if (typeof v !== 'string' || v.length > 240 || !/^[a-zA-Z0-9_./-]+$/.test(v) || v.startsWith('/') || v.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Invalid UI asset path');
}
export function validateTheme(value: ThemeDefinition): void {
  keys(value, ['id','title','typography','colors','spacing','radii','shadows','bubbles','assets','motion','density'], 'theme');
  if (!id.test(value.id) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 80) throw new Error('Invalid theme identity');
  const t = value.typography;
  if (t) {
    keys(t, ['family','fallback','size','weight','lineHeight','font'], 'typography');
    if (t.family !== undefined && (typeof t.family !== 'string' || !/^[\p{L}\p{N} _-]{1,64}$/u.test(t.family))) throw new Error('Invalid font family');
    choice(t.fallback, ['sans-serif','serif','monospace'], 'font fallback');
    number(t.size, 12, 24, 'font size'); number(t.weight, 300, 800, 'font weight'); number(t.lineHeight, 1.2, 2.2, 'line height');
    if (t.font !== undefined) {assetPath(t.font); if (!/\.woff2?$/.test(t.font)) throw new Error('Invalid font asset');}
  }
  if (value.colors) {keys(value.colors, ['background','surface','foreground','muted','accent','border','userBubble','assistantBubble'], 'colors'); for (const [field, color] of Object.entries(value.colors)) { try { normalizeColor(color); } catch { throw new Error(`Invalid theme color: ${field}`); } }}
  if (value.spacing) {keys(value.spacing,['scale','messageGap','controlPadding'],'spacing');number(value.spacing.scale,.75,1.5,'spacing');number(value.spacing.messageGap,4,48,'message gap');number(value.spacing.controlPadding,6,20,'padding');}
  if (value.radii) {keys(value.radii,['control','bubble','panel'],'radii');for (const v of Object.values(value.radii)) number(v,0,32,'radius');}
  if (value.shadows) {keys(value.shadows,['preset'],'shadows');choice(value.shadows.preset,['none','soft','floating'],'shadow');}
  if (value.bubbles) {keys(value.bubbles,['style','maxWidth'],'bubbles');choice(value.bubbles.style,['plain','rounded','tail'],'bubble');number(value.bubbles.maxWidth,55,100,'bubble width');}
  if (value.assets) {keys(value.assets,['background'],'assets');if(value.assets.background!==undefined){assetPath(value.assets.background);if(!/\.(png|webp|jpg|jpeg)$/.test(value.assets.background))throw new Error('Invalid background asset');}}
  if (value.motion) {keys(value.motion,['preset','duration','intensity'],'motion');choice(value.motion.preset,['none','fade','float'],'motion');number(value.motion.duration,100,4000,'motion duration');number(value.motion.intensity,0,8,'motion intensity');}
  choice(value.density,['compact','comfortable'],'density');
  for (const name of ['typography','colors','spacing','radii','shadows','bubbles','assets','motion'] as const) if (value[name] !== undefined && !object(value[name])) throw new Error(`Invalid ${name}`);
}
export function validateView(view: ViewOptions): void {
  if (typeof view.title !== 'string' || !view.title.trim() || view.title.length > 80) throw new Error('Invalid view title');
  number(view.order, -1000, 1000, 'view order');
  if (view.match) {keys(view.match,['tool','role'],'view match'); if(view.match.tool!==undefined&&!/^[a-z][a-z0-9_-]{0,79}$/.test(view.match.tool))throw new Error('Invalid view tool');choice(view.match.role,['assistant','user'],'view role');}
}

export interface BuiltTheme extends ThemeDefinition { assetsData?: {font?: string; background?: string} }
export interface ThemeSelection {resourceId:string;revision:string;id:string}
export interface ThemePreference {version:1;revision:number;selection?:ThemeSelection|null}
