import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, GripVertical, Pin, PinOff, RotateCcw, Search, Columns3 } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useDBColumnPrefsStore } from '@/stores/dbColumnPrefsStore';

interface DBColumnControlProps {
  fingerprint: string;
  allColumns: string[];
}

// DBColumnControl is the popover that lets users hide / reorder / pin
// columns. State is persisted per-fingerprint in dbColumnPrefsStore so
// reopening the same query lands on the previously-tuned layout.
const EMPTY_PREFS = { hidden: [], order: [], pinned: [], widths: {} } as const;

export function DBColumnControl({ fingerprint, allColumns }: DBColumnControlProps) {
  const { t } = useTranslation('dbquery');
  // Selector returns the bare slot; the fallback lives outside so an
  // unset connection doesn't synthesize a new object reference each
  // render (which would trip zustand's reference-equality re-render).
  const stored = useDBColumnPrefsStore((s) => s.prefs[fingerprint]);
  const prefs = stored ?? EMPTY_PREFS;
  const setOrder = useDBColumnPrefsStore((s) => s.setOrder);
  const setHidden = useDBColumnPrefsStore((s) => s.setHidden);
  const togglePinned = useDBColumnPrefsStore((s) => s.togglePinned);
  const reset = useDBColumnPrefsStore((s) => s.reset);

  const [q, setQ] = useState('');

  // Effective order: persisted order honored when subset of allColumns;
  // unknown columns appended in original order so new columns surface.
  const order = useMemo(() => {
    const known = new Set(allColumns);
    const fromPref = prefs.order.filter((c) => known.has(c));
    const missing = allColumns.filter((c) => !fromPref.includes(c));
    return [...fromPref, ...missing];
  }, [prefs.order, allColumns]);

  const visible = useMemo(() => {
    const hidden = new Set(prefs.hidden);
    return order.filter((c) => !hidden.has(c));
  }, [order, prefs.hidden]);

  const filtered = useMemo(() => {
    if (!q.trim()) return order;
    const lower = q.toLowerCase();
    return order.filter((c) => c.toLowerCase().includes(lower));
  }, [order, q]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = order.indexOf(String(active.id));
    const newIdx = order.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    setOrder(fingerprint, arrayMove(order, oldIdx, newIdx));
  };

  const toggleHidden = (col: string) => {
    const isHidden = prefs.hidden.includes(col);
    const next = isHidden ? prefs.hidden.filter((c) => c !== col) : [...prefs.hidden, col];
    setHidden(fingerprint, next);
  };

  const showAll = () => setHidden(fingerprint, []);
  const hideAll = () => setHidden(fingerprint, [...allColumns]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" title={t('columns.title')}>
          <Columns3 className="h-3.5 w-3.5" />
          <span>{visible.length}/{allColumns.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-0">
        <div className="px-2 py-1.5 border-b flex items-center gap-1.5">
          <Search className="h-3 w-3 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('columns.findPlaceholder')}
            className="h-6 text-xs border-0 px-1 focus-visible:ring-0 shadow-none"
          />
        </div>
        <div className="px-2 py-1 border-b flex items-center gap-1 text-[10px] text-muted-foreground">
          <button className="hover:text-foreground" onClick={showAll}>{t('columns.showAll')}</button>
          <span>·</span>
          <button className="hover:text-foreground" onClick={hideAll}>{t('columns.hideAll')}</button>
          <span className="flex-1" />
          <button className="flex items-center gap-1 hover:text-foreground" onClick={() => reset(fingerprint)}>
            <RotateCcw className="h-2.5 w-2.5" /> {t('columns.reset')}
          </button>
        </div>
        <div className="max-h-[320px] overflow-auto py-1">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={filtered} strategy={verticalListSortingStrategy}>
              {filtered.map((col) => (
                <ColumnRow
                  key={col}
                  col={col}
                  hidden={prefs.hidden.includes(col)}
                  pinned={prefs.pinned.includes(col)}
                  onToggleHidden={() => toggleHidden(col)}
                  onTogglePinned={() => togglePinned(fingerprint, col)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ColumnRow({
  col, hidden, pinned, onToggleHidden, onTogglePinned,
}: {
  col: string;
  hidden: boolean;
  pinned: boolean;
  onToggleHidden: () => void;
  onTogglePinned: () => void;
}) {
  const { t } = useTranslation('dbquery');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-1 px-2 py-1 hover:bg-accent/40',
        isDragging && 'bg-accent/60 shadow-sm',
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <button
        onClick={onToggleHidden}
        className={cn(
          'shrink-0 text-muted-foreground hover:text-foreground',
          hidden && 'opacity-50',
        )}
        title={hidden ? t('columns.show') : t('columns.hide')}
      >
        {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
      <span className={cn(
        'flex-1 text-xs font-mono truncate',
        hidden && 'line-through text-muted-foreground',
      )}>
        {col}
      </span>
      <button
        onClick={onTogglePinned}
        className={cn(
          'shrink-0 text-muted-foreground hover:text-foreground',
          pinned && 'text-amber-500',
        )}
        title={pinned ? t('columns.unfreeze') : t('columns.freezeLeft')}
      >
        {pinned ? <Pin className="h-3 w-3 fill-current" /> : <PinOff className="h-3 w-3" />}
      </button>
    </div>
  );
}
