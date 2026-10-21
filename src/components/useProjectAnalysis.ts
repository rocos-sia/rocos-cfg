import { useEffect, useMemo, useRef, useState } from 'react';
import { runArchiveTask } from '../adapters/archive-tasks';
import { analysisInput, analyzeProject, sameAnalysisInput, type ProjectAnalysis } from '../core/project/analysis';
import type { Project } from '../core/project/types';

// Small inputs avoid worker startup overhead. Large XML documents never enter
// the synchronous view parser. The threshold refers only to analysis inputs.
export const ANALYSIS_WORKER_THRESHOLD=256*1024;
export function useProjectAnalysis(project:Project|null,workspaceEpoch:number){
  const previous=useRef<{input:Project;epoch:number}|undefined>(undefined);
  const input=useMemo(()=>{
    if(!project){previous.current=undefined;return undefined;}
    const next=analysisInput(project),prior=previous.current;
    // A source buffer edit or metadata change must not unmount its editor.
    // Reuse is allowed only after every parser input is proven unchanged.
    if(prior&&prior.epoch===workspaceEpoch&&sameAnalysisInput(prior.input,next))return prior.input;
    previous.current={input:next,epoch:workspaceEpoch};return next;
  },[project,workspaceEpoch]);
  const large=!!input&&input.files.reduce((total,file)=>total+file.bytes.length,0)>ANALYSIS_WORKER_THRESHOLD;
  const small=useMemo(()=>input&&!large?analyzeProject(input,workspaceEpoch):undefined,[input,large,workspaceEpoch]);
  const [attempt,setAttempt]=useState(0);
  const [state,setState]=useState<{input:Project;epoch:number;result?:ProjectAnalysis;error?:string}>();
  useEffect(()=>{
    if(!input||!large)return;
    const controller=new AbortController();
    void runArchiveTask({kind:'analyze',project:input,workspaceEpoch},{signal:controller.signal}).then(result=>{
      if(controller.signal.aborted)return;
      if(result.projectId!==input.id||result.revision!==input.revision||result.workspaceEpoch!==workspaceEpoch){setState({input,epoch:workspaceEpoch,error:'解析结果对应的工程版本不一致，请重新解析'});return;}
      setState({input,epoch:workspaceEpoch,result});
    }).catch(error=>{if(!controller.signal.aborted)setState({input,epoch:workspaceEpoch,error:error instanceof Error?error.message:String(error)});});
    return()=>controller.abort();
  },[input,large,workspaceEpoch,attempt]);
  // A render may precede effect cleanup. Never expose the old input's result,
  // including when the UUID and revision happen to match a different session.
  const current=state&&state.input===input&&state.epoch===workspaceEpoch?state:undefined;
  const result=small||current?.result;
  // The view can be associated with a newer revision only because the input
  // comparison above proved the complete parsed document set is unchanged.
  const data=useMemo(()=>result&&project?{...result,revision:project.revision}:undefined,[result,project?.revision]);
  return {data,pending:!!input&&large&&!current,error:current?.error,
    retry:()=>{setState(undefined);setAttempt(value=>value+1);}};
}
