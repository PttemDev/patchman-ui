import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRequestStore } from '@/stores/requestStore';
import { Input } from '@/components/ui/input';
import { VariableInput } from '@/components/environment/VariableInput';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Tab, RequestAuth } from '@/types';
import { proxyAPI } from '@/services/api';
import { isDesktop } from '@/lib/platform';
import { runOAuth2Flow } from '@/lib/oauth2';

interface AuthEditorProps {
  tab: Tab;
}

function AuthHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-muted-foreground leading-relaxed">
      {children}
    </p>
  );
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5">{children}</div>;
}

export function AuthEditor({ tab }: AuthEditorProps) {
  const { t } = useTranslation('request');
  const { updateTab } = useRequestStore();
  const [tokenMessage, setTokenMessage] = useState('');

  const updateAuth = (updates: Partial<RequestAuth>) => {
    updateTab(tab.id, { auth: { ...tab.auth, ...updates } });
  };

  const auth = tab.auth;
  const grantType = auth.oauth2GrantType || 'authorization_code';

  const handleGetToken = async () => {
    setTokenMessage('');
    const grantTypeVal = auth.oauth2GrantType || 'authorization_code';

    try {
      if (grantTypeVal === 'client_credentials') {
        // Client Credentials grant: POST to token URL with client_id, client_secret, grant_type, scope
        if (!auth.oauth2TokenUrl) {
          setTokenMessage(t('auth.msg.tokenUrlRequired'));
          return;
        }
        const formBody = new URLSearchParams();
        formBody.set('grant_type', 'client_credentials');
        if (auth.oauth2ClientId) formBody.set('client_id', auth.oauth2ClientId);
        if (auth.oauth2ClientSecret) formBody.set('client_secret', auth.oauth2ClientSecret);
        if (auth.oauth2Scope) formBody.set('scope', auth.oauth2Scope);

        setTokenMessage(t('auth.msg.requestingToken'));
        const response = await proxyAPI.send({
          method: 'POST',
          url: auth.oauth2TokenUrl,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: { type: 'form', content: formBody.toString() },
          params: {},
        });

        const tokenData = typeof response.data.body === 'string' ? JSON.parse(response.data.body) : response.data.body;
        if (tokenData.access_token) {
          updateAuth({ oauth2AccessToken: tokenData.access_token });
          setTokenMessage(t('auth.msg.tokenObtained'));
        } else {
          setTokenMessage(t('auth.msg.tokenResponse', { json: JSON.stringify(tokenData) }));
        }
      } else if (grantTypeVal === 'password') {
        // Password grant: POST with username, password, client_id, client_secret, grant_type, scope
        if (!auth.oauth2TokenUrl) {
          setTokenMessage(t('auth.msg.tokenUrlRequired'));
          return;
        }
        const formBody = new URLSearchParams();
        formBody.set('grant_type', 'password');
        if (auth.username) formBody.set('username', auth.username);
        if (auth.password) formBody.set('password', auth.password);
        if (auth.oauth2ClientId) formBody.set('client_id', auth.oauth2ClientId);
        if (auth.oauth2ClientSecret) formBody.set('client_secret', auth.oauth2ClientSecret);
        if (auth.oauth2Scope) formBody.set('scope', auth.oauth2Scope);

        setTokenMessage(t('auth.msg.requestingToken'));
        const response = await proxyAPI.send({
          method: 'POST',
          url: auth.oauth2TokenUrl,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: { type: 'form', content: formBody.toString() },
          params: {},
        });

        const tokenData = typeof response.data.body === 'string' ? JSON.parse(response.data.body) : response.data.body;
        if (tokenData.access_token) {
          updateAuth({ oauth2AccessToken: tokenData.access_token });
          setTokenMessage(t('auth.msg.tokenObtained'));
        } else {
          setTokenMessage(t('auth.msg.tokenResponse', { json: JSON.stringify(tokenData) }));
        }
      } else if (grantTypeVal === 'authorization_code' || grantTypeVal === 'implicit') {
        // Authorization Code / Implicit: punt the user to the provider's auth
        // URL and wait for the callback. Web uses a popup; desktop hands the
        // URL to the OS browser and listens for a patchman:// deep-link.
        if (!auth.oauth2AuthUrl) {
          setTokenMessage(t('auth.msg.authUrlRequired'));
          return;
        }
        const defaultCallback = isDesktop()
          ? 'patchman://oauth/callback'
          : `${window.location.origin}/oauth/callback`;
        const callbackUrl = auth.oauth2CallbackUrl || defaultCallback;
        const state = auth.oauth2State || crypto.randomUUID();
        const isImplicit = grantTypeVal === 'implicit';

        const authParams = new URLSearchParams();
        authParams.set('response_type', isImplicit ? 'token' : 'code');
        if (auth.oauth2ClientId) authParams.set('client_id', auth.oauth2ClientId);
        authParams.set('redirect_uri', callbackUrl);
        authParams.set('state', state);
        if (auth.oauth2Scope) authParams.set('scope', auth.oauth2Scope);

        const separator = auth.oauth2AuthUrl.includes('?') ? '&' : '?';
        const authUrl = `${auth.oauth2AuthUrl}${separator}${authParams.toString()}`;

        setTokenMessage(t('auth.msg.openingAuth'));
        let callback;
        try {
          callback = await runOAuth2Flow({
            authUrl,
            callbackUrl,
            fragment: isImplicit,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          setTokenMessage(t('auth.msg.authFailed', { message: msg }));
          return;
        }
        if (callback.state && callback.state !== state) {
          setTokenMessage(t('auth.msg.stateMismatch'));
          return;
        }

        if (isImplicit) {
          if (callback.accessToken) {
            updateAuth({ oauth2AccessToken: callback.accessToken });
            setTokenMessage(t('auth.msg.tokenObtained'));
          } else {
            setTokenMessage(t('auth.msg.noAccessTokenFragment'));
          }
          return;
        }

        if (!callback.code) {
          setTokenMessage(t('auth.msg.noAuthCode'));
          return;
        }
        // Exchange code for token
        if (!auth.oauth2TokenUrl) {
          setTokenMessage(t('auth.msg.gotCodeNeedTokenUrl'));
          updateAuth({ oauth2AccessToken: callback.code }); // Store the code as fallback
          return;
        }
        const formBody = new URLSearchParams();
        formBody.set('grant_type', 'authorization_code');
        formBody.set('code', callback.code);
        formBody.set('redirect_uri', callbackUrl);
        if (auth.oauth2ClientId) formBody.set('client_id', auth.oauth2ClientId);
        if (auth.oauth2ClientSecret) formBody.set('client_secret', auth.oauth2ClientSecret);

        setTokenMessage(t('auth.msg.exchangingCode'));
        const response = await proxyAPI.send({
          method: 'POST',
          url: auth.oauth2TokenUrl,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: { type: 'form', content: formBody.toString() },
          params: {},
        });
        const tokenData = typeof response.data.body === 'string' ? JSON.parse(response.data.body) : response.data.body;
        if (tokenData.access_token) {
          updateAuth({ oauth2AccessToken: tokenData.access_token });
          setTokenMessage(t('auth.msg.tokenObtained'));
        } else {
          setTokenMessage(t('auth.msg.tokenExchangeResponse', { json: JSON.stringify(tokenData) }));
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('auth.msg.failedToGetToken');
      setTokenMessage(t('auth.msg.error', { message }));
    }

  };

  return (
    <div className="space-y-4">
      {/* Auth type selector */}
      <div className="flex items-center gap-3">
        <Label className="text-xs shrink-0">{t('auth.authType')}</Label>
        <Select
          value={auth.type}
          onValueChange={(value) =>
            updateAuth({ type: value as RequestAuth['type'] })
          }
        >
          <SelectTrigger className="w-[200px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('auth.noAuth')}</SelectItem>
            <SelectItem value="bearer">Bearer Token</SelectItem>
            <SelectItem value="basic">Basic Auth</SelectItem>
            <SelectItem value="apikey">API Key</SelectItem>
            <SelectItem value="oauth2">OAuth 2.0</SelectItem>
            <SelectItem value="digest">Digest Auth</SelectItem>
            <SelectItem value="aws">AWS Signature</SelectItem>
            <SelectItem value="hawk">Hawk</SelectItem>
            <SelectItem value="ntlm">NTLM</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* No Auth */}
      {auth.type === 'none' && (
        <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
          {t('auth.noAuthBody')}
        </div>
      )}

      {/* Bearer Token */}
      {auth.type === 'bearer' && (
        <div className="space-y-3 max-w-md">
          <AuthHint>
            {t('auth.bearerHint')}
          </AuthHint>
          <FieldGroup>
            <Label className="text-xs">{t('auth.token')}</Label>
            <VariableInput
              placeholder={t('auth.tokenPlaceholder')}
              value={auth.token || ''}
              onChange={(e) => updateAuth({ token: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>
        </div>
      )}

      {/* Basic Auth */}
      {auth.type === 'basic' && (
        <div className="space-y-3 max-w-md">
          <AuthHint>
            {t('auth.basicHint')}
          </AuthHint>
          <FieldGroup>
            <Label className="text-xs">{t('auth.username')}</Label>
            <VariableInput
              placeholder={t('auth.username')}
              value={auth.username || ''}
              onChange={(e) => updateAuth({ username: e.target.value })}
              className="h-8 text-xs"
            />
          </FieldGroup>
          <FieldGroup>
            <Label className="text-xs">{t('auth.password')}</Label>
            <Input
              type="password"
              placeholder={t('auth.password')}
              value={auth.password || ''}
              onChange={(e) => updateAuth({ password: e.target.value })}
              className="h-8 text-xs"
            />
          </FieldGroup>
        </div>
      )}

      {/* API Key */}
      {auth.type === 'apikey' && (
        <div className="space-y-3 max-w-md">
          <AuthHint>
            {t('auth.apiKeyHint')}
          </AuthHint>
          <FieldGroup>
            <Label className="text-xs">{t('kv.key')}</Label>
            <VariableInput
              placeholder={t('auth.apiKeyNamePlaceholder')}
              value={auth.key || ''}
              onChange={(e) => updateAuth({ key: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>
          <FieldGroup>
            <Label className="text-xs">{t('kv.value')}</Label>
            <VariableInput
              placeholder={t('auth.apiKeyValuePlaceholder')}
              value={auth.value || ''}
              onChange={(e) => updateAuth({ value: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>
          <FieldGroup>
            <Label className="text-xs">{t('auth.addTo')}</Label>
            <Select
              value={auth.addTo || 'header'}
              onValueChange={(value) =>
                updateAuth({ addTo: value as 'header' | 'query' })
              }
            >
              <SelectTrigger className="w-[200px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="header">{t('auth.header')}</SelectItem>
                <SelectItem value="query">{t('auth.queryParameter')}</SelectItem>
              </SelectContent>
            </Select>
          </FieldGroup>
        </div>
      )}

      {/* OAuth 2.0 */}
      {auth.type === 'oauth2' && (
        <div className="space-y-3 max-w-lg">
          <AuthHint>
            {t('auth.oauth2Hint')}
          </AuthHint>

          <FieldGroup>
            <Label className="text-xs">{t('auth.grantType')}</Label>
            <Select
              value={grantType}
              onValueChange={(value) =>
                updateAuth({
                  oauth2GrantType: value as RequestAuth['oauth2GrantType'],
                })
              }
            >
              <SelectTrigger className="w-[240px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="authorization_code">Authorization Code</SelectItem>
                <SelectItem value="client_credentials">Client Credentials</SelectItem>
                <SelectItem value="password">Password</SelectItem>
                <SelectItem value="implicit">Implicit</SelectItem>
              </SelectContent>
            </Select>
          </FieldGroup>

          {/* Auth URL - shown for authorization_code and implicit */}
          {(grantType === 'authorization_code' || grantType === 'implicit') && (
            <FieldGroup>
              <Label className="text-xs">{t('auth.authUrl')}</Label>
              <Input
                placeholder="https://provider.com/oauth/authorize"
                value={auth.oauth2AuthUrl || ''}
                onChange={(e) => updateAuth({ oauth2AuthUrl: e.target.value })}
                className="h-8 text-xs font-mono"
              />
            </FieldGroup>
          )}

          {/* Token URL - shown for all except implicit */}
          {grantType !== 'implicit' && (
            <FieldGroup>
              <Label className="text-xs">{t('auth.tokenUrl')}</Label>
              <Input
                placeholder="https://provider.com/oauth/token"
                value={auth.oauth2TokenUrl || ''}
                onChange={(e) => updateAuth({ oauth2TokenUrl: e.target.value })}
                className="h-8 text-xs font-mono"
              />
            </FieldGroup>
          )}

          <FieldGroup>
            <Label className="text-xs">{t('auth.clientId')}</Label>
            <Input
              placeholder={t('auth.clientId')}
              value={auth.oauth2ClientId || ''}
              onChange={(e) => updateAuth({ oauth2ClientId: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>

          {/* Client Secret - not needed for implicit */}
          {grantType !== 'implicit' && (
            <FieldGroup>
              <Label className="text-xs">{t('auth.clientSecret')}</Label>
              <Input
                type="password"
                placeholder={t('auth.clientSecret')}
                value={auth.oauth2ClientSecret || ''}
                onChange={(e) => updateAuth({ oauth2ClientSecret: e.target.value })}
                className="h-8 text-xs font-mono"
              />
            </FieldGroup>
          )}

          {/* Username + Password for password grant */}
          {grantType === 'password' && (
            <>
              <FieldGroup>
                <Label className="text-xs">{t('auth.username')}</Label>
                <Input
                  placeholder={t('auth.resourceOwnerUsername')}
                  value={auth.username || ''}
                  onChange={(e) => updateAuth({ username: e.target.value })}
                  className="h-8 text-xs"
                />
              </FieldGroup>
              <FieldGroup>
                <Label className="text-xs">{t('auth.password')}</Label>
                <Input
                  type="password"
                  placeholder={t('auth.resourceOwnerPassword')}
                  value={auth.password || ''}
                  onChange={(e) => updateAuth({ password: e.target.value })}
                  className="h-8 text-xs"
                />
              </FieldGroup>
            </>
          )}

          <FieldGroup>
            <Label className="text-xs">{t('auth.scope')}</Label>
            <Input
              placeholder={t('auth.scopePlaceholder')}
              value={auth.oauth2Scope || ''}
              onChange={(e) => updateAuth({ oauth2Scope: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>

          {/* State and Callback URL - for authorization_code and implicit */}
          {(grantType === 'authorization_code' || grantType === 'implicit') && (
            <>
              <FieldGroup>
                <Label className="text-xs">{t('auth.state')}</Label>
                <Input
                  placeholder={t('auth.statePlaceholder')}
                  value={auth.oauth2State || ''}
                  onChange={(e) => updateAuth({ oauth2State: e.target.value })}
                  className="h-8 text-xs font-mono"
                />
              </FieldGroup>
              <FieldGroup>
                <Label className="text-xs">{t('auth.callbackUrl')}</Label>
                <Input
                  placeholder="https://localhost/callback"
                  value={auth.oauth2CallbackUrl || ''}
                  onChange={(e) => updateAuth({ oauth2CallbackUrl: e.target.value })}
                  className="h-8 text-xs font-mono"
                />
              </FieldGroup>
            </>
          )}

          <div className="pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGetToken}
            >
              {t('actions.getToken')}
            </Button>
            {tokenMessage && (
              <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
                {tokenMessage}
              </p>
            )}
          </div>

          <FieldGroup>
            <Label className="text-xs">{t('auth.accessToken')}</Label>
            <Input
              placeholder={t('auth.accessTokenPlaceholder')}
              value={auth.oauth2AccessToken || ''}
              onChange={(e) => updateAuth({ oauth2AccessToken: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>
        </div>
      )}

      {/* Digest Auth */}
      {auth.type === 'digest' && (
        <div className="space-y-3 max-w-md">
          <AuthHint>
            {t('auth.digestHint')}
          </AuthHint>
          <FieldGroup>
            <Label className="text-xs">{t('auth.username')}</Label>
            <VariableInput
              placeholder={t('auth.username')}
              value={auth.username || ''}
              onChange={(e) => updateAuth({ username: e.target.value })}
              className="h-8 text-xs"
            />
          </FieldGroup>
          <FieldGroup>
            <Label className="text-xs">{t('auth.password')}</Label>
            <Input
              type="password"
              placeholder={t('auth.password')}
              value={auth.password || ''}
              onChange={(e) => updateAuth({ password: e.target.value })}
              className="h-8 text-xs"
            />
          </FieldGroup>
          <FieldGroup>
            <Label className="text-xs">{t('auth.realm')}</Label>
            <Input
              placeholder={t('auth.realmPlaceholder')}
              value={auth.digestRealm || ''}
              onChange={(e) => updateAuth({ digestRealm: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>
          <FieldGroup>
            <Label className="text-xs">{t('auth.nonce')}</Label>
            <Input
              placeholder={t('auth.noncePlaceholder')}
              value={auth.digestNonce || ''}
              onChange={(e) => updateAuth({ digestNonce: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>
          <FieldGroup>
            <Label className="text-xs">{t('auth.qop')}</Label>
            <Input
              placeholder={t('auth.qopPlaceholder')}
              value={auth.digestQop || ''}
              onChange={(e) => updateAuth({ digestQop: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>
          <FieldGroup>
            <Label className="text-xs">{t('auth.opaque')}</Label>
            <Input
              placeholder={t('auth.opaquePlaceholder')}
              value={auth.digestOpaque || ''}
              onChange={(e) => updateAuth({ digestOpaque: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>
        </div>
      )}

      {/* AWS Signature */}
      {auth.type === 'aws' && (
        <div className="space-y-3 max-w-md">
          <AuthHint>
            {t('auth.awsHint')}
          </AuthHint>
          <FieldGroup>
            <Label className="text-xs">{t('auth.accessKey')}</Label>
            <Input
              placeholder={t('auth.accessKeyPlaceholder')}
              value={auth.awsAccessKey || ''}
              onChange={(e) => updateAuth({ awsAccessKey: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>
          <FieldGroup>
            <Label className="text-xs">{t('auth.secretKey')}</Label>
            <Input
              type="password"
              placeholder={t('auth.secretKeyPlaceholder')}
              value={auth.awsSecretKey || ''}
              onChange={(e) => updateAuth({ awsSecretKey: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>
          <FieldGroup>
            <Label className="text-xs">{t('auth.region')}</Label>
            <Input
              placeholder={t('auth.regionPlaceholder')}
              value={auth.awsRegion || ''}
              onChange={(e) => updateAuth({ awsRegion: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>
          <FieldGroup>
            <Label className="text-xs">{t('auth.service')}</Label>
            <Input
              placeholder={t('auth.servicePlaceholder')}
              value={auth.awsService || ''}
              onChange={(e) => updateAuth({ awsService: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>
          <FieldGroup>
            <Label className="text-xs">{t('auth.sessionToken')}</Label>
            <Input
              placeholder={t('auth.sessionTokenPlaceholder')}
              value={auth.awsSessionToken || ''}
              onChange={(e) => updateAuth({ awsSessionToken: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>
        </div>
      )}

      {/* Hawk */}
      {auth.type === 'hawk' && (
        <div className="space-y-3 max-w-md">
          <AuthHint>
            {t('auth.hawkHint')}
          </AuthHint>
          <FieldGroup>
            <Label className="text-xs">{t('auth.hawkId')}</Label>
            <Input
              placeholder={t('auth.hawkIdPlaceholder')}
              value={auth.hawkId || ''}
              onChange={(e) => updateAuth({ hawkId: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>
          <FieldGroup>
            <Label className="text-xs">{t('auth.hawkKey')}</Label>
            <Input
              type="password"
              placeholder={t('auth.hawkKeyPlaceholder')}
              value={auth.hawkKey || ''}
              onChange={(e) => updateAuth({ hawkKey: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>
          <FieldGroup>
            <Label className="text-xs">{t('auth.algorithm')}</Label>
            <Select
              value={auth.hawkAlgorithm || 'sha256'}
              onValueChange={(value) => updateAuth({ hawkAlgorithm: value })}
            >
              <SelectTrigger className="w-[200px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sha256">SHA-256</SelectItem>
                <SelectItem value="sha1">SHA-1</SelectItem>
              </SelectContent>
            </Select>
          </FieldGroup>
        </div>
      )}

      {/* NTLM */}
      {auth.type === 'ntlm' && (
        <div className="space-y-3 max-w-md">
          <AuthHint>
            {t('auth.ntlmHint')}
          </AuthHint>
          <FieldGroup>
            <Label className="text-xs">{t('auth.username')}</Label>
            <VariableInput
              placeholder={t('auth.username')}
              value={auth.username || ''}
              onChange={(e) => updateAuth({ username: e.target.value })}
              className="h-8 text-xs"
            />
          </FieldGroup>
          <FieldGroup>
            <Label className="text-xs">{t('auth.password')}</Label>
            <Input
              type="password"
              placeholder={t('auth.password')}
              value={auth.password || ''}
              onChange={(e) => updateAuth({ password: e.target.value })}
              className="h-8 text-xs"
            />
          </FieldGroup>
          <FieldGroup>
            <Label className="text-xs">{t('auth.domain')}</Label>
            <Input
              placeholder={t('auth.domainPlaceholder')}
              value={auth.ntlmDomain || ''}
              onChange={(e) => updateAuth({ ntlmDomain: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </FieldGroup>
        </div>
      )}
    </div>
  );
}
