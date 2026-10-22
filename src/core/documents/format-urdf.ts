import formatXml from 'xml-formatter';
import { opaqueXmlRanges, xmlDocument } from './xml';
import { m, MessageError } from '../project/messages';

/** Explicit source formatting only; loading or editing model properties never invokes this. */
export function formatUrdf(text: string): string {
  const doc = xmlDocument(text);
  if (doc.documentElement.localName !== 'robot') throw new MessageError(m('URDF 根节点必须是 robot'));
  let marker = 'rocos-format-opaque';
  while (text.includes(marker)) marker += '-';
  // Format structural XML, but retain text-bearing extensions byte for byte:
  // inserting indentation there could change mixed content or xml:space semantics.
  const textElements = new Set(Array.from(doc.getElementsByTagName('*')).filter(node =>
    node.getAttribute('xml:space') === 'preserve' || Array.from(node.childNodes).some(child =>
      child.nodeType === 4 || (child.nodeType === 3 && child.nodeValue?.trim()))
  ).map(node => node.tagName));
  const ranges = opaqueXmlRanges(text, name => name.split(':').at(-1) === 'hardware' || textElements.has(name));
  let masked = text;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const { from, to } = ranges[i];
    masked = masked.slice(0, from) + `<!--${marker}-${i}-->` + masked.slice(to);
  }
  let formatted = formatXml(masked, { indentation: '  ', lineSeparator: '\n', collapseContent: true, strictMode: true });
  ranges.forEach(({ from, to }, i) => { formatted = formatted.replace(`<!--${marker}-${i}-->`, () => text.slice(from, to)); });
  xmlDocument(formatted);
  return formatted.trimEnd() + '\n';
}
