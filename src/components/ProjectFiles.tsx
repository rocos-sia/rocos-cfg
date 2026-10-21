import { useLocalizedModal } from './useLocalizedModal';
import { m as msg, errorMessage, messageFields, type MessageInput } from '../core/project/messages';
import { diagnosticText, errorText, t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Modal, Progress, Space, Table } from 'antd';
import { fileAccess, FileAccessError, type FileHandle, type OpenedFile, type TransferOptions } from '../adapters/file-access';
import { ProjectSession, retainsSaveTarget, type SaveMode } from '../adapters/project-session';
import { inspectArchive, recoverArchive, saveArchive } from '../adapters/archive-tasks';
import { digest, type Project } from '../core/project/types';
import { download } from '../adapters/files';
import { flushBuffers, useProject } from '../store';
import { ArchivePreview, type ReadonlyArchive } from './ArchivePreview';
import { ArchiveRecovery, type FailedArchive } from './ArchiveRecovery';
import { ArchiveMigration, type PendingMigration } from './ArchiveMigration';

export function useProjectFiles(onLoaded:()=>void) {
  const access=fileAccess(),native=access.kind==='desktop';
  const session=useRef(new ProjectSession(access,saveArchive));
  const operation=useRef<AbortController|undefined>(undefined);
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState<number>(),[destination,setDestination]=useState<string>();
  const [readonly,setReadonly]=useState<ReadonlyArchive>();
  const [failed,setFailed]=useState<FailedArchive>();
  const [migration,setMigration]=useState<PendingMigration>();
  const [conflict,setConflict]=useState<{handle:FileHandle;error:FileAccessError;disk?:OpenedFile;reason?:MessageInput;rows?:{path:string;change:string;current:string;disk:string}[]}>();
  const {message}=App.useApp();const modal=useLocalizedModal();const afterLoad=useRef(onLoaded);afterLoad.current=onLoaded;
  const run=async<T,>(work:(controller:AbortController)=>Promise<T>):Promise<T|undefined>=>{
    if(operation.current){message.info(t("已有文件操作，请等待完成或取消"));return;}
    const controller=new AbortController();operation.current=controller;setBusy(true);setProgress(undefined);
    try{return await work(controller);}catch(e){
      if(e instanceof FileAccessError&&e.code==='conflict'&&session.current.handle)setConflict({handle:session.current.handle,error:e});
      else if(!(e instanceof DOMException&&e.name==='AbortError'))message.error(errorText(e));
    }finally{operation.current=undefined;setBusy(false);setProgress(undefined);}
  };
  const replace=async(next:Project,opened?:OpenedFile,protectedSource?:FileHandle,signal?:AbortSignal)=>{
    const load=async()=>{await session.current.adopt(next.id,opened?.handle,protectedSource);useProject.getState().load(next);if(opened)useProject.getState().markOpened(next.revision,!!opened.handle);setDestination(opened?.handle?.displayPath);afterLoad.current();};
    const current=useProject.getState().project;
    if(current)await new Promise<void>((resolve,reject)=>{
      const cancel=async()=>{signal?.removeEventListener('abort',abort);try{if(opened?.handle)await access.release(opened.handle);if(protectedSource)await access.release(protectedSource);resolve();}catch(e){reject(e);}};
      const abort=()=>{dialog.destroy();void cancel();};
      const dialog=modal.confirm(()=>({title:t("切换工程"),width:680,content:<>
      <p>{t("当前工程将被替换。请确认已保存或下载需要留存的修改。")}</p>
      {opened&&<><Alert type="info" message={current.id===next.id?t("这是同一工程的另一份文件；将按所选快照打开，不合并工作区修改。"):t("所选文件属于另一个工程。")}/>
        <p>{t("当前：")}{current.name} · revision {current.revision}<br/>{t("所选：")}{next.name} · revision {next.revision}</p>
        <details><summary>{t("工程与快照标识")}</summary><p style={{overflowWrap:'anywhere'}}>{t("当前工程 UUID：")}{current.id}<br/>{t("当前载入快照：")}{current.snapshotId}<br/>{t("所选工程 UUID：")}{next.id}<br/>{t("所选快照：")}{next.snapshotId}</p></details>
      </>}
    </>,okText:t("打开新工程"),onOk:async()=>{signal?.removeEventListener('abort',abort);try{await load();resolve();}catch(e){reject(e);throw e;}},onCancel:cancel}));
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    });
    else await load();
  };
  const accept=async(opened:OpenedFile,controller:AbortController)=>{
    if(failed?.opened.handle)await access.release(failed.opened.handle);setFailed(undefined);
    if(migration?.opened.handle)await access.release(migration.opened.handle);setMigration(undefined);
    try{const result=await inspectArchive(opened.bytes,{signal:controller.signal,progress:(n,t)=>setProgress(t?n/t*100:undefined)});if(result.mode==='editable'){if(result.migration)setMigration({opened,project:result.project,report:result.migration});else await replace(result.project,opened,undefined,controller.signal);}else{setReadonly({...result,filename:opened.name});if(opened.handle)await access.release(opened.handle);}}
    catch(e){if(e instanceof DOMException&&e.name==='AbortError'){if(opened.handle)await access.release(opened.handle);throw e;}setFailed({opened,error:errorMessage(e)});}
  };
  const closeMigration=()=>{const old=migration;setMigration(undefined);if(old?.opened.handle)void access.release(old.opened.handle).catch(e=>message.error(errorText(e,true)));};
  const acceptMigration=()=>run(async c=>{if(!migration)return;const pending=migration;setMigration(undefined);await replace(pending.project,undefined,pending.opened.handle,c.signal);});
  const copyMigration=()=>run(async c=>{
    if(!migration)return;const result=await access.write(migration.opened.bytes,migration.opened.name,{signal:c.signal,exclude:migration.opened.handle});
    if(result?.kind==='written')await access.release(result.handle);
  });
  const closeFailed=()=>{const old=failed;setFailed(undefined);if(old?.opened.handle)void access.release(old.opened.handle).catch(e=>message.error(errorText(e,true)));};
  const inspectFailed=()=>run(async c=>{
    if(!failed)return;const current=failed;
    try{const recovery=await recoverArchive(current.opened.bytes,__APP_VERSION__,{signal:c.signal,progress:(n,t)=>setProgress(t?n/t*100:undefined)});setFailed(previous=>previous===current?{...current,recovery,recoveryError:undefined}:previous);}
    catch(e){if(e instanceof DOMException&&e.name==='AbortError')throw e;setFailed(previous=>previous===current?{...current,recoveryError:errorMessage(e)}:previous);}
  });
  const restoreFailed=()=>run(async()=>{if(!failed?.recovery)return;const current=failed;setFailed(undefined);await replace(current.recovery!.project,undefined,current.opened.handle);});
  const copyFailed=()=>run(async c=>{
    if(!failed)return;const result=await access.write(failed.opened.bytes,failed.opened.name,{signal:c.signal,exclude:failed.opened.handle});
    if(result?.kind==='written')await access.release(result.handle);
  });
  const open=()=>run(async c=>{const opened=await access.open({signal:c.signal,progress:(n,t)=>setProgress(t?n/t*100:100)});if(opened)await accept(opened,c);});
  const save=(mode:SaveMode='save')=>run(async c=>{
    await flushBuffers();const state=useProject.getState();if(!state.project)return;
    const epoch=state.workspaceEpoch,snapshot=structuredClone(state.project);
    if(session.current.project!==snapshot.id)await session.current.adopt(snapshot.id);
    const saved=await session.current.save(snapshot,mode,__APP_VERSION__,{signal:c.signal,progress:(n,t)=>setProgress(t?n/t*100:100)});
    if(!saved)return;
    const same=useProject.getState().workspaceEpoch===epoch&&useProject.getState().project?.id===snapshot.id;
    if(saved.result.kind==='written'){
      if(saved.current&&same&&!retainsSaveTarget(mode)){setDestination(saved.result.handle.displayPath);useProject.getState().markSaved(snapshot.revision,saved.result.handle.displayPath);}
      message.success(mode==='fork'?t("新工程已写入磁盘，可打开后独立编辑"):mode==='copy'?t("工程副本已写入磁盘"):t("工程已写入磁盘"));
      if(saved.result.backupPath)message.info(t('上一版备份：{path}',{path:saved.result.backupPath}),6);
      if(saved.result.warning)message.warning(diagnosticText({message:saved.result.warning,text:saved.result.warningText}),8);
    }else{if(same&&!retainsSaveTarget(mode))useProject.getState().markDownloaded(snapshot.revision);message.success(mode==='fork'?t("已生成新工程下载，可打开后独立编辑"):t("已生成工程下载，请保留下载文件"));}
  });
  const inspectDisk=()=>run(async c=>{
    if(!conflict)return;const base=conflict,opened=await access.refresh(base.handle,{signal:c.signal});const result=await inspectArchive(opened.bytes,{signal:c.signal,progress:(n,t)=>setProgress(t?n/t*100:undefined)});
    if(result.mode!=='editable'){setConflict({...base,disk:opened,reason:{message:result.reason,text:result.reasonText}});return;}
    const current=useProject.getState().project;
    if(!current)return;
    const currentFiles=new Map(await Promise.all(current.files.map(async f=>[f.path,await digest(f.bytes)] as const)));
    const diskFiles=new Map(await Promise.all(result.project.files.map(async f=>[f.path,await digest(f.bytes)] as const)));
    const rows=[...new Set([...currentFiles.keys(),...diskFiles.keys()])].sort().map(path=>({path,current:currentFiles.get(path)||'',disk:diskFiles.get(path)||'',change:currentFiles.has(path)?diskFiles.has(path)?currentFiles.get(path)===diskFiles.get(path)?"相同":"内容不同":"仅工作区":"仅磁盘"}));
    setConflict({...base,disk:opened,rows,reason:msg('磁盘工程：{disk}；工作区：{workspace}。下表比较文件内容哈希；工程元数据、资源映射和编辑草稿也可能不同。当前工作区与保存基线保持不变。',{disk:result.project.name,workspace:current.name})});
  });
  const closeHandler=useRef<()=>void>(()=>{});
  closeHandler.current=()=>{
    if(operation.current||access.busy){message.info(t("文件操作尚未完成，请等待或取消后再关闭"));return;}
    void flushBuffers().then(()=>{const state=useProject.getState();if(state.project&&state.project.revision!==state.savedRevision)modal.confirm(()=>({title:t("关闭应用"),content:t("当前工程有未保存修改。浏览器缓存不代替工程文件；可取消后先保存。"),okText:t("不保存并关闭"),cancelText:t("取消"),onOk:()=>access.close?.()}));else return access.close?.();}).catch(e=>message.error(errorText(e,true)));
  };
  useEffect(()=>{
    if(!access.onClose)return;let dispose:(()=>void)|undefined,ended=false;
    void access.onClose(()=>closeHandler.current()).then(fn=>{if(ended)fn();else dispose=fn;}).catch(e=>message.error(t("关闭确认监听失败：")+String(e)));
    return()=>{ended=true;dispose?.();};
  },[access]);
  const saveHandler=useRef(save);saveHandler.current=save;
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void saveHandler.current(e.shiftKey?'saveAs':'save');}};addEventListener('keydown',key);return()=>removeEventListener('keydown',key);},[]);
  return {native,busy,destination,open,save,replace,
    compute:<T,>(work:(options:TransferOptions)=>Promise<T>)=>run(c=>work({signal:c.signal,progress:(n,t)=>setProgress(t?n/t*100:undefined)})),
    accept:(opened:OpenedFile)=>run(c=>accept(opened,c)),
    importFiles:(directory:boolean)=>run(c=>access.import(directory,{signal:c.signal,progress:(n,t)=>setProgress(t?n/t*100:100)})),
    dialogs:<>
      <ArchivePreview archive={readonly} onClose={()=>setReadonly(undefined)}/>
      <ArchiveMigration pending={migration} busy={busy} onClose={closeMigration} onAccept={()=>void acceptMigration()} onCopy={()=>void copyMigration()}/>
      <ArchiveRecovery archive={failed} busy={busy} onClose={closeFailed} onInspect={()=>void inspectFailed()} onRecover={()=>void restoreFailed()} onCopy={()=>void copyFailed()}/>
      {busy&&<div className="file-transfer" role="status"><Space><strong>{t("正在处理工程快照")}</strong><Button size="small" onClick={()=>operation.current?.abort()}>{t("取消操作")}</Button></Space><Progress percent={progress===undefined?undefined:Math.round(progress)} status="active"/><small>{t("可以继续编辑；保存只标记本次捕获的版本。")}</small></div>}
      <Modal title={t("磁盘文件已变化")} open={!!conflict} width={850} styles={{body:{overflowWrap:'anywhere'}}} onCancel={()=>setConflict(undefined)} footer={<Space wrap><Button onClick={()=>setConflict(undefined)}>{t("保留工作区")}</Button><Button onClick={()=>void inspectDisk()}>{t("查看磁盘版本差异")}</Button><Button type="primary" onClick={()=>{setConflict(undefined);void save('saveAs');}}>{t("另存为")}</Button></Space>}>
        {conflict&&<><Alert type="warning" message={errorText(conflict.error)}/><p style={{overflowWrap:'anywhere'}}>{conflict.handle.displayPath}<br/>{t("打开/上次保存哈希：")}{conflict.handle.sha256}<br/>{t("检测到的磁盘哈希：")}{conflict.error.currentHash||t("文件不存在")}</p>
          {conflict.reason&&<p>{diagnosticText(messageFields(conflict.reason))}</p>}
          {conflict.rows&&<Table size="small" rowKey="path" scroll={{x:700}} dataSource={conflict.rows} columns={[{title:t("路径"),dataIndex:'path'},{title:t("差异"),dataIndex:'change',render:value=>t(value)},{title:t("工作区 SHA-256"),dataIndex:'current',ellipsis:true,render:value=>value||t('无')},{title:t("磁盘 SHA-256"),dataIndex:'disk',ellipsis:true,render:value=>value||t('无')}]} pagination={{pageSize:6}}/>}
          {conflict.disk&&<Button onClick={()=>void download(conflict.disk!.bytes,conflict.disk!.name).catch(e=>message.error(errorText(e,true)))}>{t("导出磁盘版本副本")}</Button>}
        </>}
      </Modal>
    </>};
}
