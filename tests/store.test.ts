import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: vi.fn(), getMany:vi.fn().mockResolvedValue([]), keys:vi.fn().mockResolvedValue([]), delMany:vi.fn().mockResolvedValue(undefined), setMany: vi.fn().mockResolvedValue(undefined) }));
import { setMany as cacheSet } from 'idb-keyval';
import { useProject, flushBuffers } from '../src/store';
import { createProject } from '../src/core/project/create';
import { fileById, textOf, utf8 } from '../src/core/project/types';
import { resourceProject } from './fixtures/resources';
import { readYaml } from '../src/core/documents/yaml';

afterEach(() => { vi.restoreAllMocks(); });
describe('source editing transactions', () => {
  it('keeps only the latest asynchronous draft and applies it without losing precision', async () => {
    const p = createProject('p', 'igh'), id = p.entrypoints.master.fileId!;
    useProject.getState().load(p);
    void useProject.getState().buffer(id, 'value: [broken');
    void useProject.getState().buffer(id, 'value: 18446744073709551615\n');
    await flushBuffers();
    expect(useProject.getState().project!.editor.buffers[id].text).toBe('value: 18446744073709551615\n');
    await useProject.getState().apply(id);
    const result = useProject.getState().project!;
    expect(readYaml(textOf(fileById(result, id)!)).value).toBe(18446744073709551615n);
    expect(result.editor.buffers[id]).toBeUndefined();
    useProject.getState().undo();
    expect(useProject.getState().project!.editor.buffers[id].text).toContain('18446744073709551615');
  });
  it('does not resurrect a pending draft after discard or reopening the same project ID', async () => {
    const p = createProject('p', 'igh'), id = p.entrypoints.master.fileId!;
    useProject.getState().load(p);
    void useProject.getState().buffer(id, 'discard this');
    useProject.getState().discard(id);
    await flushBuffers();
    expect(useProject.getState().project!.editor.buffers[id]).toBeUndefined();
    void useProject.getState().buffer(id, 'old session');
    useProject.getState().load(structuredClone(p));
    await flushBuffers();
    expect(useProject.getState().project!.editor.buffers[id]).toBeUndefined();
  });
  it('retains invalid drafts and rejects stale base hashes instead of overwriting an imported file', async () => {
    const p = createProject('p', 'igh'), id = p.entrypoints.master.fileId!;
    useProject.getState().load(p);
    await useProject.getState().buffer(id, 'value: [broken');
    await expect(useProject.getState().apply(id)).rejects.toThrow();
    expect(textOf(fileById(useProject.getState().project!, id)!)).toBe(textOf(fileById(p, id)!));
    await useProject.getState().buffer(id, 'value: 42\n');
    useProject.getState().change(next => { fileById(next, id)!.bytes = utf8.encode('value: 10\n'); });
    await expect(useProject.getState().apply(id)).rejects.toThrow('基线冲突');
    expect(useProject.getState().project!.editor.buffers[id].text).toBe('value: 42\n');
    expect(textOf(fileById(useProject.getState().project!, id)!)).toBe('value: 10\n');
  });
});

it('expires mechanical approval on form/source edits and restores it only with the matching undo snapshot', async()=>{
  const p=resourceProject(),id=p.entrypoints.hardware!;
  useProject.getState().load(p);
  useProject.getState().yaml(id,['hardware',0,'transform','ratio'],2);
  expect(useProject.getState().project!.editor.confirmations['drive:0']).toBeUndefined();
  const revision=useProject.getState().project!.revision,past=useProject.getState().past.length;
  useProject.getState().yaml(id,['hardware',0,'transform','ratio'],2);
  expect(useProject.getState().project!.revision).toBe(revision);expect(useProject.getState().past).toHaveLength(past);
  useProject.getState().undo();expect(useProject.getState().project!.editor.confirmations['drive:0']).toBe(true);
  useProject.getState().redo();expect(useProject.getState().project!.editor.confirmations['drive:0']).toBeUndefined();
  useProject.getState().change(n=>{n.editor.confirmations['drive:0']=true;});
  expect(useProject.getState().project!.editor.confirmations['drive:0']).toBe(true);
  const source=textOf(fileById(useProject.getState().project!,id)!);
  await useProject.getState().buffer(id,source.replace('ratio: 2','ratio: 3'));
  await useProject.getState().apply(id);
  expect(useProject.getState().project!.editor.confirmations['drive:0']).toBeUndefined();
});

