import { m as msg, messageFields, MessageError, type MessageInput } from '../project/messages';
import type { ConfigModule } from './contracts';
import { readYaml, num } from '../documents/yaml';
import { textOf } from '../project/types';
export function payloadNumber(value: unknown) {
  if (typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return Number(value);
  return num(value);
}
// rocos-app 7093bcd, Robot::LoadLoadParameters and SetLoadParameters.
export const payloadModule: ConfigModule = {
  id: 'app.payload', version: 1, role: 'app.payload', syntax: 'yaml',
  capabilities: { readonly: false, generate: true, advancedEdit: true, desktop: false },
  detect: file => { if (!/\.ya?ml$/i.test(file.path)) return false; const data = readYaml(textOf(file)); return !!data && typeof data === 'object' && !Array.isArray(data) && 'mass' in data; },
  parse: file => readYaml(textOf(file)),
  validate: (value, { file, project }) => {
    const diagnostics: ReturnType<ConfigModule['validate']> = [];
    const add = (message: MessageInput, severity: 'error' | 'warning' = 'error') => diagnostics.push({ code: 'payload.value', severity, ...messageFields(message), fileId: file.id });
    if (!value || typeof value !== 'object' || Array.isArray(value)) { add(msg("负载参数必须为 YAML 映射")); return diagnostics; }
    const mass = payloadNumber(value.mass);
    if (!Number.isFinite(mass) || mass < 0) add(msg("负载 mass 必须为有限的非负数（kg）"));
    if (value.com !== undefined && (!Array.isArray(value.com) || value.com.length < 3 || value.com.slice(0, 3).some((v: unknown) => !Number.isFinite(payloadNumber(v))))) add(msg("负载 com 需至少包含三个有限坐标（m）"));
    if (Array.isArray(value.com) && value.com.length > 3) add(msg("目标 APP 只读取 com 的前三项；其余项原样保留"), 'warning');
    if (Object.keys(value).some(k => !['mass', 'com'].includes(k))) add(msg("负载文件包含额外字段，原样保留；当前 APP 只读取 mass 和 com"), 'warning');
    if (project.targets.app.version !== '7093bcd') add(msg("负载模块仅核对过 APP 7093bcd，当前目标规则不受支持"));
    return diagnostics;
  },
  references: () => [],
  export: (_, ctx) => {
    if (ctx.rewrites.length) throw new MessageError(msg("负载文件没有可改写的资源字段"));
    return [{ path: ctx.path, bytes: ctx.file.bytes, fileId: ctx.file.id }];
  },
};
