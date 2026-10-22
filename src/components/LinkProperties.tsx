import { ParameterLabel } from './ParameterHelp';
import { useLocalizedMessage } from './useLocalizedMessage';
import { errorText, t } from '../i18n';
import { Alert, Descriptions, Input, Tabs } from 'antd';
import { linkProperties, type GeometryView } from '../core/documents/urdf-geometry';
import { changeLinkGeometry } from '../core/documents/robot-edit';
import { useProject } from '../store';
export function LinkProperties({ text, name }: { text: string; name: string }) {
  const properties = linkProperties(text, name), message=useLocalizedMessage();
  const labels: Record<string, string> = { xyz: t("位置 xyz (m)"), rpy: t("旋转 rpy (rad)"), size: t("尺寸 xyz (m)"), radius: t("半径 (m)"), length: t("长度 (m)"), filename: t("Mesh 路径"), scale: t("Mesh 缩放 xyz") };
  return <Tabs items={[
    ...(['visual', 'collision'] as const).map(group => ({ key: group, label: `${group === 'visual' ? t("外观") : t("碰撞")} (${properties[group].length})`, children: <>
      {!properties[group].length && <p className="muted">{t('此 Link 没有 {group} 节点。',{group})}</p>}
      {properties[group].map(g => <div key={g.index} className="fields single space-top"><strong>{g.name || `${group} ${g.index + 1}`} · {g.kind}</strong>
        {(['xyz', 'rpy', ...({ box: ['size'], sphere: ['radius'], cylinder: ['radius', 'length'], mesh: ['filename', 'scale'] }[g.kind] || [])] as (keyof GeometryView)[]).map(field => <div className="field" key={field}>
          <ParameterLabel htmlFor={`${group}-${g.index}-${field}`} role="urdf" path={field}>{labels[field]}</ParameterLabel>
          <Input id={`${group}-${g.index}-${field}`} key={`${name}:${g[field]}`} defaultValue={String(g[field])} onBlur={event => {
            if (event.target.value === g[field]) return;
            try { useProject.getState().change(p => changeLinkGeometry(p, name, group, g.index, field, event.target.value)); }
            catch (error) { message.error(()=>(errorText(error,true))); }
          }} />
        </div>)}
      </div>)}
    </> })),
    { key: 'inertial', label: t("惯性"), children: properties.inertial ? <><Alert type="info" message={t("现有惯性数据只读保留；质量单位 kg，惯性单位 kg·m²。")} /><Descriptions column={1} size="small" items={Object.entries({ mass: properties.inertial.mass, xyz: properties.inertial.xyz, rpy: properties.inertial.rpy, ...properties.inertial.inertia }).map(([label, children]) => ({ key: label, label: <ParameterLabel role="urdf" path={label.startsWith("i") ? "inertia" : label}>{label}</ParameterLabel>, children }))} /></> : <p className="muted">{t("此 Link 没有 inertial 节点。")}</p> },
  ]} />;
}
