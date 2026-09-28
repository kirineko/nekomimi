import {normalizeColor} from '../shared/color';
import type {BuiltTheme} from '../customization/ui-contract';
export function themeCss(t:BuiltTheme):string {
 const c=t.colors??{},ty=t.typography??{},s=t.spacing??{},r=t.radii??{};
 const vars:Record<string,string>={};
 for(const [name,value] of Object.entries(c)) {const key:Record<string,string>={background:'canvas',surface:'surface',foreground:'ink',muted:'muted',accent:'accent',border:'line',userBubble:'ui-user-bubble',assistantBubble:'ui-assistant-bubble'};vars[`--${key[name]}`]=normalizeColor(value);}
 const accent=normalizeColor(c.accent??'#7952ce');
 const channels=[1,3,5].map(i=>parseInt(accent.slice(i,i+2),16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
 const luminance=channels[0]!*0.2126+channels[1]!*0.7152+channels[2]!*0.0722;
 vars['--ui-on-accent']=luminance>.179?'#000000':'#ffffff';
 const font=t.assetsData?.font?'NekomimiTheme':ty.family;
 vars['--ui-font']=`${font?`"${font}",`:''}${ty.fallback??'sans-serif'}`;
 vars['--ui-size']=`${ty.size??14}px`;vars['--ui-weight']=`${ty.weight??400}`;vars['--ui-leading']=`${ty.lineHeight??1.65}`;
 vars['--ui-scale']=`${s.scale??(t.density==='compact'?.85:1)}`;vars['--ui-gap']=`${s.messageGap??(t.density==='compact'?8:16)}px`;
 vars['--ui-padding']=`${s.controlPadding??8}px`;
 for(const key of ['control','bubble','panel'] as const)vars[`--ui-${key}-radius`]=`${r[key]??(key==='bubble'?18:10)}px`;
 vars['--ui-bubble-width']=`${t.bubbles?.maxWidth??90}%`;
 vars['--ui-shadow']=({none:'none',soft:'0 3px 18px #0000000c',floating:'0 8px 26px #00000018'})[t.shadows?.preset??'soft'];
 vars['--ui-background']=t.assetsData?.background?`url("${t.assetsData.background}")`:'none';
 vars['--ui-duration']=`${t.motion?.duration??300}ms`;vars['--ui-motion-distance']=`${t.motion?.intensity??2}px`;
 return `${t.assetsData?.font?`@font-face{font-family:NekomimiTheme;src:url("${t.assetsData.font}");font-display:swap}`:''}:root{${Object.entries(vars).map(([k,v])=>`${k}:${v}`).join(';')}}`;
}

let panelFontData:string|undefined;
export function setPanelFontData(value:string|undefined){panelFontData=value;}
/** Read after the host sheet has been applied, including when a panel mounts later. */
export function currentPanelTheme(){
 const style=getComputedStyle(document.documentElement),size=parseFloat(style.fontSize);
 const leading=parseFloat(style.lineHeight)/size;
 return {background:style.getPropertyValue('--surface').trim(),foreground:style.getPropertyValue('--ink').trim(),accent:style.getPropertyValue('--accent').trim(),border:style.getPropertyValue('--line').trim(),
  typography:{family:style.fontFamily,size:Number.isFinite(size)?size:14,weight:parseInt(style.fontWeight)||400,lineHeight:Number.isFinite(leading)?leading:1.65},fontData:panelFontData};
}
