// Desktop updater wrapper around `@tauri-apps/plugin-updater`.
//
// The Tauri shell embeds an Ed25519 public key (see tauri.conf.json) that
// verifies any update it downloads against a minisign signature produced at
// release time. The updater endpoint returns a `latest.json` manifest whose
// platform entry points at a `.app.tar.gz` archive plus its signature — the
// plugin compares semver, downloads, verifies, and swaps in the new bundle.
//
// Web builds never reach this code: the Settings → Updates section is hidden
// unless `isDesktop()` returns true.

import { isDesktop } from './platform';

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export interface UpdateHandle {
  info: UpdateInfo;
  download(onProgress?: (downloaded: number, total?: number) => void): Promise<void>;
  install(): Promise<void>;
  downloadAndInstall(onProgress?: (downloaded: number, total?: number) => void): Promise<void>;
}

export async function checkForUpdate(): Promise<UpdateHandle | null> {
  if (!isDesktop()) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;

  const info: UpdateInfo = {
    version: update.version,
    currentVersion: update.currentVersion,
    date: update.date,
    body: update.body,
  };

  return {
    info,
    async download(onProgress) {
      let downloaded = 0;
      let total: number | undefined;
      await update.download((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? undefined;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          onProgress?.(downloaded, total);
        }
      });
    },
    async install() {
      await update.install();
    },
    async downloadAndInstall(onProgress) {
      let downloaded = 0;
      let total: number | undefined;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? undefined;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          onProgress?.(downloaded, total);
        }
      });
    },
  };
}

export async function relaunchApp(): Promise<void> {
  if (!isDesktop()) return;
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
