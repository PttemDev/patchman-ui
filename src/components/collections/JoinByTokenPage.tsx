// Auto-join handler for shareable URLs of the form `/join/<token>`.
//
// Flow:
//   * Not logged in  → bounce to /login?next=/join/<token>; the LoginPage
//     reads `next` and resumes here after auth.
//   * Logged in      → POST the token to /collections/join, toast result,
//     redirect to /. The dialog mode landing the user picked previously
//     (by route in their session) takes care of showing the new shared
//     collection in the sidebar.
//
// Local mode is a dead end here — collection sharing is a server-only
// feature; we tell the user they need an account and stop.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useCollectionStore } from '@/stores/collectionStore';
import { collectionCollabAPI } from '@/services/api';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import type { AxiosError } from 'axios';

export function JoinByTokenPage() {
  const { t } = useTranslation('collections');
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const isAuthed = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const mode = useAuthStore((s) => s.mode);
  // refreshLists fans out to both Private (fetchCollections) and Public
  // (fetchPublicCollections) so a share-code join surfaces the collection
  // in whichever accordion section it belongs to. The owner may have
  // already toggled visibility=public, in which case Public was stale
  // until manual refresh — calling refreshLists fixes that.
  const refreshLists = useCollectionStore((s) => s.refreshLists);

  const [status, setStatus] = useState<'pending' | 'joining' | 'success' | 'error'>('pending');
  const [errorMsg, setErrorMsg] = useState('');
  const [collectionName, setCollectionName] = useState('');
  // Single-flight guard so a strict-mode double-invocation or a
  // dep-change re-run only fires one POST per mount.
  const joinFiredRef = useRef(false);
  // Unmounted-only guard. The previous version flipped a `cancelled`
  // flag in the effect cleanup, but that cleanup ALSO runs on every
  // dep change — App.tsx's loadUser() races this page on a fresh
  // tab and flips authStore.isLoading mid-await, which made the
  // cleanup mark our in-flight join as "cancelled" and we never
  // updated state when the response landed (stuck on "Joining…").
  const mountedRef = useRef(true);
  useEffect(() => {
    // Re-assert true in the effect body; StrictMode in dev runs the
    // cleanup once during its synchronous mount/unmount/mount
    // simulation, which would otherwise leave .current == false
    // even though the component is still mounted.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMsg(t('join.noToken'));
      return;
    }
    if (isLoading) return;

    if (!isAuthed) {
      // Bounce through login. LoginPage will read ?next= and come back.
      const next = encodeURIComponent(`/join/${token}`);
      navigate(`/login?next=${next}`, { replace: true });
      return;
    }

    if (mode === 'local') {
      setStatus('error');
      setErrorMsg(t('join.requiresAccount'));
      return;
    }

    if (joinFiredRef.current) return;
    joinFiredRef.current = true;

    (async () => {
      setStatus('joining');
      try {
        const res = await collectionCollabAPI.join(token);
        if (!mountedRef.current) return;
        const collection = res.data?.collection;
        const name = collection?.name || t('import.collectionFallback');
        setCollectionName(name);
        setStatus('success');
        toast({
          title: t('join.joinedTitle'),
          description: t('join.joinedDesc', { name }),
        });
        // Refresh the sidebar so it shows up immediately on the home view.
        await refreshLists();
        if (!mountedRef.current) return;
        // Drop the user back into the app so the URL doesn't stick.
        setTimeout(() => {
          if (mountedRef.current) navigate('/', { replace: true });
        }, 800);
      } catch (err) {
        if (!mountedRef.current) return;
        const ax = err as AxiosError<{ error?: string }>;
        setStatus('error');
        setErrorMsg(ax.response?.data?.error || ax.message || t('join.failed'));
        // Allow a manual retry if the failure was transient.
        joinFiredRef.current = false;
      }
    })();
  }, [token, isAuthed, isLoading, mode, navigate, refreshLists]);

  return (
    <div className="h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-sm w-full text-center space-y-3">
        {status === 'pending' || status === 'joining' ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm">{status === 'joining' ? t('join.joining') : t('common:loading')}</p>
          </>
        ) : status === 'success' ? (
          <>
            <CheckCircle2 className="h-8 w-8 mx-auto text-green-500" />
            <p className="text-sm font-medium">{t('join.joinedNamed', { name: collectionName })}</p>
            <p className="text-xs text-muted-foreground">{t('join.redirecting')}</p>
          </>
        ) : (
          <>
            <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
            <p className="text-sm font-medium">{t('join.couldNotJoin')}</p>
            <p className="text-xs text-muted-foreground">{errorMsg}</p>
            <Button onClick={() => navigate('/', { replace: true })} variant="outline" size="sm">
              {t('join.backToApp')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
