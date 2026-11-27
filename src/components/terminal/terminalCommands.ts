import { isMacPlatform } from '@/lib/keymap';
import { COMMAND_SPECS, type CommandPlatform } from './terminalCommandSpecs';

// The Commands tab of the terminal side panel. Linux-only commands (systemd,
// ss, journalctl…) are shown on a Mac too — they are what you run on a server
// over SSH — and carry a platform badge; macOS-only ones are hidden elsewhere.

export interface TerminalCommand {
  id: string;
  command: string;
  platform: CommandPlatform;
}

export interface TerminalCommandGroup {
  id: string;
  commands: TerminalCommand[];
}

export const TERMINAL_COMMAND_GROUPS: TerminalCommandGroup[] = COMMAND_SPECS
  .map((g) => ({ id: g.id, commands: g.commands.filter((c) => c.platform !== 'mac' || isMacPlatform) }))
  .filter((g) => g.commands.length > 0);

const PLACEHOLDER = /<[a-z][\w-]*>/i;

/** A command with `<name>` slots to fill in before it can run. */
export const needsInput = (command: string): boolean => PLACEHOLDER.test(command);
