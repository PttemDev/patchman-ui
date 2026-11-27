import { useRequestStore } from '@/stores/requestStore';
import i18n from '@/i18n';
import type { QASection } from './sections';

// Opens the CR + QA Hub tab (one per window) or focuses it, optionally on a
// section. Kept free of the hub's heavy chunk so the sidebar and the command
// palette can import it.
export function openQAHub(section?: QASection) {
  const rs = useRequestStore.getState();
  const existing = rs.tabs.find((t) => t.type === 'qahub');
  if (existing) {
    if (section && existing.qaSection !== section) rs.updateTab(existing.id, { qaSection: section });
    rs.setActiveTab(existing.id);
    return;
  }
  rs.addTab({ type: 'qahub', name: i18n.t('qa:hub.title'), method: 'GET', url: '', qaSection: section ?? 'inbox' }, true);
}
