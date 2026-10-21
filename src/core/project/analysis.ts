import { m as msg, MessageError, errorMessage, messageFields, type MessageTemplate } from './messages';
import { buildBusCatalog } from '../bus/catalog';
import { controlChainFromRobot, readRobot, type RobotJoint, type RobotModel } from '../documents/urdf';
import { appDocument } from '../documents/app-config';
import { fileById, textOf, type BusCatalog, type Project } from './types';

export interface ProjectAnalysis {
  projectId:string;revision:number;workspaceEpoch:number;
  catalog:BusCatalog;robot?:RobotModel;robotError?:string;robotErrorText?:MessageTemplate;
  chain:RobotJoint[];chainError?:string;chainErrorText?:MessageTemplate;
}
// Do not copy meshes, attachments, archive metadata, or unsaved source buffers
// merely to derive bus/model views. Views represent committed document bytes.
export function analysisInput(p:Project):Project {
  const ids=new Set([p.entrypoints.master.fileId,p.entrypoints.master.eniFileId,p.entrypoints.urdf,p.entrypoints.app,p.targets.master.profile?.fileId,p.targets.app.profile?.fileId]);
  return {id:p.id,revision:p.revision,snapshotId:p.snapshotId,name:p.name,description:'',createdAt:p.createdAt,modifiedAt:p.modifiedAt,
    entrypoints:p.entrypoints,targets:p.targets,files:p.files.filter(file=>ids.has(file.id)),
    packageMap:{},references:[],editor:{buffers:{},confirmations:{}}};
}
export function sameAnalysisInput(a:Project,b:Project):boolean {
  if(a.id!==b.id||JSON.stringify(a.entrypoints)!==JSON.stringify(b.entrypoints)||JSON.stringify(a.targets)!==JSON.stringify(b.targets)||a.files.length!==b.files.length)return false;
  return a.files.every((file,index)=>{
    const other=b.files[index];
    return file.id===other.id&&file.path===other.path&&file.role===other.role&&file.owner===other.owner&&file.encoding===other.encoding&&
      file.bytes.length===other.bytes.length&&(file.bytes===other.bytes||file.bytes.every((byte,i)=>byte===other.bytes[i]));
  });
}
export function analyzeProject(p:Project,workspaceEpoch:number):ProjectAnalysis {
  const result:ProjectAnalysis={projectId:p.id,revision:p.revision,workspaceEpoch,catalog:buildBusCatalog(p),chain:[]};
  const urdf=fileById(p,p.entrypoints.urdf),app=fileById(p,p.entrypoints.app);
  if(urdf)try{
    const {doc:_,...robot}=readRobot(textOf(urdf));result.robot=robot;
  }catch(error){const fields=messageFields(errorMessage(error));result.robotError=fields.message;if(fields.text)result.robotErrorText=fields.text;}
  try{
    if(!urdf||!app)throw new MessageError(msg("请先配置 APP 与 URDF"));
    if(!result.robot)throw new MessageError(result.robotError?{message:result.robotError,text:result.robotErrorText}:msg('URDF 无法解析'));
    const startup=appDocument(app).data?.robot;
    result.chain=controlChainFromRobot(result.robot,startup?.base_link,startup?.tip_link);
  }catch(error){const fields=messageFields(errorMessage(error));result.chainError=fields.message;if(fields.text)result.chainErrorText=fields.text;}
  return result;
}
