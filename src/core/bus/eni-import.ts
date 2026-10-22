import { stringify } from 'yaml';
import { child, children, content, decodeXml, xmlDocument, xmlNumber } from '../documents/xml';
import { readYaml, yamlDocument } from '../documents/yaml';
import { configuration, configure, selectMaster } from '../project/configuration';
import { makeFile } from '../project/create';
import { relativePath } from '../project/paths';
import { collectReferences } from '../project/references';
import { starterData } from '../project/templates';
import { fileById, textOf, utf8, type Project } from '../project/types';
import { buildBusCatalog } from './catalog';
import { buildIghCatalog } from './igh';

const number = (value:string, max=65535) => {
  if (!/^(?:[0-9]+|#x[0-9a-f]+|0x[0-9a-f]+)$/i.test(value)) throw new Error('ENI 包含无效整数');
  const n=xmlNumber(value.replace(/^#X/,'#x'));
  if (!Number.isSafeInteger(n)||n<0||n>max) throw new Error('ENI 整数超出支持范围');
  return n;
};

/** Convert only explicitly assigned PDOs; never treat the device's PDO catalog as its active mapping. */
export function eniToIgh(bytes:Uint8Array) {
  const {text}=decodeXml(bytes),root=xmlDocument(text).documentElement;
  if(root.localName!=='EtherCATConfig'||root.getAttribute('Version')!=='1.3')throw new Error('请选择 EtherCAT ENI 文件');
  const config=child(root,'Config');if(!config)throw new Error('ENI 缺少 Config');
  const cyclic=children(config,'Cyclic'),cycles=cyclic.map(c=>number(content(c,'CycleTime'),4294967295));
  if(!cycles.length||cycles.some(c=>c!==cycles[0]))throw new Error('ENI 必须具有单一通信周期');
  const slaves=children(config,'Slave').map((slave,id)=>{
    const pd=child(slave,'ProcessData');if(!pd)throw new Error('ENI 缺少从站 ProcessData');
    const mailbox=child(slave,'Mailbox'),coe=mailbox&&child(mailbox,'CoE'),cmds=coe&&child(coe,'InitCmds');
    const commands=cmds?children(cmds,'InitCmd'):[];
    const init_commands=commands.flatMap(cmd=>{
      const index=number(content(cmd,'Index'));
      if((index>=0x1600&&index<=0x1bff)||index===0x1c12||index===0x1c13)return [];
      const data=content(cmd,'Data');
      if(content(cmd,'Transition')!=='PS'||content(cmd,'Ccs')!=='1'||cmd.getAttribute('CompleteAccess')==='1'||!/^(?:[0-9a-f]{2})+$/i.test(data)||![2,4,8,16].includes(data.length))throw new Error('ENI 包含无法转换为 IGH 的 SDO 初始化命令');
      return [{index,sub_index:number(content(cmd,'SubIndex'),255),type:`uint${data.length*4}`,value:BigInt('0x'+data.match(/../g)!.reverse().join(''))}];
    });
    const pdos=(tag:'RxPdo'|'TxPdo',sm:number)=>{
      const manager=child(pd,`Sm${sm}`),assigned=manager?children(manager,'Pdo'):[];
      const all=children(pd,tag),ids=assigned.length?assigned.map(p=>number(p.textContent?.trim()??'')):all.filter(p=>p.getAttribute('Sm')===String(sm)).map(p=>number(content(p,'Index')));
      if(!ids.length||new Set(ids).size!==ids.length)throw new Error('ENI 缺少明确且唯一的 PDO 分配');
      for(const cmd of commands.filter(c=>number(content(c,'Index'))===(sm===2?0x1c12:0x1c13))){
        const data=content(cmd,'Data'),sub=number(content(cmd,'SubIndex'));
        if(content(cmd,'Transition')!=='PS'||content(cmd,'Ccs')!=='1'||cmd.getAttribute('CompleteAccess')==='1'||!/^(?:[0-9a-f]{2}){1,4}$/i.test(data))throw new Error('ENI PDO 分配命令不受支持');
        const value=Number(BigInt('0x'+data.match(/../g)!.reverse().join('')));
        if(sub===0?(value!==0&&value!==ids.length):ids[sub-1]!==value)throw new Error('ENI PDO 分配命令与过程数据不一致');
      }
      const result=ids.map(index=>{
        const matches=all.filter(p=>number(content(p,'Index'))===index);
        if(matches.length!==1)throw new Error('ENI 的已分配 PDO 缺少唯一条目定义');
        const entries=children(matches[0],'Entry').map((entry,i)=>{
          const object=number(content(entry,'Index'));
          return {name:content(entry,'Name')||(object===0?`Padding_${index.toString(16)}_${i}`:`Object_${object.toString(16)}_${content(entry,'SubIndex')}`),index:object,sub_index:number(content(entry,'SubIndex')||(object===0?'0':''),255),bit_length:number(content(entry,'BitLen'),255)};
        });
        if(!entries.length)throw new Error('ENI 的已分配 PDO 缺少条目定义');
        // Dynamic mapping writes must agree with the declared PDO layout.
        for(const cmd of commands.filter(c=>number(content(c,'Index'))===index)){
          const sub=number(content(cmd,'SubIndex')),data=content(cmd,'Data');
          if(content(cmd,'Transition')!=='PS'||content(cmd,'Ccs')!=='1'||cmd.getAttribute('CompleteAccess')==='1'||!/^(?:[0-9a-f]{2}){1,4}$/i.test(data))throw new Error('ENI PDO 初始化数据无效');
          const value=BigInt('0x'+data.match(/../g)!.reverse().join(''));
          const entry=entries[sub-1];
          if(sub===0?(value!==0n&&value!==BigInt(entries.length)):(!entry||value!==BigInt(entry.index*65536+entry.sub_index*256+entry.bit_length)))throw new Error('ENI PDO 初始化命令与条目定义不一致');
        }
        return {index,entries};
      });
      const range=child(pd,sm===2?'Send':'Recv');
      if(range&&number(content(range,'BitLength'),4294967295)!==result.reduce((total,p)=>total+p.entries.reduce((n,e)=>n+e.bit_length,0),0))throw new Error('ENI PDO 位宽与过程数据范围不一致');
      return result;
    };
    return {id,name:content(child(slave,'Info'),'Name'),dc_ref:content(child(slave,'DC'),'ReferenceClock')==='1',rx_pdos:pdos('RxPdo',2),tx_pdos:pdos('TxPdo',3),init_commands};
  });
  const data={version:1,master:{...starterData().igh.master,period_us:cycles[0]},slaves};
  const file=makeFile('master/igh.yaml','igh',stringify(data));
  if(buildIghCatalog(file).diagnostics.some(d=>d.severity==='error'))throw new Error('ENI 转换结果不符合 IGH 配置规则');
  return data;
}

export function planEniImport(base:Project,bytes:Uint8Array) {
  const converted=eniToIgh(bytes),project=structuredClone(base),active=project.entrypoints.master.kind;
  const oldIgh=active==='igh'?fileById(base,base.entrypoints.master.fileId):(fileById(base,configuration(base).masters.igh?.entry.fileId)??base.files.find(f=>f.role==='igh'));
  let overwrite=false;
  if(oldIgh){try{overwrite=!!base.editor.buffers[oldIgh.id]||stringify(readYaml(textOf(oldIgh)))!==stringify(readYaml(stringify(starterData().igh)));}catch{overwrite=true;}}
  selectMaster(project,'igh');const igh=fileById(project,project.entrypoints.master.fileId)!;
  let oldMaster;try{oldMaster=readYaml(textOf(igh))?.master;}catch{/* Confirmed replacement may repair malformed YAML. */}
  // ENI supplies PDOs and cycle; retain vendor-specific startup settings and the shared ID.
  if(oldMaster&&typeof oldMaster==='object')converted.master={...converted.master,...oldMaster,period_us:converted.master.period_us};
  const currentId=buildBusCatalog(base).masterId;
  if(currentId!==undefined&&Number.isFinite(currentId))converted.master.master_id=currentId;
  igh.bytes=utf8.encode(stringify(converted));delete project.editor.buffers[igh.id];
  selectMaster(project,'ecm');const ecm=fileById(project,project.entrypoints.master.fileId)!;
  if(project.editor.buffers[ecm.id])throw new Error('请先处理主站源码草稿');
  let eni=fileById(project,project.entrypoints.master.eniFileId);
  if(!eni){let path='master/imported-eni.xml',i=1;while(project.files.some(f=>f.path===path))path=`master/imported-eni-${i++}.xml`;eni=makeFile(path,'eni','');project.files.push(eni);}
  eni.bytes=new Uint8Array(bytes);eni.encoding=decodeXml(bytes).encoding;
  project.entrypoints.master.eniFileId=eni.id;
  const doc=yamlDocument(textOf(ecm));doc.setIn(['eni'],relativePath(ecm.path,eni.path));doc.setIn(['cycle'],converted.master.period_us);doc.setIn(['id'],converted.master.master_id??0);ecm.bytes=utf8.encode(doc.toString());
  configure(project).enabled.bus=true;
  if(buildBusCatalog(project).diagnostics.some(d=>d.severity==='error'))throw new Error('ENI 不符合 ECM 过程数据规则');
  selectMaster(project,active);
  project.editor.confirmations={};project.references=collectReferences(project);
  // A malformed existing startup document must not be silently exported as valid.
  if(buildIghCatalog(igh).diagnostics.some(d=>d.severity==='error'))throw new Error('请先修复 IGH 启动参数');
  return {project,overwrite};
}
