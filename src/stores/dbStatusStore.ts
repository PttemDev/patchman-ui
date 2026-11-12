import { create } from 'zustand';

export type DbStatus = 'ok' | 'blocked' | 'incompatible' | 'error';

interface DbStatusState {
  status: DbStatus;
  message: string | null;
  setBlocked: () => void;
  setIncompatible: (message: string) => void;
  setError: (message: string) => void;
  reset: () => void;
}

export const useDbStatusStore = create<DbStatusState>((set) => ({
  status: 'ok',
  message: null,
  setBlocked: () => set({ status: 'blocked', message: null }),
  setIncompatible: (message) => set({ status: 'incompatible', message }),
  setError: (message) => set({ status: 'error', message }),
  reset: () => set({ status: 'ok', message: null }),
}));
