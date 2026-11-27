// statusTone maps a Kubernetes status/phase to a semantic dot + text color,
// matching the badge language used across the Redis/Kafka/S3 tools.
export function statusTone(status: string): { dot: string; text: string } {
  const s = status.toLowerCase();
  if (['running', 'ready', 'active', 'bound', 'available', 'succeeded', 'complete', 'completed', 'healthy'].some((k) => s.includes(k))) {
    return { dot: 'bg-emerald-500', text: 'text-emerald-500' };
  }
  if (['pending', 'containercreating', 'creating', 'terminating', 'progressing', 'notready', 'not ready', 'waiting'].some((k) => s.includes(k))) {
    return { dot: 'bg-amber-500', text: 'text-amber-500' };
  }
  if (['fail', 'error', 'crashloop', 'evicted', 'unknown', 'imagepull', 'errimage', 'oomkilled', 'backoff'].some((k) => s.includes(k))) {
    return { dot: 'bg-destructive', text: 'text-destructive' };
  }
  return { dot: 'bg-muted-foreground/40', text: 'text-foreground/80' };
}
