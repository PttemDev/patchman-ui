import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mockAPI } from '@/services/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import type { MockRoute } from '@/types';

interface MockRouteEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: string;
  route?: MockRoute | null;
  onSaved: () => void;
}

export function MockRouteEditor({
  open,
  onOpenChange,
  serverId,
  route = null,
  onSaved,
}: MockRouteEditorProps) {
  const [method, setMethod] = useState(route?.method || 'GET');
  const [path, setPath] = useState(route?.path || '/');
  const [statusCode, setStatusCode] = useState(route?.statusCode?.toString() || '200');
  const [responseBody, setResponseBody] = useState(route?.responseBody || '{"message": "OK"}');
  const [delay, setDelay] = useState(route?.delay?.toString() || '0');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation('mock');

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = {
        method,
        path,
        statusCode: parseInt(statusCode, 10),
        responseHeaders: JSON.stringify({ 'Content-Type': 'application/json' }),
        responseBody,
        delay: parseInt(delay, 10),
        isActive: true,
      };

      if (route) {
        await mockAPI.updateRoute(serverId, route.id, data);
      } else {
        await mockAPI.createRoute(serverId, data);
      }

      onSaved();
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('toast.saveRouteFailed');
      toast({ title: t('common:error'), description: msg, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{route ? t('editor.editRoute') : t('editor.newRoute')}</DialogTitle>
          <DialogDescription>
            {t('editor.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('route.method')}</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="w-[100px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">{t('route.path')}</Label>
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/api/example"
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('route.statusCode')}</Label>
              <Input
                value={statusCode}
                onChange={(e) => setStatusCode(e.target.value)}
                className="w-[100px] h-8 text-xs"
                type="number"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('route.delay')}</Label>
              <Input
                value={delay}
                onChange={(e) => setDelay(e.target.value)}
                className="w-[100px] h-8 text-xs"
                type="number"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('route.responseBody')}</Label>
            <Textarea
              value={responseBody}
              onChange={(e) => setResponseBody(e.target.value)}
              rows={6}
              className="font-mono text-xs"
              placeholder='{"message": "Hello"}'
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('saving') : t('editor.saveRoute')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
