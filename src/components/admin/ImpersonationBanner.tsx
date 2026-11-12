// Banner pinned at the top of AppLayout while an admin is "managing as
// user". Sticking it above TopBar makes it impossible to forget — every
// action lands on the target user, so the admin needs an obvious way out.
//
// State lives in localStorage (so it survives reloads and propagates
// across tabs), and the api.ts request interceptor reads the same key
// to attach the X-Act-As-User header on every CRUD call.

import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ShieldAlert, X } from 'lucide-react';

const ACT_AS_KEY = 'patchman_act_as_user';
const ACT_AS_NAME_KEY = 'patchman_act_as_user_name';

export function ImpersonationBanner() {
  const { t } = useTranslation('admin');
  const [target, setTarget] = useState<string | null>(null);
  const [name, setName] = useState<string>('');

  // Track localStorage changes (this tab + others). We read on mount and
  // re-read whenever the storage event fires.
  useEffect(() => {
    const sync = () => {
      try {
        setTarget(localStorage.getItem(ACT_AS_KEY));
        setName(localStorage.getItem(ACT_AS_NAME_KEY) || '');
      } catch {
        setTarget(null);
        setName('');
      }
    };
    sync();
    window.addEventListener('storage', sync);
    // Custom event fires from the same tab — the storage event only
    // fires in OTHER tabs, so we dispatch this manually when toggling.
    window.addEventListener('patchman:act-as-changed', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('patchman:act-as-changed', sync);
    };
  }, []);

  if (!target) return null;

  const exit = () => {
    try {
      localStorage.removeItem(ACT_AS_KEY);
      localStorage.removeItem(ACT_AS_NAME_KEY);
      window.dispatchEvent(new Event('patchman:act-as-changed'));
    } catch {
      // ignore
    }
    // Hard reload so every store (collections, environments, mocks, etc.)
    // refetches with the admin's own userID.
    window.location.reload();
  };

  return (
    <div className="bg-yellow-500/15 border-b border-yellow-500/40 px-3 py-1.5 flex items-center gap-2 text-xs">
      <ShieldAlert className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400 shrink-0" />
      <span className="text-yellow-900 dark:text-yellow-100">
        <Trans t={t} i18nKey="impersonation.managingAs" values={{ user: name || target }} components={{ strong: <strong /> }} />
      </span>
      <button
        onClick={exit}
        className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded text-yellow-900 dark:text-yellow-100 hover:bg-yellow-500/20"
      >
        <X className="h-3 w-3" />
        {t('impersonation.exit')}
      </button>
    </div>
  );
}
