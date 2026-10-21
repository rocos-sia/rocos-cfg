import { m as msg, MessageError } from '../project/messages';
import type { ConfigModule } from './contracts';
import type { ProjectFile } from '../project/types';
export class ModuleRegistry {
  private readonly definitions = new Map<string, ConfigModule>();
  constructor(modules: ConfigModule[], readonly platform: 'web' | 'desktop' = 'web') {
    for (const module of modules) {
      if (this.definitions.has(module.id)) throw new MessageError(msg("模块 ID 重复：{v0}", {v0:String(module.id)}));
      if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(module.id) || !Number.isSafeInteger(module.version) || module.version < 1) throw new MessageError(msg("模块注册信息无效"));
      this.definitions.set(module.id, module);
    }
  }
  all() { return [...this.definitions.values()]; }
  get(id: string, version?: number) { const m = this.definitions.get(id); return m && (version === undefined || m.version === version) ? m : undefined; }
  detect(file: ProjectFile): ConfigModule[] {
    return this.all().filter(module => { try { return module.detect(file); } catch { return false; } });
  }
}
