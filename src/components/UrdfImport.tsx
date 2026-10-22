import { useRef, useState } from 'react';
import { Alert, Button, Modal, Select, Space } from 'antd';
import { findUrdfMeshes, urdfMeshNames } from '../adapters/urdf-import';
import { errorText, t } from '../i18n';
import { useProject } from '../store';
import { useLocalizedMessage } from './useLocalizedMessage';

export function useUrdfImport(selectFiles:(files:File[],matchUrdfMeshes?:boolean)=>Promise<void>) {
  const picker=useRef<HTMLInputElement>(null),folder=useRef<HTMLInputElement>(null),generation=useRef(0);
  const message=useLocalizedMessage();
  const [session,setSession]=useState<{file:File;names:string[];epoch:number;revision:number;groups?:{name:string;files:File[]}[];choices:Record<string,string>}>();
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const current=()=>session && useProject.getState().workspaceEpoch===session.epoch && useProject.getState().project?.revision===session.revision;
  const finish=async (files:File[])=>{
    if(!current()){setError(t('导入期间工程已变化，请重新选择文件'));return;}
    setBusy(true);await selectFiles(files,true);setBusy(false);setSession(undefined);
  };
  const dialog=<>
    <input hidden type="file" accept=".urdf,.xml" ref={picker} aria-label={t('选择 URDF 文件')} onChange={async e=>{
      const file=e.target.files?.[0];e.target.value='';if(!file)return;
      const ticket=++generation.current,{workspaceEpoch:epoch,project}=useProject.getState();
      if(!project)return;
      try{
        const names=await urdfMeshNames(file);
        if(ticket!==generation.current || useProject.getState().workspaceEpoch!==epoch)return;
        if(!names.length){await selectFiles([file]);return;}
        setError('');setSession({file,names,epoch,revision:project.revision,choices:{}});
      }catch(e){message.error(()=>errorText(e));}
    }}/>
    {session&&<input hidden type="file" multiple ref={el=>{folder.current=el;el?.setAttribute('webkitdirectory','');}} aria-label={t('选择 URDF 所在目录')} onChange={async e=>{
      const files=Array.from(e.target.files||[]);e.target.value='';if(!session||!files.length)return;
      const ticket=++generation.current;setBusy(true);setError('');
      try{
        const groups=await findUrdfMeshes(session.file,session.names,files);
        if(ticket===generation.current)setSession({...session,groups,choices:Object.fromEntries(groups.filter(g=>g.files.length===1).map(g=>[g.name,g.files[0].webkitRelativePath]))});
      }catch(e){if(ticket===generation.current)setError(errorText(e));}
      finally{if(ticket===generation.current)setBusy(false);}
    }}/>}
    <Modal title={t('导入URDF')} open={!!session} onCancel={()=>{generation.current++;setSession(undefined);setBusy(false);}} footer={null}>
      {session&&<Space direction="vertical" style={{width:'100%'}}>
        <strong>{session.file.name}</strong>
        <p>{t('选择 URDF 所在目录，按文件名搜索同级及子目录中的 Mesh，忽略原引用路径。浏览器需要您选择目录后才能读取其中的文件。')}</p>
        <Button disabled={busy} onClick={()=>folder.current?.click()}>{t('选择所在目录')}</Button>
        {session.groups?.map(group=><div key={group.name}>
          <label htmlFor={'mesh-'+group.name}>{group.name}</label>
          {group.files.length===0?<p>{t('未找到同名 Mesh，导入后可补充。')}</p>:<Select id={'mesh-'+group.name} style={{width:'100%'}} value={session.choices[group.name]} placeholder={t('存在同名文件，请选择')} options={group.files.map(file=>({value:file.webkitRelativePath,label:file.webkitRelativePath}))} onChange={value=>setSession({...session,choices:{...session.choices,[group.name]:value}})}/>}
        </div>)}
        {error&&<Alert type="error" message={error}/>}
        <Space>
          <Button type="primary" loading={busy} disabled={!session.groups||session.groups.some(g=>g.files.length>0&&!session.choices[g.name])} onClick={()=>void finish([session.file,...(session.groups||[]).flatMap(g=>g.files.filter(f=>f.webkitRelativePath===session.choices[g.name]))])}>{t('预览导入')}</Button>
          <Button disabled={busy} onClick={()=>void finish([session.file])}>{t('仅导入 URDF')}</Button>
        </Space>
      </Space>}
    </Modal>
  </>;
  return {open:()=>picker.current?.click(),dialog};
}
