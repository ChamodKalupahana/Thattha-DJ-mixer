import { useStore } from '../state/store';
import { useI18n } from '../i18n';
import { Spinner } from './common';

export default function ToastStack() {
  const { toasts, importQueue, dismissToast } = useStore();
  const { t } = useI18n();

  return (
    <div className="toast-stack">
      {importQueue
        .filter((j) => j.status !== 'done')
        .map((j) => (
          <div key={j.id} className="toast info">
            <Spinner />
            <span>
              {j.name} — {j.status === 'probing' ? t('importing') : t('analyzing')}
            </span>
          </div>
        ))}
      {toasts.map((toast) => (
        <div key={toast.id} className={'toast ' + toast.kind}>
          <span>{toast.text}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => dismissToast(toast.id)}
            aria-label="dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
