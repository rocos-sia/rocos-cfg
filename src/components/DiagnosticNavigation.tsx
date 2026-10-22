import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import type { Diagnostic } from '../core/project/types';
import type { DiagnosticLocation } from '../core/diagnostics/location';

export interface DiagnosticRequest extends DiagnosticLocation { issue:Diagnostic; request:number; projectId:string; revision:number; epoch:number; source:string; editorText:string; draft:boolean }
export const DiagnosticContext=createContext<DiagnosticRequest|undefined>(undefined);
export const useDiagnosticRequest=()=>useContext(DiagnosticContext);

/** Focus once per explicit navigation; locale/theme renders never steal focus. */
export function DiagnosticField({fileId,field,mode='field',className,children}:{fileId:string;field:string;mode?:'field'|'resource';className?:string;children:ReactNode}) {
  const request=useDiagnosticRequest(),host=useRef<HTMLDivElement>(null);
  const matches=request?.mode===mode&&request.fileId===fileId&&request.field===field;
  useEffect(()=>{
    if(!matches)return;
    const element=host.current,target=element?.querySelector<HTMLElement>('input:not([type=hidden]),textarea,[role=switch],button');
    if(!element||!target)return;
    element.scrollIntoView({block:'center',inline:'nearest'});target.focus({preventScroll:true});
  },[matches,request?.request]);
  return <div ref={host} className={className} data-config-file={fileId} data-config-field={field} data-diagnostic-target={matches?'true':undefined}>{children}</div>;
}
