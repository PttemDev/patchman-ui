import { GitCompare, KeyRound, Binary, Link2, Clock, Fingerprint, Hash, Regex, BookOpen, Terminal, Table2, Network, Gauge } from 'lucide-react';
import type { ToolKind } from '@/types';
import { JsonDiffTool } from './tools/JsonDiffTool';
import { JwtTool } from './tools/JwtTool';
import { Base64Tool } from './tools/Base64Tool';
import { UrlTool } from './tools/UrlTool';
import { TimestampTool } from './tools/TimestampTool';
import { UuidTool } from './tools/UuidTool';
import { HashTool } from './tools/HashTool';
import { RegexTool } from './tools/RegexTool';
import { SnippetsTool } from './tools/SnippetsTool';
import { JsConsoleTool } from './tools/JsConsoleTool';
import { MockDataTool } from './tools/MockDataTool';
import { DnsToolkit } from './tools/DnsToolkit';
import { WebAuditTool } from './tools/WebAuditTool';

export interface ToolDef {
  kind: ToolKind;
  // i18n keys into the `devtools` namespace (tools.<x>.label / .description).
  // Kept as keys, not strings, so the sidebar/panel translate at render time.
  labelKey: string;
  descriptionKey: string;
  icon: React.ElementType;
  Component: React.ComponentType;
}

// Single source of truth for the Dev Tools list — the sidebar renders it,
// the panel resolves a tab's toolKind to its component through it.
export const TOOLS: ToolDef[] = [
  { kind: 'json-diff', labelKey: 'tools.jsonDiff.label', descriptionKey: 'tools.jsonDiff.description', icon: GitCompare, Component: JsonDiffTool },
  { kind: 'jwt', labelKey: 'tools.jwt.label', descriptionKey: 'tools.jwt.description', icon: KeyRound, Component: JwtTool },
  { kind: 'base64', labelKey: 'tools.base64.label', descriptionKey: 'tools.base64.description', icon: Binary, Component: Base64Tool },
  { kind: 'url', labelKey: 'tools.url.label', descriptionKey: 'tools.url.description', icon: Link2, Component: UrlTool },
  { kind: 'timestamp', labelKey: 'tools.timestamp.label', descriptionKey: 'tools.timestamp.description', icon: Clock, Component: TimestampTool },
  { kind: 'uuid', labelKey: 'tools.uuid.label', descriptionKey: 'tools.uuid.description', icon: Fingerprint, Component: UuidTool },
  { kind: 'hash', labelKey: 'tools.hash.label', descriptionKey: 'tools.hash.description', icon: Hash, Component: HashTool },
  { kind: 'regex', labelKey: 'tools.regex.label', descriptionKey: 'tools.regex.description', icon: Regex, Component: RegexTool },
  { kind: 'js-console', labelKey: 'tools.jsConsole.label', descriptionKey: 'tools.jsConsole.description', icon: Terminal, Component: JsConsoleTool },
  { kind: 'snippets', labelKey: 'tools.snippets.label', descriptionKey: 'tools.snippets.description', icon: BookOpen, Component: SnippetsTool },
  { kind: 'mock-data', labelKey: 'tools.mockData.label', descriptionKey: 'tools.mockData.description', icon: Table2, Component: MockDataTool },
  { kind: 'dns', labelKey: 'tools.dns.label', descriptionKey: 'tools.dns.description', icon: Network, Component: DnsToolkit },
  { kind: 'web-audit', labelKey: 'tools.webAudit.label', descriptionKey: 'tools.webAudit.description', icon: Gauge, Component: WebAuditTool },
];

export function toolDef(kind: ToolKind | undefined): ToolDef | undefined {
  return TOOLS.find((t) => t.kind === kind);
}
