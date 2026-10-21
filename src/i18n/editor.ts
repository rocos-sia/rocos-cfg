import type { Locale } from './index';
// CodeMirror phrase identifiers are library UI strings, not configuration data.
export const editorPhrases=(locale:Locale):Record<string,string>=>locale==='zh-CN'?{
  'Find':'查找','Replace':'替换','next':'下一个','previous':'上一个','all':'全选匹配',
  'match case':'区分大小写','regexp':'正则表达式','by word':'全字匹配',
  'replace':'替换','replace all':'全部替换','close':'关闭',
  'Go to line':'跳转到行','go':'跳转','current match':'当前匹配','on line':'所在行',
  'replaced match on line $':'已替换第 $ 行的匹配','replaced $ matches':'已替换 $ 处匹配',
  'Completions':'补全建议','Diagnostics':'诊断','No diagnostics':'无诊断',
  'Control character':'控制字符',
}:{};
