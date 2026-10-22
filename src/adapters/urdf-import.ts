import { decodeXml, elements, isLegacyHardware, xmlDocument } from '../core/documents/xml';
import { m as msg, MessageError } from '../core/project/messages';
import { LIMITS } from '../core/project/zip';

import { resourceFilename } from '../core/project/paths';

export async function urdfMeshNames(file: File) {
  if(file.size>LIMITS.file)throw new MessageError(msg('导入文件超过限额：{v0}',{v0:file.name}));
  const doc=xmlDocument(decodeXml(new Uint8Array(await file.arrayBuffer())).text);
  if(doc.documentElement.localName!=='robot')throw new MessageError(msg('URDF 根节点必须为 robot'));
  return [...new Set(elements(doc,'mesh').filter(node=>!isLegacyHardware(node)).map(node=>resourceFilename(node.getAttribute('filename')||'')).filter(Boolean))];
}
export async function findUrdfMeshes(urdf:File, names:string[], directory:File[]) {
  // Requiring the exact parent folder prevents accidentally scanning sibling models.
  const root=directory.find(file=>file.name===urdf.name && file.webkitRelativePath.split('/').length===2);
  const matches=root && root.size===urdf.size && root.size<=LIMITS.file;
  const original=matches?new Uint8Array(await urdf.arrayBuffer()):undefined;
  const candidate=matches?new Uint8Array(await root.arrayBuffer()):undefined;
  if(!original||!candidate||original.some((byte,i)=>byte!==candidate[i]))
    throw new MessageError(msg('请选择包含所选 URDF 的同级目录（文件内容须一致）。'));
  return names.map(name=>({name,files:directory.filter(file=>file.name===name && file!==root)}));
}
