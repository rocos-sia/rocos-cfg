import { useSyncExternalStore } from 'react';
import english from './en.json';
export type Locale = 'zh-CN' | 'en-US';
const messages:Record<string,string>=english;
const listeners=new Set<()=>void>();
let locale:Locale='zh-CN';
try{if(globalThis.localStorage?.getItem('rocos-locale')==='en-US')locale='en-US';}catch{/* Preferences are optional when storage is unavailable. */}
export const getLocale=()=>locale;
export function setLocale(next:Locale){
  if(next===locale)return;
  locale=next;
  try{globalThis.localStorage?.setItem('rocos-locale',next);}catch{/* Keep the session preference. */}
  for(const listener of listeners)listener();
}
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const useLocale=()=>useSyncExternalStore(subscribe,getLocale,()=> 'zh-CN' as Locale);
// Only explicitly marked UI messages are translated. Configuration names,
// paths, source buffers and interpolated values never pass through the catalog.
export function t(source:string,values:Record<string,string|number>={}){
  const template=locale==='en-US'&&Object.hasOwn(messages,source)?messages[source]:source;
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(token,key)=>Object.hasOwn(values,key)?String(values[key]):token);
}
export function persistenceText(status:string){
  const suffix='；草稿缓存失败';
  return status.endsWith(suffix)?t(status.slice(0,-suffix.length))+t(suffix):t(status);
}
