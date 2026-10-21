import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
export function xmlDocument(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('不支持 XML DTD 或外部实体');
  const errors: string[] = [];
  const doc = new DOMParser({ errorHandler: { warning: m => errors.push(m), error: m => errors.push(m), fatalError: m => errors.push(m) } }).parseFromString(text, 'application/xml');
  if (errors.length || !doc.documentElement) throw new Error(errors.join('\n') || 'XML 缺少根节点');
  return doc;
}
export const serializeXml = (doc: Document | Element) => new XMLSerializer().serializeToString(doc);
export const children = (node: Element | Document, tag?: string): Element[] => Array.from(node.childNodes).filter((n): n is Element => n.nodeType === 1 && (!tag || (n as Element).localName === tag));
export const child = (node: Element | Document, tag: string) => children(node, tag)[0];
export const content = (node: Element | undefined, tag: string) => node ? child(node, tag)?.textContent?.trim() || '' : '';
export function xmlNumber(text: string): number { return text.startsWith('#x') ? parseInt(text.slice(2), 16) : text ? Number(text) : NaN; }

export function decodeXml(bytes: Uint8Array): { text: string; encoding: string } {
  let encoding = 'utf-8';
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0)) encoding = 'utf-16le';
  else if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c)) encoding = 'utf-16be';
  else {
    const prefix = new TextDecoder('windows-1252').decode(bytes.slice(0, 256));
    const declared = /<\?xml\b[^?]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(prefix);
    if (declared) encoding = declared[1].toLowerCase();
  }
  return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding };
}

export const elements = (root: Document | Element, tag: string) => Array.from(root.getElementsByTagName('*')).filter(n => n.localName === tag);
