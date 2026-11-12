import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { ProviderScope } from './providerScopes';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// A Coroot project picked by name. Falls back to typing the id when the list
// cannot be loaded; an id that is not in the list stays selectable.
export function ProjectSelect({ value, onChange, scopes, loading, size = 'md', className }: {
  value: string;
  onChange: (id: string) => void;
  scopes: ProviderScope[] | null;
  loading?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { t } = useTranslation('servicemap');
  const h = size === 'sm' ? 'h-6 text-[11px]' : 'h-9 text-xs';
  if (!scopes?.length) {
    return (
      <div className={cn('relative', className)}>
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('conn.scope.project')}
          className={cn(h, 'font-mono', loading && 'pr-6')} />
        {loading && <Loader2 className="absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
    );
  }
  const known = scopes.some((s) => s.id === value);
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className={cn(h, className)}><SelectValue placeholder={t('conn.scope.project')} /></SelectTrigger>
      <SelectContent>
        {scopes.map((s) => (
          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
        ))}
        {value && !known && <SelectItem value={value}><span className="font-mono">{value}</span></SelectItem>}
      </SelectContent>
    </Select>
  );
}
