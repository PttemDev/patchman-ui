import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { jiraAPI, qaAPI } from '@/services/api';
import { SearchPicker } from './SearchPicker';
import { scopeForJira, useJiraConnectionStore } from '@/stores/jiraConnectionStore';
import type { Defect } from '@/types';

// Defect → Jira issue (CR_QA_RFC P2): a person's click creates the issue
// with the defect's title, description and steps; the key is kept.
export function DefectJiraDialog({ defect, onClose, onCreated }: { defect: Defect; onClose: () => void; onCreated: (key: string) => void }) {
  const { t } = useTranslation('qa');
  const { toast } = useToast();
  const { connections, fetchConnections, loaded } = useJiraConnectionStore();
  const [conn, setConn] = useState('');
  const [project, setProject] = useState('');
  const [type, setType] = useState('Bug');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!loaded) void fetchConnections(); }, [loaded, fetchConnections]);
  useEffect(() => { if (!conn && connections[0]) setConn(connections[0].id); }, [connections, conn]);
  const create = async () => {
    setBusy(true);
    try {
      const res = await qaAPI.defectToJira(defect.id, conn, project.trim().toUpperCase(), type.trim() || 'Bug');
      toast({ title: t('defectJira.created', { key: res.data.key }) });
      onCreated(res.data.key);
      onClose();
    } catch (e) {
      toast({ title: (e as { response?: { data?: { error?: string } } })?.response?.data?.error || t('defectJira.failed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('defectJira.title')}</DialogTitle>
          <DialogDescription>{t('defectJira.body', { title: defect.title })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>{t('settings.links.jiraConnection')}</Label>
            <Select value={conn || undefined} onValueChange={setConn}>
              <SelectTrigger><SelectValue placeholder={t('settings.links.noJiraConns')} /></SelectTrigger>
              <SelectContent>{connections.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t('settings.links.jiraProject')}</Label>
              <SearchPicker value={project} onChange={(v) => setProject(v.toUpperCase())} disabled={!conn} placeholder="MER" mono deps={[conn]}
                load={async (q) => ((await jiraAPI.projects(conn, q, scopeForJira(connections, conn))).data ?? []).map((p) => ({ value: p.key, label: p.key, sub: p.name }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t('defectJira.issueType')}</Label>
              <Input value={type} onChange={(e) => setType(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('settings.links.cancel')}</Button>
          <Button onClick={() => void create()} disabled={busy || !conn || !/^[A-Z][A-Z0-9_]*$/.test(project.trim())}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{t('defectJira.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
