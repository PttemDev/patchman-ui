import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Plus, Rabbit, Radio, RefreshCw } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useKafkaConnectionStore } from '@/stores/kafkaConnectionStore';
import { useRabbitConnectionStore } from '@/stores/rabbitConnectionStore';
import { KafkaSidebar } from '@/components/kafka/KafkaSidebar';
import { useKafkaConnectionSidebarUI } from '@/components/kafka/kafkaSidebarUI';
import { RabbitSidebar } from '@/components/rabbit/RabbitSidebar';
import { useRabbitConnectionSidebarUI } from '@/components/rabbit/rabbitSidebarUI';

// Messaging rail (the former Kafka rail; its id stays 'kafka' so saved UI
// state keeps working): Kafka and RabbitMQ connections in two collapsible
// groups. Each broker keeps its own tabs — RabbitMQ's are built around
// queues, exchanges and routing rather than topics and partitions.

const OPEN_KEY = 'patchman_messaging_groups';

function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function MessagingHeaderActions() {
  const { t } = useTranslation('rabbit');
  const fetchKafka = useKafkaConnectionStore((s) => s.fetchConnections);
  const fetchRabbit = useRabbitConnectionStore((s) => s.fetchConnections);
  const addKafka = useKafkaConnectionSidebarUI((s) => s.openAdd);
  const addRabbit = useRabbitConnectionSidebarUI((s) => s.openAdd);
  return (
    <div className="flex items-center gap-0.5">
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { void fetchKafka(); void fetchRabbit(); }} title={t('common:refresh')}>
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-6 w-6" title={t('messaging.newConnection')}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={addKafka}><Radio className="h-3.5 w-3.5 mr-2" /> {t('messaging.newKafka')}</DropdownMenuItem>
          <DropdownMenuItem onClick={addRabbit}><Rabbit className="h-3.5 w-3.5 mr-2" /> {t('messaging.newRabbit')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function MessagingSidebar() {
  const { t } = useTranslation('rabbit');
  const kafkaCount = useKafkaConnectionStore((s) => s.connections.length);
  const rabbitCount = useRabbitConnectionStore((s) => s.connections.length);
  const addKafka = useKafkaConnectionSidebarUI((s) => s.openAdd);
  const addRabbit = useRabbitConnectionSidebarUI((s) => s.openAdd);
  const [open, setOpen] = useState<Record<string, boolean>>(readOpen);
  const toggle = (k: string) => setOpen((m) => {
    const next = { ...m, [k]: !(m[k] ?? true) };
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  const kafkaOpen = open.kafka ?? true;
  const rabbitOpen = open.rabbit ?? true;
  return (
    <div className="py-1">
      <GroupHeader icon={<Radio className="h-3.5 w-3.5 text-orange-500" />} label="Kafka" count={kafkaCount} open={kafkaOpen} onToggle={() => toggle('kafka')} onAdd={addKafka} addTitle={t('messaging.newKafka')} />
      {/* Kept mounted (hidden) so its dialogs work from the header menu. */}
      <div className={kafkaOpen ? undefined : 'hidden'}><KafkaSidebar embedded /></div>
      <GroupHeader icon={<Rabbit className="h-3.5 w-3.5 text-orange-500" />} label="RabbitMQ" count={rabbitCount} open={rabbitOpen} onToggle={() => toggle('rabbit')} onAdd={addRabbit} addTitle={t('messaging.newRabbit')} />
      <div className={rabbitOpen ? undefined : 'hidden'}><RabbitSidebar /></div>
    </div>
  );
}

function GroupHeader({ icon, label, count, open, onToggle, onAdd, addTitle }: {
  icon: React.ReactNode; label: string; count: number; open: boolean; onToggle: () => void; onAdd: () => void; addTitle: string;
}) {
  return (
    <div className="group flex items-center gap-1 px-2 pt-2 pb-1">
      <button type="button" onClick={onToggle} className="flex-1 min-w-0 flex items-center gap-1.5 text-left">
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-[10px] text-muted-foreground/60">{count}</span>
      </button>
      <Button size="icon" variant="ghost" className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={onAdd} title={addTitle}>
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
