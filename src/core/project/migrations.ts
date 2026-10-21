/** Compiled, pure-data schema migrations. Archives never supply executable steps. */
export const FORMAT_VERSION = 1;
export const PROJECT_SCHEMA_VERSION = 1;

export interface MigrationData {
  manifest: Record<string, any>;
  /** Payload entries only; the manifest is represented separately above. */
  files: Map<string, Uint8Array>;
}
export interface MigrationStep {
  id: string;
  from: number;
  to: number;
  description: string;
  /** Deterministic transformation of a private copy; no filesystem or clock access. */
  transform: (input: MigrationData) => MigrationData;
}
export interface MigrationReport {
  from: number;
  to: number;
  steps: { id: string; from: number; to: number; description: string; changedPaths: string[]; manifestChanged: boolean }[];
}
export interface MigrationSchema {
  version: number;
  /** Verify the complete schema and payload integrity, before and after every step. */
  validate: (input: MigrationData) => Promise<void> | void;
}
const version = (n: number) => Number.isSafeInteger(n) && n > 0;
const equalBytes = (a?: Uint8Array, b?: Uint8Array) => !!a && !!b && a.length === b.length && a.every((byte, i) => byte === b[i]);
const equalJson = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equalJson(a[key], b[key]));
};

export class MigrationRegistry {
  private readonly schemas = new Map<number, MigrationSchema>();
  private readonly steps = new Map<number, MigrationStep>();
  constructor(readonly current: number, schemas: readonly MigrationSchema[], steps: readonly MigrationStep[]) {
    if (!version(current)) throw new Error('迁移目标版本无效');
    for (const schema of schemas) {
      if (!version(schema.version) || schema.version > current || this.schemas.has(schema.version)) throw new Error('迁移 Schema 版本重复或无效');
      this.schemas.set(schema.version, { ...schema });
    }
    if (!this.schemas.has(current)) throw new Error('缺少当前版本校验器');
    const ids = new Set<string>();
    for (const step of steps) {
      if (!step.id || ids.has(step.id) || !version(step.from) || step.to !== step.from + 1 || step.to > current || this.steps.has(step.from) || !this.schemas.has(step.from) || !this.schemas.has(step.to)) throw new Error('迁移必须具有唯一 ID、相邻版本和完整校验器');
      ids.add(step.id); this.steps.set(step.from, { ...step });
    }
  }
  supports(source: number): boolean {
    if (!version(source) || source > this.current || !this.schemas.has(source)) return false;
    for (let n = source; n < this.current; n++) if (!this.steps.has(n)) return false;
    return true;
  }
  async prepare(input: MigrationData): Promise<{ data: MigrationData; report?: MigrationReport }> {
    const source = input.manifest.projectSchemaVersion;
    if (!this.supports(source)) throw new Error('没有完整且受支持的工程迁移链');
    // Neither validators nor transforms ever receive caller-owned data.
    let data = structuredClone(input);
    const check = async (candidate: MigrationData, expected: number) => {
      if (candidate.manifest.projectSchemaVersion !== expected || candidate.manifest.format !== input.manifest.format || candidate.manifest.formatVersion !== input.manifest.formatVersion) throw new Error('迁移改变了容器契约或产生错误的工程版本');
      await this.schemas.get(expected)!.validate(structuredClone(candidate));
    };
    await check(data, source);
    // A project-model upgrade must not rewrite native configurations, ENI,
    // resources or opaque module payloads. Their own contracts evolve separately.
    const preserved = Array.isArray(data.manifest.files) ? data.manifest.files.filter((file: any) => file.role !== 'editor-state').map((file: any) => {
      const {path, ...metadata} = file;
      return { id: file.id, path, metadata, bytes: data.files.get(path) };
    }) : [];
    const preservedModules = Array.isArray(data.manifest.modules) ? data.manifest.modules.filter((module: any) => module.id !== 'editor-state') : [];
    const report: MigrationReport = { from: source, to: this.current, steps: [] };
    for (let n = source; n < this.current; n++) {
      const step = this.steps.get(n)!;
      try {
        const next = structuredClone(step.transform(structuredClone(data)));
        await check(next, step.to);
        for (const file of preserved) {
          const entry = next.manifest.files?.find((candidate: any) => candidate.id === file.id);
          const {path: nextPath, ...metadata} = entry || {};
          if (!entry || !equalBytes(file.bytes, next.files.get(nextPath)) || !equalJson(file.metadata, metadata)) throw new Error(`工程迁移不能删除或改写原配置及资源：${file.path}`);
        }
        for (const module of preservedModules) if (!next.manifest.modules?.some((candidate: any) => equalJson(candidate, module))) throw new Error(`工程迁移不能丢失或改写模块契约：${module.instanceId || module.id}`);
        report.steps.push({ id: step.id, from: step.from, to: step.to, description: step.description,
          changedPaths: [...new Set([...data.files.keys(), ...next.files.keys()])].filter(path => !equalBytes(data.files.get(path), next.files.get(path))).sort(),
          manifestChanged: JSON.stringify(data.manifest) !== JSON.stringify(next.manifest),
        });
        data = next;
      } catch (error) {
        throw new Error(`工程迁移 ${step.id}（${step.from} → ${step.to}）失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { data, ...(report.steps.length ? { report } : {}) };
  }
}
