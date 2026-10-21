import { describe, expect, it, vi } from 'vitest';
import { runArchiveTask, type WorkerFactory } from '../src/adapters/archive-tasks';
import { ProjectSession } from '../src/adapters/project-session';
import { createProject } from '../src/core/project/create';
import type { FileAccess } from '../src/adapters/file-access';

class TestWorker extends EventTarget {
  postMessage=vi.fn();terminate=vi.fn();
  reply(data:unknown){this.dispatchEvent(new MessageEvent('message',{data}));}
}
describe('archive worker ownership and cancellation',()=>{
  it('terminates a cancelled job, ignores late progress/results and keeps the original input bytes',async()=>{
    const worker=new TestWorker(),signal=new AbortController(),progress=vi.fn();
    const bytes=new Uint8Array([1,2,3]);
    const task=runArchiveTask({kind:'inspect',bytes},{signal:signal.signal,progress},()=>worker);
    worker.reply({type:'progress',percent:20});expect(progress).toHaveBeenCalledWith(20,100);
    signal.abort();await expect(task).rejects.toMatchObject({name:'AbortError'});
    worker.reply({type:'progress',percent:100});worker.reply({type:'result',result:{mode:'editable'}});
    expect(progress).toHaveBeenCalledTimes(1);expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(bytes).toEqual(new Uint8Array([1,2,3]));expect(worker.postMessage).toHaveBeenCalledWith({kind:'inspect',bytes});
  });
  it('does not start cancelled jobs and releases workers after execution or decoding errors',async()=>{
    const signal=new AbortController();signal.abort();const factory=vi.fn();
    await expect(runArchiveTask({kind:'inspect',bytes:new Uint8Array()},{signal:signal.signal},factory)).rejects.toMatchObject({name:'AbortError'});
    expect(factory).not.toHaveBeenCalled();
    for(const type of ['error','messageerror']){
      const worker=new TestWorker(),task=runArchiveTask({kind:'inspect',bytes:new Uint8Array()},{},()=>worker);
      worker.dispatchEvent(new Event(type));await expect(task).rejects.toThrow();expect(worker.terminate).toHaveBeenCalledTimes(1);
    }
  });
  it('releases workers when posting fails, reports core errors, and never shares a worker across jobs',async()=>{
    const broken=new TestWorker();broken.postMessage.mockImplementation(()=>{throw new Error('cannot clone');});
    await expect(runArchiveTask({kind:'inspect',bytes:new Uint8Array()},{},()=>broken)).rejects.toThrow('cannot clone');expect(broken.terminate).toHaveBeenCalledOnce();
    const one=new TestWorker(),two=new TestWorker(),input={kind:'inspect' as const,bytes:new Uint8Array()};
    const first=runArchiveTask(input,{},()=>one),second=runArchiveTask(input,{},()=>two);
    one.reply({type:'error',message:'SHA-256 mismatch'});await expect(first).rejects.toThrow('SHA-256 mismatch');
    const project=createProject('second','igh');two.reply({type:'result',result:{mode:'editable',project}});
    expect(await second).toEqual({mode:'editable',project});expect(one.terminate).toHaveBeenCalledOnce();expect(two.terminate).toHaveBeenCalledOnce();
  });
  it('a cancelled serializer cannot reach the file writer or change the session target, and saving can be retried',async()=>{
    const workers:TestWorker[]=[];const factory:WorkerFactory=()=>{const worker=new TestWorker();workers.push(worker);return worker;};
    const access={write:vi.fn(async()=>({kind:'downloaded' as const})),release:vi.fn()} as unknown as FileAccess;
    const session=new ProjectSession(access,(project,version,options)=>runArchiveTask({kind:'save',project,version},options,factory));
    const project=createProject('save','igh'),handle={token:'source',name:'p.rcproj',displayPath:'/p.rcproj',size:1,sha256:'old'};
    await session.adopt(project.id,handle);const signal=new AbortController();
    const cancelled=session.save(project,'save','test',{signal:signal.signal});signal.abort();
    await expect(cancelled).rejects.toMatchObject({name:'AbortError'});expect(access.write).not.toHaveBeenCalled();expect(session.handle).toBe(handle);
    const retry=session.save(project,'save','test');const bytes=new Uint8Array([7,8]);workers[1].reply({type:'result',result:bytes});
    await retry;expect(access.write).toHaveBeenCalledWith(bytes,'save.rcproj',expect.objectContaining({target:handle}));
  });
});
