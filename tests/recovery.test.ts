import { beforeEach, describe, expect, it, vi } from 'vitest';
const db=vi.hoisted(()=>new Map<IDBValidKey,any>());
vi.mock('idb-keyval',()=>({
  keys:async()=>[...db.keys()],
  get:async(key:IDBValidKey)=>structuredClone(db.get(key)),
  getMany:async(keys:IDBValidKey[])=>keys.map(key=>structuredClone(db.get(key))),
  setMany:async(entries:[IDBValidKey,any][])=>{for(const [key,value]of entries)db.set(key,structuredClone(value));},
  delMany:async(keys:IDBValidKey[])=>{for(const key of keys)db.delete(key);},
}));
import { deleteRecovery, listRecovery, newRecoveryKey, readRecovery, writeRecovery } from '../src/adapters/recovery';
import { createProject } from '../src/core/project/create';

beforeEach(()=>db.clear());
describe('local recovery records',()=>{
  it('reads the old single-slot draft without removing it and removes only an explicitly selected session',async()=>{
    const legacy=createProject('legacy','igh');db.set('rocos-recovery',legacy);db.set('unrelated-setting','keep');
    const key=newRecoveryKey();await writeRecovery(key,legacy);
    expect(await listRecovery()).toHaveLength(2);
    expect((await readRecovery('rocos-recovery')).id).toBe(legacy.id);
    await deleteRecovery(key);
    expect((await listRecovery()).map(row=>row.key)).toEqual(['rocos-recovery']);
    expect(db.get('rocos-recovery')).toEqual(legacy);expect(db.get('unrelated-setting')).toBe('keep');
  });
  it('validates a selected cached project before restoration and preserves an invalid cache for diagnosis',async()=>{
    const p=createProject('broken','igh'),key=newRecoveryKey();p.entrypoints.urdf='missing-file';
    await writeRecovery(key,p);
    await expect(readRecovery(key)).rejects.toThrow('入口');
    expect(db.get(key).project).toEqual(p);expect(await listRecovery()).toHaveLength(1);
    await expect(deleteRecovery('unrelated-setting')).rejects.toThrow('标识');
  });
});
