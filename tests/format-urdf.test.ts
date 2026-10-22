import { describe, expect, it } from 'vitest';
import { formatUrdf } from '../src/core/documents/format-urdf';
import { xmlDocument } from '../src/core/documents/xml';

describe('explicit URDF formatting', () => {
  it('indents elements, retains XML content and is idempotent', () => {
    const input = '<?xml version="1.0"?><robot name="a&amp;b"><!-- note --><link name="base"><visual><geometry><box size="1 2 3"/></geometry></visual></link></robot>';
    const result = formatUrdf(input);
    expect(result).toContain('\n  <link name="base">\n    <visual>\n      <geometry>');
    expect(result).toContain('<!-- note -->');
    expect(xmlDocument(result).documentElement.getAttribute('name')).toBe('a&b');
    expect(formatUrdf(result)).toBe(result);
  });
  it('keeps legacy hardware opaque, mixed text, CDATA and xml:space content intact', () => {
    const hardware = "<old:hardware xmlns:old='urn:old' a='x>y'>\r\n <hardware><unknown /></hardware><![CDATA[<hardware/>]]><!-- </hardware> -->\r\n</old:hardware>";
    const mixed = '<extension> leading <b>bold</b> trailing </extension>';
    const text = `<robot name="r"><link name="base"/>${hardware}${mixed}<data xml:space="preserve">  a\n b  </data></robot>`;
    const formatted = formatUrdf(text);
    expect(formatted).toContain(hardware);
    expect(xmlDocument(formatted).getElementsByTagName('extension')[0].textContent).toBe(' leading bold trailing ');
    expect(formatted).toContain('<data xml:space="preserve">  a\n b  </data>');
  });
  it('rejects invalid XML, DTDs and a non-robot root', () => {
    for (const text of ['<robot><link></robot>', '<!DOCTYPE robot><robot/>', '<root/>']) expect(() => formatUrdf(text)).toThrow();
  });
});
