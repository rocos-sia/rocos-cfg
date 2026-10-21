import { useLocalizedMessage } from './useLocalizedMessage';
import { errorText, t } from '../i18n';
import { appDocument } from '../core/documents/app-config';
import { ecmDocument } from '../core/bus/ecm';
import { hardwareDocument, bindingDocument } from '../core/hardware/schema';
import { Input, InputNumber, Select, Switch } from 'antd';
import { useProject } from '../store';
import { readYaml } from '../core/documents/yaml';
import { textOf, type ProjectFile } from '../core/project/types';
export interface FieldSpec { path:string; label:string; type?:'number'|'boolean'|'select'|'text'; options?:string[]; unit?:string; min?:number; max?:number; help?:string; defaultValue?:unknown }
export function Fields({file,fields}:{file:ProjectFile;fields:FieldSpec[]}) {
  const message=useLocalizedMessage();let data:any;try{data=file.role==='app'?appDocument(file).data:file.role==='ecm'?ecmDocument(file).data:file.role==='hardware'?hardwareDocument(file).data:file.role==='binding'?bindingDocument(file).data:readYaml(textOf(file));}catch{return <p>{t("源码解析失败，请在文件编辑器修复。")}</p>;}
  const update=(path:string,value:unknown)=>{try{useProject.getState().yaml(file.id,path.split('.').map(k=>/^\d+$/.test(k)?Number(k):k),value);}catch(e){message.error(()=>(errorText(e,true)));}};
  return <div className="fields">{fields.map(field=>{
    const stored=field.path.split('.').reduce((o:any,k)=>o?.[k],data);const value=stored===undefined?field.defaultValue:stored;const id=file.id+field.path;
    return <div className="field" key={id}><label htmlFor={id}>{t(field.label)}{field.unit&&<span className="unit">{field.unit}</span>}</label>{field.type==='boolean'?<Switch id={id} checked={!!value} onChange={v=>update(field.path,v)}/>:field.type==='select'?<Select id={id} value={value} options={field.options?.map(v=>({label:v,value:v}))} onChange={v=>update(field.path,v)}/>:field.type==='number'?<InputNumber id={id} value={value==null||!Number.isFinite(Number(value))?null:Number(value)} min={field.min} max={field.max} onChange={v=>update(field.path,v)}/>:<Input id={id} key={String(value)} defaultValue={value??''} onBlur={e=>{if(e.target.value!==String(value??''))update(field.path,e.target.value);}}/>}{field.help&&<small>{t(field.help)}</small>}</div>;
  })}</div>;
}
