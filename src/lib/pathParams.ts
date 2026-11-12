// Path-parameter extraction, shared by the request editor (ParamsEditor) and
// the collection-tree open path (RequestItem) so they can never diverge.
//
// A path param is a single-brace `{name}` in the URL path. Environment
// variables use DOUBLE braces `{{name}}` and must NOT be treated as path
// params — they're stripped first (including half-typed `{{name}` / `{{name`
// states) so a row never briefly latches onto `{name}` while the user is
// mid-typing `{{name}}`.
export function extractPathParams(url: string): string[] {
  const pathPart = (url || '').split('?')[0];
  const stripped = pathPart.replace(/\{\{[^{}]*\}?\}?/g, ' ');
  const matches: string[] = [];
  const re = /\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    matches.push(m[1]);
  }
  return [...new Set(matches)];
}
