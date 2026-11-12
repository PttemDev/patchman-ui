import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Check, ShieldCheck, ShieldX, AlertTriangle, ShieldQuestion, Braces } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

// ---- base64url helpers (UTF-8 safe, padding-tolerant) ----------------------

function bytesFromB64url(input: string): Uint8Array {
  let s = input.replace(/-/g, '+').replace(/_/g, '/').trim();
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function strFromB64url(input: string): string {
  return new TextDecoder().decode(bytesFromB64url(input));
}

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlFromStr(str: string): string {
  return b64urlFromBytes(new TextEncoder().encode(str));
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function isJson(raw: string): boolean {
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

const HMAC_HASH: Record<string, string> = {
  HS256: 'SHA-256',
  HS384: 'SHA-384',
  HS512: 'SHA-512',
};

async function hmacSign(alg: string, secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: HMAC_HASH[alg] || 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ---- decode model ----------------------------------------------------------

interface Decoded {
  ok: boolean;
  error?: string;
  header: string;
  payload: string;
  signature: string;
  headerB64: string;
  payloadB64: string;
}

function decodeToken(token: string): Decoded {
  const empty: Decoded = {
    ok: false,
    header: '',
    payload: '',
    signature: '',
    headerB64: '',
    payloadB64: '',
  };
  const tk = token.trim();
  if (!tk) return empty;
  const parts = tk.split('.');
  if (parts.length < 2) {
    // Error is returned as an i18n key (into the `devtools` namespace) so the
    // component can translate it — decodeToken runs at module scope, no hook.
    return { ...empty, error: 'jwt.decode.tooFewSegments' };
  }
  try {
    const header = strFromB64url(parts[0]);
    const payload = strFromB64url(parts[1]);
    return {
      ok: true,
      header: prettyJson(header),
      payload: prettyJson(payload),
      signature: parts[2] || '',
      headerB64: parts[0],
      payloadB64: parts[1],
    };
  } catch {
    return { ...empty, error: 'jwt.decode.decodeFailed' };
  }
}

function fmtEpoch(v: unknown): string | null {
  if (typeof v !== 'number') return null;
  return new Date(v * 1000).toLocaleString();
}

function ClaimChip({ name, value }: { name: string; value: unknown }) {
  const human = fmtEpoch(value);
  if (human == null) return null;
  return (
    <Badge variant="secondary" className="font-mono text-[11px] font-normal">
      {name}: {human}
    </Badge>
  );
}

function StatusBadge({ claims }: { claims: Record<string, unknown> }) {
  const { t } = useTranslation('devtools');
  const now = Date.now() / 1000;
  const exp = typeof claims.exp === 'number' ? claims.exp : undefined;
  const nbf = typeof claims.nbf === 'number' ? claims.nbf : undefined;
  if (exp != null && now > exp) return <Badge variant="destructive">{t('jwt.expired')}</Badge>;
  if (nbf != null && now < nbf) return <Badge variant="warning">{t('jwt.notYetValid')}</Badge>;
  if (exp != null || nbf != null) return <Badge variant="success">{t('jwt.validTime')}</Badge>;
  return <Badge variant="info">{t('jwt.noExpiryClaim')}</Badge>;
}

function CopyButton({ value, className }: { value: string; className?: string }) {
  const { t } = useTranslation('devtools');
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ title: t('copy.toClipboard') });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: t('copy.failed'), variant: 'destructive' });
    }
  };
  return (
    <Button type="button" size="sm" variant="ghost" className={cn('h-7 w-7 p-0 shrink-0', className)} onClick={copy} disabled={!value}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

// EncodedEditor renders the token as an editable, colour-coded field: header
// (rose), payload (fuchsia), signature (sky) — jwt.io style. It layers a
// transparent <textarea> over a coloured <pre> backdrop so editing stays live
// while the segments are highlighted.
function EncodedEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation('devtools');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const syncScroll = () => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };
  const parts = value.split('.');
  const seg0 = parts[0] ?? '';
  const seg1 = parts.length > 1 ? parts[1] : undefined;
  const seg2 = parts.length > 2 ? parts.slice(2).join('.') : undefined;

  return (
    <div className="relative h-[240px] rounded-md border bg-muted/30 overflow-hidden">
      <pre
        ref={preRef}
        aria-hidden
        className="absolute inset-0 m-0 p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all overflow-auto pointer-events-none select-none"
      >
        <span className="text-rose-500 dark:text-rose-400">{seg0}</span>
        {seg1 !== undefined && <span className="text-muted-foreground">.</span>}
        {seg1 !== undefined && <span className="text-fuchsia-500 dark:text-fuchsia-400">{seg1}</span>}
        {seg2 !== undefined && <span className="text-muted-foreground">.</span>}
        {seg2 !== undefined && <span className="text-sky-500 dark:text-sky-400">{seg2}</span>}
        {'\n'}
      </pre>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        placeholder={t('jwt.tokenPlaceholder')}
        className="absolute inset-0 m-0 p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all bg-transparent text-transparent resize-none outline-none overflow-auto placeholder:text-muted-foreground"
        style={{ caretColor: 'hsl(var(--foreground))' }}
      />
    </div>
  );
}

