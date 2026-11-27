import {
  BarChart3, Bot, Bug, Inbox, LineChart, Radar, Workflow, ClipboardList, Flame, Layers, LayoutList, Play, Settings, Target, type LucideIcon,
} from 'lucide-react';

// The CR + QA Hub's sections, in nav order (CR_QA_P0_PLAN.md).
export type QASection = 'inbox' | 'radar' | 'reviews' | 'overview' | 'cases' | 'plans' | 'runs' | 'load' | 'defects' | 'requirements' | 'steps' | 'reports' | 'automation' | 'settings';

export interface QASectionDef {
  id: QASection;
  group: 'review' | 'test' | 'track' | 'setup';
  icon: LucideIcon;
}

export const QA_SECTIONS: QASectionDef[] = [
  { id: 'inbox', group: 'review', icon: Inbox },
  { id: 'radar', group: 'review', icon: Radar },
  { id: 'reviews', group: 'review', icon: Bot },
  { id: 'overview', group: 'test', icon: BarChart3 },
  { id: 'cases', group: 'test', icon: ClipboardList },
  { id: 'plans', group: 'test', icon: LayoutList },
  { id: 'runs', group: 'test', icon: Play },
  { id: 'load', group: 'test', icon: Flame },
  { id: 'defects', group: 'track', icon: Bug },
  { id: 'requirements', group: 'track', icon: Target },
  { id: 'steps', group: 'track', icon: Layers },
  { id: 'reports', group: 'track', icon: LineChart },
  { id: 'automation', group: 'setup', icon: Workflow },
  { id: 'settings', group: 'setup', icon: Settings },
];

export const isQASection = (s: unknown): s is QASection => QA_SECTIONS.some((d) => d.id === s);
