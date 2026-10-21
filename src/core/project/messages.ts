/** Serializable diagnostic text; values remain data, never translation keys. */
export interface MessageTemplate {
  key: string;
  values: Record<string, string | number | MessageTemplate>;
}
export interface DiagnosticMessage { message: string; text: MessageTemplate }
export type MessageInput = string | {message:string;text?:MessageTemplate};
/** Optional text metadata may come from an older or third-party project archive. */
export function validMessageTemplate(value:unknown):value is MessageTemplate {
  let remaining=1024;
  const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const visit=(v:unknown,depth:number):boolean=>{
    if(--remaining<0||depth>16||!object(v)||typeof v.key!=='string'||!object(v.values))return false;
    return Object.values(v.values).every(item=>{
      if(--remaining<0)return false;
      return typeof item==='string'||typeof item==='number'&&Number.isFinite(item)||visit(item,depth+1);
    });
  };
  return visit(value,0);
}
export function formatMessage(text: MessageTemplate, translate: (key: string) => string = key => key, maxLength=Infinity): string {
  const template=translate(text.key),tokens=/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
  if(template.length>maxLength)throw new RangeError('Message exceeds display limit');
  const parts:string[]=[];let length=0,offset=0,match:RegExpExecArray|null;
  const append=(part:string)=>{length+=part.length;if(length>maxLength)throw new RangeError('Message exceeds display limit');parts.push(part);};
  while((match=tokens.exec(template))){
    append(template.slice(offset,match.index));
    if(!Object.hasOwn(text.values,match[1]))append(match[0]);
    else{
      const value=text.values[match[1]];
      append(typeof value==='object'?formatMessage(value,translate,maxLength-length):String(value));
    }
    offset=match.index+match[0].length;
  }
  append(template.slice(offset));return parts.join('');
}
export function m(key: string, values: MessageTemplate['values'] = {}): DiagnosticMessage {
  const text = {key, values};
  return {message: formatMessage(text), text};
}
export function joinMessages(items:readonly MessageInput[], separator='；'):DiagnosticMessage {
  const values:MessageTemplate['values']={separator:m(separator).text};
  items.forEach((item,index)=>{values['item'+index]=typeof item==='string'?item:item.text||item.message;});
  return m(items.map((_,index)=>'{item'+index+'}').join('{separator}'),values);
}
export const messageFields = (value: MessageInput): {message:string;text?:MessageTemplate} => typeof value === 'string' ? {message:value} : {message:value.message,...(value.text?{text:value.text}:{})};
export class MessageError extends Error {
  readonly text?:MessageTemplate;
  constructor(value:MessageInput){const fields=messageFields(value);super(fields.message);this.text=fields.text;}
}
export function errorMessage(error:unknown, includeName=false):MessageInput {
  if(error instanceof MessageError)return includeName ? m('{name}: {detail}',{name:error.name,detail:error.text||error.message}) : messageFields(error);
  return !includeName && error instanceof Error ? error.message : String(error);
}