// ---- tool ------------------------------------------------------------------

const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkdldG1hbiIsImlhdCI6MTUxNjIzOTAyMn0.Ls3qODZ-KRf1ZU2-qhuMw1yJF5zzJ0sLrfLC8o9pPzE';
const SAMPLE_SECRET = 'your-256-bit-secret';
const SAMPLE_DECODED = decodeToken(SAMPLE);

type VerifyState = { state: 'valid' | 'invalid' | 'unsigned' | 'idle' | 'error'; msg?: string };

export function JwtTool() {
  const { t } = useTranslation('devtools');
  // Encoded token is the shared value; header/payload are the decoded view.
  // Editing either side updates the other; the verify effect is the single
  // source of truth for the signature badge.
  const [encoded, setEncoded] = useState(SAMPLE);
  const [header, setHeader] = useState(SAMPLE_DECODED.header);
  const [payload, setPayload] = useState(SAMPLE_DECODED.payload);
  const [secret, setSecret] = useState(SAMPLE_SECRET);
  const [publicKey, setPublicKey] = useState('');
  const [encErr, setEncErr] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyState>({ state: 'idle' });

  const alg = useMemo(() => {
    try {
      const h = JSON.parse(header);
      return typeof h?.alg === 'string' ? h.alg : 'HS256';
    } catch {
      return 'HS256';
    }
  }, [header]);
  const isHS = alg.startsWith('HS');

  const claims = useMemo<Record<string, unknown>>(() => {
    try {
      const p = JSON.parse(payload);
      return p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }, [payload]);

  // Re-encode (sign) from the decoded header/payload. HS* signs with the
  // secret; RS* keeps the existing signature segment (no private key here).
  const regenerate = async (h: string, p: string, sec: string) => {
    let hObj: unknown;
    let pObj: unknown;
    try {
      hObj = JSON.parse(h);
    } catch {
      setEncErr(t('jwt.headerInvalidJson'));
      return;
    }
    try {
      pObj = JSON.parse(p);
    } catch {
      setEncErr(t('jwt.payloadInvalidJson'));
      return;
    }
    setEncErr(null);
    const a = typeof (hObj as { alg?: unknown }).alg === 'string' ? (hObj as { alg: string }).alg : 'HS256';
    const hB64 = b64urlFromStr(JSON.stringify(hObj));
    const pB64 = b64urlFromStr(JSON.stringify(pObj));
    if (a.startsWith('HS')) {
      try {
        const sig = await hmacSign(a, sec, `${hB64}.${pB64}`);
        setEncoded(`${hB64}.${pB64}.${b64urlFromBytes(sig)}`);
      } catch (e) {
        setEncErr(e instanceof Error ? e.message : t('jwt.signingFailed'));
      }
    } else {
      const oldSig = encoded.split('.')[2] ?? '';
      setEncoded(`${hB64}.${pB64}.${oldSig}`);
    }
  };

  const onEncodedChange = (v: string) => {
    setEncoded(v);
    const d = decodeToken(v);
    if (d.ok) {
      setHeader(d.header);
      setPayload(d.payload);
      setEncErr(null);
    } else {
      setEncErr(d.error ? t(d.error) : null);
    }
  };

  const onHeaderChange = (v: string) => {
    setHeader(v);
    void regenerate(v, payload, secret);
  };
  const onPayloadChange = (v: string) => {
    setPayload(v);
    void regenerate(header, v, secret);
  };
  const onSecretChange = (v: string) => {
    setSecret(v);
    if (isHS) void regenerate(header, payload, v);
  };
  const onAlgChange = (a: string) => {
    let hObj: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(header);
      if (parsed && typeof parsed === 'object') hObj = parsed as Record<string, unknown>;
    } catch {
      /* start fresh */
    }
    hObj.alg = a;
    if (!hObj.typ) hObj.typ = 'JWT';
    const nh = JSON.stringify(hObj, null, 2);
    setHeader(nh);
    void regenerate(nh, payload, secret);
  };

  // Single source of truth for the signature badge.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = decodeToken(encoded);
      if (!d.ok) {
        if (!cancelled) setVerify({ state: 'idle' });
        return;
      }
      if (!d.signature) {
        if (!cancelled) setVerify({ state: 'unsigned' });
        return;
      }
      const signingInput = `${d.headerB64}.${d.payloadB64}`;
      try {
        if (alg.startsWith('HS')) {
          const sig = await hmacSign(alg, secret, signingInput);
          const ok = b64urlFromBytes(sig) === d.signature;
          if (!cancelled) setVerify({ state: ok ? 'valid' : 'invalid' });
        } else if (alg === 'RS256') {
          if (!publicKey.trim()) {
            if (!cancelled) setVerify({ state: 'idle' });
            return;
          }
          const key = await crypto.subtle.importKey(
            'spki',
            pemToDer(publicKey),
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['verify']
          );
          const ok = await crypto.subtle.verify(
            'RSASSA-PKCS1-v1_5',
            key,
            bytesFromB64url(d.signature),
            new TextEncoder().encode(signingInput)
          );
          if (!cancelled) setVerify({ state: ok ? 'valid' : 'invalid' });
        } else {
          if (!cancelled) setVerify({ state: 'error', msg: t('jwt.unsupportedAlg', { alg }) });
        }
      } catch (e) {
        if (!cancelled) setVerify({ state: 'error', msg: e instanceof Error ? e.message : t('jwt.verificationFailed') });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encoded, secret, publicKey, alg]);

  const handleSample = () => {
    onEncodedChange(SAMPLE);
    setSecret(SAMPLE_SECRET);
  };
  const handleClear = () => {
    setEncoded('');
    setHeader('');
    setPayload('');
    setEncErr(null);
  };

  return (
    <div className="p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---- Encoded ---- */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">{t('jwt.encoded')}</Label>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleSample}>{t('actions.sample')}</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleClear}>{t('actions.clear')}</Button>
              <CopyButton value={encoded} />
            </div>
          </div>

          <EncodedEditor value={encoded} onChange={onEncodedChange} />

          {/* Verify status bar */}
          <VerifyBar verify={verify} isHS={isHS} />

          {encErr && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{encErr}</span>
            </div>
          )}

          {/* Time claims */}
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge claims={claims} />
            <ClaimChip name="iat" value={claims.iat} />
            <ClaimChip name="nbf" value={claims.nbf} />
            <ClaimChip name="exp" value={claims.exp} />
          </div>
        </div>

        {/* ---- Decoded ---- */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-rose-500 dark:text-rose-400">
                {t('jwt.header')} <span className="font-normal text-muted-foreground">{t('jwt.headerSub')}</span>
              </Label>
              <button
                type="button"
                onClick={() => onHeaderChange(prettyJson(header))}
                disabled={!isJson(header)}
                title={t('jwt.beautifyJson')}
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <Braces className="h-3 w-3" /> {t('jwt.beautify')}
              </button>
            </div>
            <Textarea
              value={header}
              onChange={(e) => onHeaderChange(e.target.value)}
              className={cn(
                'font-mono text-xs min-h-[92px] border-l-2 border-l-rose-500/50',
                header.trim() && !isJson(header) && 'border-amber-500/60'
              )}
              spellCheck={false}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-fuchsia-500 dark:text-fuchsia-400">
                {t('jwt.payload')} <span className="font-normal text-muted-foreground">{t('jwt.payloadSub')}</span>
              </Label>
              <button
                type="button"
                onClick={() => onPayloadChange(prettyJson(payload))}
                disabled={!isJson(payload)}
                title={t('jwt.beautifyJson')}
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <Braces className="h-3 w-3" /> {t('jwt.beautify')}
              </button>
            </div>
            <Textarea
              value={payload}
              onChange={(e) => onPayloadChange(e.target.value)}
              className={cn(
                'font-mono text-xs min-h-[120px] border-l-2 border-l-fuchsia-500/50',
                payload.trim() && !isJson(payload) && 'border-amber-500/60'
              )}
              spellCheck={false}
            />
          </div>

          <div className="space-y-2 rounded-md border border-l-2 border-l-sky-500/50 p-3">
            <Label className="text-xs font-medium text-sky-500 dark:text-sky-400">{t('jwt.verifySignature')}</Label>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground w-16 shrink-0">{t('jwt.algorithm')}</span>
              <Select value={isHS || alg === 'RS256' ? alg : 'HS256'} onValueChange={onAlgChange}>
                <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="HS256">HS256</SelectItem>
                  <SelectItem value="HS384">HS384</SelectItem>
                  <SelectItem value="HS512">HS512</SelectItem>
                  <SelectItem value="RS256">RS256</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isHS ? (
              <div className="space-y-1.5">
                <span className="text-[11px] text-muted-foreground">{t('jwt.secret')}</span>
                <Input
                  value={secret}
                  onChange={(e) => onSecretChange(e.target.value)}
                  placeholder={t('jwt.secretPlaceholder')}
                  className="font-mono text-xs"
                  spellCheck={false}
                />
                <p className="text-[10px] text-muted-foreground">
                  {t('jwt.hsHint')}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <span className="text-[11px] text-muted-foreground">{t('jwt.publicKey')}</span>
                <Textarea
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  placeholder={'-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----'}
                  className="font-mono text-xs min-h-[110px] break-all"
                  spellCheck={false}
                />
                <p className="text-[10px] text-muted-foreground">
                  {t('jwt.rsHint')}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function VerifyBar({ verify, isHS }: { verify: VerifyState; isHS: boolean }) {
  const { t } = useTranslation('devtools');
  if (verify.state === 'valid') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <ShieldCheck className="h-4 w-4 shrink-0" /> {t('jwt.signatureVerified')}
      </div>
    );
  }
  if (verify.state === 'invalid') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
        <ShieldX className="h-4 w-4 shrink-0" /> {t('jwt.invalidSignature')}
      </div>
    );
  }
  if (verify.state === 'error') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {verify.msg}
      </div>
    );
  }
  const label =
    verify.state === 'unsigned'
      ? t('jwt.unsigned')
      : isHS
      ? t('jwt.enterSecret')
      : t('jwt.enterPublicKey');
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <ShieldQuestion className="h-4 w-4 shrink-0" /> {label}
    </div>
  );
}
