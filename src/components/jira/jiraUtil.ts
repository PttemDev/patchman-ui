// Shared helpers for the Jira views.

/** The backend's error text from an axios error, else the fallback. */
export function jiraErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
