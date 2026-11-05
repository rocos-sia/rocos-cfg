import { xmlDocument, elements } from './xml';
import { readYaml } from './yaml';
import { fileById, textOf, type Project, type ProjectFile } from '../project/types';
import { configuration } from '../project/configuration';
import { relativePath, resolvePath } from '../project/paths';

/** Includes inherit the model's compiler directories, including shared URDF meshes. */
export function mjcfEnvironment(project:Project,file:ProjectFile) {
  const run=fileById(project,configuration(project).simulationFileId);
  let selected:ProjectFile|undefined;
  if(run)try{
    const config=readYaml(textOf(run)),mapped=project.references.find(r=>r.sourceFileId===run.id&&r.field==='model'&&r.state==='internal');
    selected=fileById(project,mapped?.targetFileId)??project.files.find(f=>f.path===resolvePath(run.path,config.model??config.urdf));
  }catch{/* Invalid YAML is reported by the simulation module. */}
  const roots=[...(selected?[selected]:[]),...project.files.filter(f=>f.role==='mjcf'&&f.id!==selected?.id)];
  for(const root of roots){
    const seen=new Set<string>(),compiler:Record<string,string>={};
    const visit=(source:ProjectFile)=>{
      if(seen.has(source.id))return;seen.add(source.id);
      const doc=xmlDocument(textOf(source));
      for(const node of elements(doc,'compiler'))for(const key of ['assetdir','meshdir','texturedir','strippath'])if(node.hasAttribute(key))compiler[key]=node.getAttribute(key)!;
      for(const node of elements(doc,'include')){
        const target=project.files.find(f=>f.path===resolvePath(source.path,node.getAttribute('file')??''));if(target)visit(target);
      }
    };
    try{visit(root);}catch{continue;}
    if(seen.has(file.id))return {root,compiler};
  }
  return {root:file,compiler:{}};
}
export function mjcfReferences(doc:Document,project:Project,file:ProjectFile) {
  const {root,compiler}=mjcfEnvironment(project,file);
  return ['include','mesh','texture','hfield'].flatMap(tag=>elements(doc,tag).flatMap((el,i)=>{
    const value=el.getAttribute('file');if(!value)return [];
    if(tag==='include')return [{field:`${tag}[${i}].file`,original:value}];
    const name=compiler.strippath==='true'?value.replaceAll('\\','/').split('/').at(-1)!:value;
    const dir=compiler[tag==='texture'?'texturedir':'meshdir']??compiler.assetdir??'';
    const path=resolvePath(dir?root.path:file.path,/^(?:\/|[a-z]+:)/i.test(name)?name:dir?dir+'/'+name:name);
    return [{field:`${tag}[${i}].file`,original:path?relativePath(file.path,path):name}];
  }));
}
