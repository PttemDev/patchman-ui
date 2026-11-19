import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { gcpAPI } from '@/services/api';
import { gcpData } from '@/stores/gcpStore';
import { extractErr } from '@/components/git/util';

// /auth/google-cloud/callback: Google sends the user back here after "Connect
// Google Cloud"; the code goes to the backend (which keeps the refresh token)
// and the opener window is told to refresh its credential list.
export function GcpCallbackPage() {
  const { t } = useTranslation('gcp');
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [msg, setMsg] = useState('');
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const q = new URLSearchParams(window.location.search);
    const code = q.get('code') ?? '';
    const st = q.get('state') ?? '';
    if (q.get('error') || !code || !st) { setState('failed'); setMsg(q.get('error') ?? ''); return; }
    gcpAPI.oauthComplete({ code, state: st }).then((r) => {
      const account = gcpData<{ account?: string }>(r).account;
      setState('done');
      window.opener?.postMessage({ type: 'patchman:gcp-linked', account }, window.location.origin);
      setTimeout(() => window.close(), 1200);
    }).catch((e) => { setState('failed'); setMsg(extractErr(e, '')); });
  }, []);
  return (
    <div className="flex h-screen items-center justify-center bg-background p-6 text-sm">
      <div className="flex max-w-md items-start gap-2">
        {state === 'working' ? <Loader2 className="h-5 w-5 animate-spin" /> : state === 'done' ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <XCircle className="h-5 w-5 text-destructive" />}
        <div>
          <div>{t(`callback.${state}`)}</div>
          {msg && <div className="mt-1 text-xs text-muted-foreground">{msg}</div>}
        </div>
      </div>
    </div>
  );
}
