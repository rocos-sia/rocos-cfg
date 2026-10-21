import { parseDocument } from 'yaml';

export function yamlDocument(text: string) {
  const doc = parseDocument(text, { uniqueKeys: true, intAsBigInt: true, keepSourceTokens: true });
  if (doc.errors.length) throw new Error(doc.errors.map(e => e.message).join('\n'));
  return doc;
}
// Big integers remain BigInt so SDO values never pass through an imprecise Number.
export function readYaml(text: string): any { return yamlDocument(text).toJS({ maxAliasCount: 100 }); }
export function patchYaml(text: string, path: (string | number)[], value: unknown): string {
  const doc = yamlDocument(text); doc.setIn(path, value); return doc.toString();
}
export function num(value: unknown): number { return typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : NaN; }
