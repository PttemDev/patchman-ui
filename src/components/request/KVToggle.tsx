import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';

// KVToggle is the enable/disable control for a param/header row. It uses a
// Switch (not a checkbox) because the on/off states of a small dark
// checkbox were hard to tell apart — a sliding, colour-changing switch
// makes "this row is sent / not sent" obvious at a glance.
export function KVToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  const { t } = useTranslation('request');
  const label = enabled ? t('kv.enabledTitle') : t('kv.disabledTitle');
  return (
    <Switch
      checked={enabled}
      onCheckedChange={onChange}
      aria-label={label}
      title={label}
    />
  );
}
