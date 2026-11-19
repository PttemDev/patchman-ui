import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Recently opened git folders (Git tab → Open folder, and repos opened
// locally). Per device: the folders live on this machine, so they are not
// synced to the account. Newest first, capped at MAX.
export interface RecentGitFolder {
  repoId: string;
  path: string;
  name: string;
  openedAt: number;
}

const MAX = 10;

interface RecentGitFoldersState {
  folders: RecentGitFolder[];
  touch: (f: Omit<RecentGitFolder, 'openedAt'>) => void;
  remove: (repoId: string) => void;
}

export const useGitRecentFoldersStore = create<RecentGitFoldersState>()(
  persist(
    (set) => ({
      folders: [],
      touch: (f) => set((s) => ({
        folders: [{ ...f, openedAt: Date.now() }, ...s.folders.filter((x) => x.repoId !== f.repoId && x.path !== f.path)].slice(0, MAX),
      })),
      remove: (repoId) => set((s) => ({ folders: s.folders.filter((x) => x.repoId !== repoId) })),
    }),
    { name: 'patchman.git.recentFolders.v1' },
  ),
);
