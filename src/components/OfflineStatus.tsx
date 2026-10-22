import { t } from '../i18n';
import { isDesktop } from '../adapters/file-access';
import { useEffect, useRef, useState } from 'react';
import { Button, Space, Tag, Tooltip } from 'antd';

export function OfflineStatus({ hidden = false }: { hidden?: boolean }) {
  const [status, setStatus] = useState('正在准备离线缓存');
  const [waiting, setWaiting] = useState(false);
  const repair = useRef<() => void>(() => {});
  useEffect(() => {
    if (isDesktop()) { setStatus('桌面离线版'); return; }
    if (!import.meta.env.PROD) { setStatus('开发模式'); return; }
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      setStatus('离线缓存不可用'); return;
    }
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    const update = (value: string) => { if (!disposed) setStatus(value); };
    const check = (type = 'CHECK_OFFLINE') => {
      const worker = navigator.serviceWorker.controller;
      if (!worker) return;
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); update('离线缓存待检查'); }, 10000);
      channel.port1.onmessage = event => {
        clearTimeout(timer); channel.port1.close();
        update(event.data.complete ? '已可离线使用' : '离线缓存不完整');
      };
      worker.postMessage({ type }, [channel.port2]);
    };
    repair.current = () => { update('正在修复离线缓存'); check('REPAIR_OFFLINE'); };
    const onController = () => check();
    const onVisibility = () => { if (document.visibilityState === 'visible') check(); };
    navigator.serviceWorker.addEventListener('controllerchange', onController);
    document.addEventListener('visibilitychange', onVisibility);
    const watchUpdate = () => {
      const worker = registration?.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (disposed) return;
        if (worker.state === 'installed') {
          setWaiting(Boolean(registration?.waiting)); check();
        } else if (worker.state === 'redundant') update('离线缓存更新失败');
      });
    };
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL, updateViaCache: 'none',
    }).then(value => {
      if (disposed) return;
      registration = value;
      setWaiting(Boolean(value.waiting));
      value.addEventListener('updatefound', watchUpdate);
      watchUpdate(); check();
    }).catch(() => update('离线缓存不可用'));
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onController);
      document.removeEventListener('visibilitychange', onVisibility);
      registration?.removeEventListener('updatefound', watchUpdate);
    };
  }, []);
  if (hidden) return null;
  const color = ['已可离线使用', '桌面离线版'].includes(status) ? 'green'
    : ['离线缓存不可用', '离线缓存更新失败'].includes(status) ? 'red'
    : waiting || ['离线缓存不完整', '离线缓存待检查'].includes(status) ? 'orange' : 'blue';
  return <Space size={8}><Tooltip title={isDesktop()?t("应用资源已随桌面程序打包；工程需单独保存为 .rcproj。"):waiting
    ? t("新版本已缓存。请先下载工程，然后关闭本应用所有窗口；再次打开时使用新版本。")
    : t("离线缓存仅保存应用资源；工程请单独下载 .rcproj 留存。浏览器清理缓存后需重新联网缓存。")}>
    <Tag className="topbar-status" role="status" color={color}>{waiting ? `${t(status)} · ${t('有更新')}` : t(status)}</Tag>
  </Tooltip>{['离线缓存不完整', '离线缓存待检查'].includes(status) && <Button onClick={() => repair.current()}>{t("修复缓存")}</Button>}</Space>;
}
