import { Alert, Button, Card, Modal, Space } from 'antd';
import { t } from '../i18n';
import type { MasterKind } from '../core/project/types';

export function Examples({open,busy,onClose,onSelect}:{open:boolean;busy:boolean;onClose:()=>void;onSelect:(kind:MasterKind,example:'teaching'|'talon')=>void}) {
  return <Modal title={t('打开示例')} open={open} closable={!busy} maskClosable={!busy} keyboard={!busy} onCancel={onClose} footer={<Button disabled={busy} onClick={onClose}>{t('取消')}</Button>}>
    <Card size="small" title={t('Talon 七轴机械臂')}>
      <p>{t('包含 7 个驱动器、完整关节绑定、URDF 与 8 个 STL 模型，以及 IgH / ECM 配置和原始 ENI。两种打开方式均保留全部文件。')}</p>
      <p>{t('APP 启动配置与空载参数已补齐；原始硬件映射待核对，ECM 许可证需自行填写。')}</p>
      <Space wrap>
        <Button type="primary" loading={busy} onClick={()=>onSelect('igh','talon')}>{t('打开 Talon IgH 示例')}</Button>
        <Button loading={busy} onClick={()=>onSelect('ecm','talon')}>{t('打开 Talon ECM 示例')}</Button>
      </Space>
    </Card>
    <div className="space-top">
    <Alert type="info" showIcon message={t('示例包含主站、单轴模型、Hardware、绑定、APP 和附件，可离线编辑与保存。机械参数为教学值，需手动确认；示例 ENI 仅用于解析演示，未经过 SDK 或实机验证。')}/>
    <Space direction="vertical" className="space-top" style={{width:'100%'}}>
      {(['igh','ecm'] as const).map(kind=><Card key={kind} size="small" title={kind==='igh'?'ROCOS-IGH':'ROCOS-ECM'}>
        <p>{kind==='igh'?t('包含显式 PDO 条目和硬件映射。'):t('包含启动 YAML 和只读 ENI 过程映像。')}</p>
        <Button disabled={busy} onClick={()=>onSelect(kind,'teaching')}>{kind==='igh'?t('打开 ROCOS-IGH 示例'):t('打开 ROCOS-ECM 示例')}</Button>
      </Card>)}
    </Space>
    </div>
  </Modal>;
}
