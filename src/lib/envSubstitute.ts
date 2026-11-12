import type { Environment } from '@/types';

export function substituteEnvVars(text: string, env: Environment | null): string {
  if (!env || !text) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    const v = env.variables.find((x) => x.key === varName && x.enabled);
    return v ? v.value : match;
  });
}
