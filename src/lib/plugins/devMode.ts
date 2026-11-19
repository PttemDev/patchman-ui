import { isDesktop } from '@/lib/platform';

// Plugin developer mode (desktop only, one session at a time): the shell
// asks for Touch ID, sets a one-shot flag and restarts; the next normal
// launch is back in the safe mode. Leaving restarts without the flag.
export async function restartPluginDevMode(enable: boolean): Promise<void> {
  if (!isDesktop()) throw new Error('desktop only');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('plugin_dev_restart', { enable });
}
