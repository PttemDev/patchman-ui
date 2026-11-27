import { Bot, Sparkles, TerminalSquare } from 'lucide-react';
import { useTerminalSessions, type TerminalProgram } from './terminalSessions';

const PROGRAM_ICON: Record<TerminalProgram, React.ElementType> = {
  shell: TerminalSquare,
  claude: Sparkles,
  codex: Bot,
};

/** The icon of what a session is running (shell, claude, codex). */
export function ProgramIcon({ program, className }: { program: TerminalProgram; className?: string }) {
  const Icon = PROGRAM_ICON[program];
  return <Icon className={className} />;
}

/** Tab-strip glyph of a terminal tab: follows its session's program. */
export function TerminalTabGlyph({ sessionId }: { sessionId?: string }) {
  const program = useTerminalSessions((s) => s.sessions.find((x) => x.id === sessionId)?.program ?? 'shell');
  return <ProgramIcon program={program} className="h-3 w-3 shrink-0 text-emerald-500" />;
}
