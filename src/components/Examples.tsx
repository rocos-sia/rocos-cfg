import { Alert, Button, Card, Modal, Space } from 'antd';
import { t } from '../i18n';
import type { MasterKind } from '../core/project/types';

export function Examples({open,onClose,onSelect}:{open:boolean;onClose:()=>void;onSelect:(kind:MasterKind)=>void}) {
  return <Modal title={t('打开教学示例')} open={open} onCancel={onClose} footer={<Button onClick={onClose}>{t('取消')}</Button>}>
    <Alert type="info" showIcon message={t('示例包含主站、单轴模型、Hardware、绑定、APP 和附件，可离线编辑与保存。机械参数为教学值，需手动确认；示例 ENI 仅用于解析演示，未经过 SDK 或实机验证。')}/>
    <Space direction="vertical" className="space-top" style={{width:'100%'}}>
      {(['igh','ecm'] as const).map(kind=><Card key={kind} size="small" title={kind==='igh'?'ROCOS-IGH':'ROCOS-ECM'}>
        <p>{kind==='igh'?t('包含显式 PDO 条目和硬件映射。'):t('包含启动 YAML 和只读 ENI 过程映像。')}</p>
        <Button type="primary" onClick={()=>onSelect(kind)}>{kind==='igh'?t('打开 ROCOS-IGH 示例'):t('打开 ROCOS-ECM 示例')}</Button>
      </Card>)}
    </Space>
  </Modal>;
}
