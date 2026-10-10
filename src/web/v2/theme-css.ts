import { normalizeColor } from '../../shared/color.js';
import { validateTheme, type BuiltTheme } from '../../customization/ui-contract.js';
/** Only declared values map to current semantic tokens; never accepts plugin selectors or CSS. */
export function workbenchThemeCss(theme: BuiltTheme): string {
  const {assetsData,resourceId:_resourceId,revision:_revision,...definition}=theme as BuiltTheme & {resourceId?:string;revision?:string};validateTheme(definition);
  for(const [kind,data] of Object.entries(assetsData??{}))if(!['font','background'].includes(kind)||!new RegExp(`^data:${kind==='font'?'font/(woff2?|ttf|otf)':'image/(png|webp|jpeg)'};base64,[A-Za-z0-9+/=]+$`).test(data))throw Error('主题素材格式不受支持');
  const values:Record<string,string>={},rules:string[]=[];
  const selector=':root[data-theme][data-workbench-theme]';
  const colors:Record<string,string[]>={background:['surface'],surface:['panel'],foreground:['ink'],muted:['muted'],accent:['brand','accent'],border:['line'],userBubble:['theme-user-bubble'],assistantBubble:['theme-assistant-bubble']};
  for(const [name,value] of Object.entries(theme.colors??{}))for(const key of colors[name]!)values[`--${key}`]=normalizeColor(value);
  if(theme.colors?.accent){const c=normalizeColor(theme.colors.accent),rgb=[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);values['--on-brand']=rgb[0]!*.2126+rgb[1]!*.7152+rgb[2]!*.0722>.179?'#000000':'#ffffff';}
  const typography=theme.typography;
  if(typography){const family=assetsData?.font?'NekomimiWorkbenchTheme':typography.family;values['--theme-font']=`${family?`"${family}",`:''}${typography.fallback??'sans-serif'}`;rules.push(`${selector}{font-family:var(--theme-font);${typography.size?`font-size:${typography.size}px;`:''}${typography.weight?`font-weight:${typography.weight};`:''}${typography.lineHeight?`line-height:${typography.lineHeight};`:''}}`);}
  if(assetsData?.font)rules.push(`@font-face{font-family:NekomimiWorkbenchTheme;src:url("${assetsData.font}");font-display:swap}`);
  const scale=theme.spacing?.scale??(theme.density==='compact'?.85:undefined);
  if(scale!==undefined)values['--spacing']=`${.25*scale}rem`;
  if(theme.spacing?.controlPadding!==undefined)rules.push(`${selector} [data-slot=button],${selector} [data-slot=input],${selector} [data-slot=textarea],${selector} [data-slot=select]{height:auto;min-height:2.25rem;padding:${theme.spacing.controlPadding}px ${theme.spacing.controlPadding*1.5}px;}`);
  for(const [name,value] of Object.entries(theme.radii??{}))values[`--theme-${name}-radius`]=`${value}px`;
  if(theme.radii?.control!==undefined)rules.push(`${selector} [data-slot=button],${selector} [data-slot=input],${selector} [data-slot=textarea],${selector} [data-slot=select]{border-radius:var(--theme-control-radius);}`);
  if(theme.radii?.panel!==undefined)rules.push(`${selector} [data-slot=dialog-content]{border-radius:var(--theme-panel-radius);}`);
  if(theme.shadows)values['--shadow-soft']=values['--shadow-floating']=values['--theme-shadow']=({none:'none',soft:'0 3px 18px #0000000c',floating:'0 8px 26px #00000018'})[theme.shadows.preset??'soft'];
  if(assetsData?.background)rules.push(`${selector} .ds main{background-image:url("${assetsData.background}");background-size:cover;background-attachment:local;}`);
  if(theme.spacing||theme.density||theme.bubbles||theme.radii?.bubble!==undefined||theme.shadows||theme.colors?.userBubble||theme.colors?.assistantBubble)rules.push(`${selector} .ds [data-row-kind]{margin-block:${theme.spacing?.messageGap??(theme.density==='compact'?8:16)}px;}${selector} .ds [data-row-kind=user],${selector} .ds [data-row-kind=assistant]{max-width:${theme.bubbles?.maxWidth??100}%;padding:calc(12px * ${scale??1});border-radius:var(--theme-bubble-radius,12px);box-shadow:var(--theme-shadow,none);}${selector} .ds [data-row-kind=user]{background:var(--theme-user-bubble,var(--wash));margin-left:auto;}${selector} .ds [data-row-kind=assistant]{background:var(--theme-assistant-bubble,var(--surface));}`);
  if(theme.bubbles?.style==='plain')rules.push(`${selector} .ds [data-row-kind]{border-radius:0;box-shadow:none;}`);
  if(theme.bubbles?.style==='tail')rules.push(`${selector} .ds [data-row-kind=user]{border-bottom-right-radius:2px;}${selector} .ds [data-row-kind=assistant]{border-bottom-left-radius:2px;}`);
  if(theme.motion?.preset==='fade')rules.push(`@keyframes workbench-theme-fade{from{opacity:0}to{opacity:1}}${selector} .ds [data-row-kind]{animation:workbench-theme-fade ${theme.motion.duration??300}ms ease both;}`);
  if(theme.motion?.preset==='float')rules.push(`@keyframes workbench-theme-float{to{transform:translateY(-${theme.motion.intensity??2}px)}}${selector} .ds [data-theme-decoration]{animation:workbench-theme-float ${theme.motion.duration??300}ms ease-in-out infinite alternate;}`);
  rules.push(`@media(prefers-reduced-motion:reduce){${selector} *,${selector} *::before,${selector} *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}`);
  return `${selector}{${Object.entries(values).map(([name,value])=>`${name}:${value}`).join(';')}}${rules.join('')}`;
}
