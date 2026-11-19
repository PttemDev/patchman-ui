export type Doc = Record<string, unknown>;
export const isDoc = (v: unknown): v is Doc => !!v && typeof v === 'object' && !Array.isArray(v);

/** True when the value looks like a Mongo explain document (find or aggregate). */
export function isMongoExplain(v: unknown): v is Doc {
  return isDoc(v) && (isDoc(v.queryPlanner) || Array.isArray(v.stages));
}
