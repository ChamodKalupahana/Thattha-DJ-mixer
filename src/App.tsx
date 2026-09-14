import { useState } from 'react';
import { I18nProvider, useI18n } from './i18n';
import { useStore } from './state/store';
import { newId } from './lib/util';
import type { Mix } from './db/types';
import Library from './ui/Library';
import Mixes from './ui/Mixes';
import MixEditor from './ui/MixEditor';
import ToastStack from './ui/Toasts';

export default function App() {
  const store = useStore();
  return (
    <I18nProvider lang={store.lang} onLangChange={store.setLang}>
      <Shell />
    </I18nProvider>
  );
}

function Shell() {
  const { t } = useI18n();
  const store = useStore();
  const [tab, setTab] = useState<'library' | 'mixes'>('library');
  const [editingMixId, setEditingMixId] = useState<string | null>(null);

  const openMix = (id: string) => setEditingMixId(id);
  const closeEditor = () => setEditingMixId(null);

  const startNewMix = async () => {
    const now = Date.now();
    const mix: Mix = {
      id: newId(),
      title: '',
      clips: [],
      transitions: [],
      createdAt: now,
      updatedAt: now,
    };
    await store.saveMix(mix);
    setTab('mixes');
    setEditingMixId(mix.id);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">
          <span className="logo-mark">
            <svg width="18" height="18" viewBox="0 0 64 64" aria-hidden>
              <rect x="12" y="24" width="10" height="22" rx="2" fill="#0b0e18" />
              <rect x="27" y="16" width="10" height="34" rx="2" fill="#0b0e18" />
              <rect x="42" y="20" width="10" height="26" rx="2" fill="#0b0e18" />
            </svg>
          </span>
          <span>{t('appName')}</span>
        </div>
        {!editingMixId && (
          <nav className="app-tabs">
            <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}>
              {t('tabLibrary')}
            </button>
            <button className={tab === 'mixes' ? 'active' : ''} onClick={() => setTab('mixes')}>
              {t('tabMixes')}
            </button>
          </nav>
        )}
        <div className="spacer" />
        <LangSwitch />
      </header>
      <main className="app-content">
        {editingMixId ? (
          <MixEditor mixId={editingMixId} onBack={closeEditor} />
        ) : tab === 'library' ? (
          <Library onNewMix={startNewMix} />
        ) : (
          <Mixes onOpenMix={openMix} />
        )}
      </main>
      <ToastStack />
    </div>
  );
}

function LangSwitch() {
  const { t, lang, setLang } = useI18n();
  return (
    <div className="lang-switch" title={t('language')} role="group" aria-label={t('language')}>
      <button
        className={lang === 'si' ? 'active' : ''}
        onClick={() => setLang('si')}
        disabled={lang === 'si'}
      >
        සිං
      </button>
      <button
        className={lang === 'en' ? 'active' : ''}
        onClick={() => setLang('en')}
        disabled={lang === 'en'}
      >
        EN
      </button>
    </div>
  );
}
