import { children, xmlDocument } from './xml';

export interface UrdfSourceReveal { kind: 'link' | 'joint'; index: number; source: string; request: number }
/** Resolve an occurrence in the actual editor text; comments/extensions do not count. */
export function urdfSourceRange(text: string, kind: 'link' | 'joint', index: number) {
  const document = xmlDocument(text, true);
  if (document.documentElement.localName !== 'robot' || !Number.isInteger(index) || index < 0) return;
  const node = children(document.documentElement, kind)[index] as (Element & { lineNumber: number; columnNumber: number }) | undefined;
  if (!node || !node.lineNumber || !node.columnNumber) return;
  const newlines = /\r\n?|\n/g; let start = 0;
  for (let line = 1; line < node.lineNumber; line++) { const match = newlines.exec(text); if (!match) return; start = match.index + match[0].length; }
  const from = start + node.columnNumber - 1, token = '<' + node.tagName;
  if (text.slice(from, from + token.length) !== token) return;
  return { from, to: from + token.length };
}