it('marks only the captured revision saved and cache completion cannot replace a disk-save result',async()=>{
  vi.mocked(cacheSet).mockResolvedValue(undefined);
  vi.useFakeTimers();
  try{
    const p=resourceProject();useProject.getState().load(p);
    useProject.getState().markSaved(p.revision,'/selected/p.rcproj');
    await vi.advanceTimersByTimeAsync(500);
    expect(useProject.getState().persistence).toBe('已保存工程文件');
    useProject.getState().change(n=>{n.name='new edits';});
    useProject.getState().markSaved(p.revision,'/selected/p.rcproj');
    expect(useProject.getState().savedRevision).toBe(p.revision);expect(useProject.getState().persistence).toContain('仍有未保存修改');
  }finally{vi.useRealTimers();}
});

it('keeps the editable project and reports synchronous IndexedDB failure without losing disk-save status',async()=>{
  vi.useFakeTimers();
  try{
    vi.mocked(cacheSet).mockImplementation(()=>{throw new Error('IndexedDB unavailable');});
    const p=createProject('cache failure','igh');useProject.getState().load(p);
    await vi.advanceTimersByTimeAsync(500);
    expect(useProject.getState().persistence).toBe('缓存失败，请保存工程备份');
    expect(useProject.getState().project?.name).toBe('cache failure');
    useProject.getState().change(n=>{n.name='still editable';});
    useProject.getState().markSaved(useProject.getState().project!.revision,'/selected/p.rcproj');
    await vi.advanceTimersByTimeAsync(500);
    expect(useProject.getState().persistence).toBe('已保存工程文件；草稿缓存失败');
  }finally{vi.useRealTimers();}
});

it('caches separate sessions for the same project UUID even when switched before the debounce finishes',async()=>{
  vi.useFakeTimers();vi.mocked(cacheSet).mockResolvedValue(undefined);vi.mocked(cacheSet).mockClear();
  try{
    const p=createProject('first copy','igh');useProject.getState().load(p);
    const first=useProject.getState().recoveryKey!;
    useProject.getState().change(n=>{n.name='first unsaved edit';});
    await vi.advanceTimersByTimeAsync(100);
    useProject.getState().load(structuredClone(p));const second=useProject.getState().recoveryKey!;
    useProject.getState().change(n=>{n.name='second unsaved edit';});
    await vi.advanceTimersByTimeAsync(500);
    expect(first).not.toBe(second);
    const writes=vi.mocked(cacheSet).mock.calls.flatMap(([entries])=>entries);
    expect(writes.find(([key])=>key===first)?.[1].project.name).toBe('first unsaved edit');
    expect(writes.find(([key])=>key===second)?.[1].project.name).toBe('second unsaved edit');
    expect(useProject.getState().project?.name).toBe('second unsaved edit');
  }finally{vi.useRealTimers();}
});

it('retains one unchanged binary buffer across a full undo history and redo', () => {
  const p=createProject('large resources','igh');
  p.files.push({id:'large-asset',path:'assets/mesh.bin',role:'resource',owner:'resource',bytes:new Uint8Array(1024*1024).fill(42)});
  useProject.getState().load(p);
  for(let i=0;i<45;i++)useProject.getState().change(next=>{next.description='edit '+i;});
  const buffers=()=>new Set([...useProject.getState().past,...useProject.getState().future,useProject.getState().project!].map(snapshot=>fileById(snapshot,'large-asset')!.bytes.buffer));
  expect(useProject.getState().past).toHaveLength(40);expect(buffers().size).toBe(1);
  useProject.getState().undo();useProject.getState().redo();expect(buffers().size).toBe(1);
});

it('isolates in-place binary edits and failed transactions while restoring exact bytes on undo/redo', () => {
  const p=createProject('binary edits','igh');p.files.push({id:'asset',path:'asset.bin',role:'resource',owner:'resource',bytes:new Uint8Array([1,2,3])});
  useProject.getState().load(p);
  useProject.getState().change(next=>{fileById(next,'asset')!.bytes[1]=9;});
  expect([...fileById(p,'asset')!.bytes]).toEqual([1,2,3]);expect([...fileById(useProject.getState().project!,'asset')!.bytes]).toEqual([1,9,3]);
  useProject.getState().undo();expect([...fileById(useProject.getState().project!,'asset')!.bytes]).toEqual([1,2,3]);
  useProject.getState().redo();const current=useProject.getState().project!;
  expect([...fileById(current,'asset')!.bytes]).toEqual([1,9,3]);
  expect(()=>useProject.getState().change(next=>{fileById(next,'asset')!.bytes.fill(0);throw Error('abort');})).toThrow('abort');
  expect(useProject.getState().project===current).toBe(true);expect([...fileById(current,'asset')!.bytes]).toEqual([1,9,3]);
});
