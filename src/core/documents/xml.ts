import { m as msg, MessageError } from '../project/messages';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
const opaqueHardware = new WeakMap<Node, string>();
export function xmlDocument(text: string, locate = false) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new MessageError(msg('不支持 XML DTD 或外部实体'));
  const errors: string[] = [];
  const doc = new DOMParser({ ...(locate ? { locator: {} } : {}), errorHandler: { warning: m => errors.push(m), error: m => errors.push(m), fatalError: m => errors.push(m) } }).parseFromString(text, 'application/xml');
  if (errors.length || !doc.documentElement) throw new MessageError(errors.length?errors.join('\n'):msg('XML 缺少根节点'));
  if (doc.documentElement.localName === 'robot') retainHardwareSource(doc, text);
  return doc;
}
export function serializeXml(doc: Document | Element) {
  const serializer = new XMLSerializer();
  // xmldom supports a raw string from nodeFilter, although its bundled typings
  // omit that return type. The raw fragments came from this validated document;
  // only retained hardware nodes bypass serialization, never user substitutions.
  const serialize = serializer.serializeToString as unknown as (node: Node, html: boolean, filter: (node: Node) => Node | string) => string;
  return serialize.call(serializer, doc, false, node => opaqueHardware.get(node) ?? node);
}
function retainHardwareSource(doc: Document, text: string) {
  const nodes = Array.from(doc.getElementsByTagName('*')).filter(node => node.localName === 'hardware' && !isLegacyHardware(node.parentNode!));
  if (!nodes.length) return;
  // Tokenize only markup boundaries. Skip comments, CDATA and processing
  // instructions, and respect quoted '>' characters; hardware values stay opaque.
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[^\s<>/?!]+(?:[^<>"']|"[^"]*"|'[^']*')*>/g;
  let depth = 0, start = 0, index = 0;
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    if (token.startsWith('<!') || token.startsWith('<?')) continue;
    const closing = token.startsWith('</'), empty = /\/\s*>$/.test(token);
    const name = /^<\/?([^\s/>]+)/.exec(token)![1].split(':').at(-1);
    if (!depth && !closing && name === 'hardware') {
      start = match.index;
      if (empty) { opaqueHardware.set(nodes[index++], token); continue; }
      depth = 1;
    } else if (depth) {
      if (closing) depth--;
      else if (!empty) depth++;
      if (!depth) opaqueHardware.set(nodes[index++], text.slice(start, match.index + token.length));
    }
  }
}
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

// URDF hardware extensions are retained as opaque XML, including their attributes.
export function isLegacyHardware(node: Node): boolean {
  for (let current: Node | null = node; current; current = current.parentNode)
    if (current.nodeType === 1 && (current as Element).localName === 'hardware') return true;
  return false;
}
