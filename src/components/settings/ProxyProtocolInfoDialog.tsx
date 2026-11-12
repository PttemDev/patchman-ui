import { Trans, useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ProxyProtocolInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProxyProtocolInfoDialog({ open, onOpenChange }: ProxyProtocolInfoDialogProps) {
  const { t } = useTranslation('settings');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('proxyInfo.title')}</DialogTitle>
          <DialogDescription>
            {t('proxyInfo.description')}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-4 text-sm leading-relaxed">
            <section>
              <h3 className="font-semibold text-foreground mb-1">{t('proxyInfo.sendHeading')}</h3>
              <p className="text-muted-foreground">
                <Trans
                  t={t}
                  i18nKey="proxyInfo.sendBody"
                  components={{ code: <code className="font-mono text-xs" /> }}
                />
              </p>
              <pre className="mt-2 rounded-md bg-muted/50 p-3 text-xs overflow-x-auto">
{`{
  "method": "GET",
  "url": "https://api.example.com/users",
  "headers": { "Authorization": "Bearer ..." },
  "params": { "limit": "10" },
  "body": { "type": "none", "content": "" }
}`}
              </pre>
              <p className="text-muted-foreground mt-2">
                {t('proxyInfo.sendNote')}
              </p>
            </section>

            <section>
              <h3 className="font-semibold text-foreground mb-1">{t('proxyInfo.returnHeading')}</h3>
              <p className="text-muted-foreground">
                {t('proxyInfo.returnBody')}
              </p>
              <pre className="mt-2 rounded-md bg-muted/50 p-3 text-xs overflow-x-auto">
{`{
  "statusCode": 200,
  "statusText": "OK",
  "headers": { "content-type": "application/json" },
  "body": "response body as string",
  "size": 1234,
  "duration": 87
}`}
              </pre>
            </section>

            <section>
              <h3 className="font-semibold text-foreground mb-1">{t('proxyInfo.corsHeading')}</h3>
              <p className="text-muted-foreground">
                {t('proxyInfo.corsBody')}
              </p>
              <pre className="mt-2 rounded-md bg-muted/50 p-3 text-xs overflow-x-auto">
{`Access-Control-Allow-Origin: <this origin>
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-Proxy-Token`}
              </pre>
            </section>

            <section>
              <h3 className="font-semibold text-foreground mb-1">{t('proxyInfo.specHeading')}</h3>
              <p className="text-muted-foreground">
                <Trans
                  t={t}
                  i18nKey="proxyInfo.specBody"
                  components={{ code: <code className="font-mono text-xs" /> }}
                />
              </p>
              <a
                href="https://github.com/patchman/proxy-spec"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline mt-1"
              >
                {t('proxyInfo.openSpec')} <ExternalLink className="h-3 w-3" />
              </a>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
