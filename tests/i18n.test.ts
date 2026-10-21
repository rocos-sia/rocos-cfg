import { afterEach, expect, it } from 'vitest';
import english from '../src/i18n/en.json';
import { getLocale, persistenceText, setLocale, t } from '../src/i18n';
afterEach(()=>setLocale('zh-CN'));
it('translates explicit UI messages without translating interpolated project values',()=>{
  setLocale('en-US');expect(getLocale()).toBe('en-US');expect(t('工程总览')).toBe('Overview');
  const path='中文目录/工程总览.yaml';
  expect(t('无法以声明编码显示 {path}，原始字节仍保留在工程中。',{path})).toBe(`Cannot display ${path} using its declared encoding. Original bytes remain in the project.`);
  expect(t('unknown.key')).toBe('unknown.key');expect(t('constructor')).toBe('constructor');
  setLocale('zh-CN');expect(t('{count} 项错误',{count:2})).toBe('2 项错误');
});
it('renders stored save statuses in the current language without rewriting state',()=>{
  const stored='已保存工程文件；草稿缓存失败';setLocale('en-US');
  expect(persistenceText(stored)).toBe('Project file saved; draft cache failed');
  setLocale('zh-CN');expect(persistenceText(stored)).toBe(stored);
});

it('keeps all named placeholders intact in the English catalog',()=>{
  const placeholders=(s:string)=>[...new Set([...s.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(m=>m[1]))].sort();
  for(const [source,translated] of Object.entries(english))expect(placeholders(translated),source).toEqual(placeholders(source));
});
