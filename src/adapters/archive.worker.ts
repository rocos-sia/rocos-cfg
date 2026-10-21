import { inspectProjectArchive, saveProject } from '../core/project/archive';
import { inspectProjectRecovery } from '../core/project/recover';
import type { ArchiveRequest, ArchiveResponse } from './archive-protocol';
import { analyzeProject } from '../core/project/analysis';
import { validateProject } from '../core/validation';
import { planRuntime, prepareRuntime } from '../core/export';
import { errorMessage, messageFields, MessageError, m as msg } from '../core/project/messages';

// One job per worker. Termination can interrupt even synchronous ZIP/XML work.
const send=(message:ArchiveResponse)=>self.postMessage(message);
self.onmessage=async(event:MessageEvent<ArchiveRequest>)=>{
  const request=event.data,progress=(percent:number)=>send({type:'progress',percent});
  try{
    let result:ArchiveResponse & {type:'result'};
    switch(request.kind){
      case 'save':result={type:'result',result:await saveProject(request.project,request.version,undefined,progress)};break;
      case 'inspect':result={type:'result',result:await inspectProjectArchive(request.bytes,undefined,undefined,progress)};break;
      case 'recover':result={type:'result',result:await inspectProjectRecovery(request.bytes,undefined,undefined,request.version,progress)};break;
      case 'analyze':result={type:'result',result:analyzeProject(request.project,request.workspaceEpoch)};break;
      case 'validate':progress(10);result={type:'result',result:validateProject(request.project)};progress(100);break;
      case 'runtimeDirectory':{
        progress(10);const diagnostics=validateProject(request.project);progress(50);
        const prepared=diagnostics.some(d=>d.severity==='error')?undefined:{plan:planRuntime(request.project)};
        result={type:'result',result:{diagnostics,prepared}};progress(100);break;
      }
      case 'runtime':{
        progress(10);const diagnostics=validateProject(request.project);progress(50);
        const output=diagnostics.some(d=>d.severity==='error')?undefined:prepareRuntime(request.project);
        // The UI needs the ZIP and a reviewable file list, not a second copy of
        // every uncompressed mesh and attachment in the export plan.
        const prepared=output?{bytes:output.bytes,plan:{...output.plan,files:output.plan.files.map(file=>({path:file.path}))}}:undefined;
        result={type:'result',result:{diagnostics,prepared}};progress(100);break;
      }
      default:throw new MessageError(msg('不受支持的工程处理任务'));
    }
    send(result);
  }catch(error){send({type:'error',...messageFields(errorMessage(error))});}
};
