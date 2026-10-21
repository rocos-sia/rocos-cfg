/** Serializable diagnostic text; values remain data, never translation keys. */
export interface MessageTemplate {
  key: string;
  values: Record<string, string | number | MessageTemplate>;
}
export interface DiagnosticMessage { message: string; text: MessageTemplate }
export type MessageInput = string | {message:string;text?:MessageTemplate};
export function formatMessage(text: MessageTemplate, translate: (key: string) => string = key => key): string {
  return translate(text.key).replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (token, key) => {
    if (!Object.hasOwn(text.values, key)) return token;
    const value = text.values[key];
    return typeof value === 'object' ? formatMessage(value, translate) : String(value);
  });
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
