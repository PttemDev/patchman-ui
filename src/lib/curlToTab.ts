import type { ParsedCurl } from '@/lib/parseCurl';
import type { Tab } from '@/types';

export interface ParsedCurlToTabOptions {
  /**
   * Keep the original cURL file references (filename + mime hint) on
   * imported `type=file` form fields. Default false — the file the cURL
   * came from is almost never available on the importing machine, and
   * sending a request with a stale fileName but no blob ships an empty
   * file. Off → the field row is created with key + type=file but no
   * fileName / value / fileType, so the user is forced to attach their
   * own copy before sending.
   */
  preserveFileRefs?: boolean;
}

/**
 * Convert a successfully parsed cURL into a Partial<Tab> patch. Shared by
 * `ImportCurlDialog` (new tab) and the URL bar's paste handler (current
 * tab) so both paths produce identical results — same protocol stripping,
 * same trailing blank rows, same auth wiring.
 *
 * Returns the patch + a derived display name caller can ignore.
 */
export function parsedCurlToTab(
  parsed: ParsedCurl,
  options: ParsedCurlToTabOptions = {},
): { patch: Partial<Tab>; name: string } {
  const { preserveFileRefs = false } = options;
  let urlWithoutProtocol = parsed.url;
  if (urlWithoutProtocol.startsWith('https://')) urlWithoutProtocol = urlWithoutProtocol.slice(8);
  else if (urlWithoutProtocol.startsWith('http://')) urlWithoutProtocol = urlWithoutProtocol.slice(7);

  // Reattach query string to the URL bar — the user still wants to see
  // the full request shape there. The Params editor will sync to/from
  // this query via its useEffect; toggling/editing a row will rebuild
  // the URL through ParamsEditor.rebuildUrl.
  const queryString = parsed.params
    .filter((p) => p.key)
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join('&');
  const urlWithQuery = queryString
    ? `${urlWithoutProtocol}?${queryString}`
    : urlWithoutProtocol;

  const patch: Partial<Tab> = {
    method: parsed.method,
    url: urlWithQuery,
    protocol: parsed.protocol,
  };

  // Headers/params: only include when non-empty so the spread in addTab
  // doesn't clobber the default array. Trailing blank row matches what
  // the editors render after a manual add — keeps the UX consistent.
  if (parsed.headers.length > 0) {
    patch.headers = [...parsed.headers, { key: '', value: '', enabled: true }];
  }
  if (parsed.params.length > 0) {
    patch.params = [...parsed.params, { key: '', value: '', enabled: true }];
  }

  if (parsed.body) {
    const bodyType = parsed.bodyType === 'none' ? 'raw' : parsed.bodyType;
    // Form bodies must be stored as a JSON array of FormField — that's
    // what FormDataEditor.parseFormFields expects. Falling back to the
    // newline-joined string would land in the legacy URL-encoded parser
    // and collapse every field into a single row whose key is the whole
    // raw payload (the `\n` doesn't split on `&`).
    let content: string;
    if (bodyType === 'form' && parsed.formFields && parsed.formFields.length > 0) {
      const formFields = parsed.formFields.map((f) => {
        if (f.type !== 'file') return f;
        // File field. Default (preserveFileRefs=false): keep the field
        // row but drop the cURL filename hint — the user almost never
        // has the same file locally, and sending with a stale fileName
        // but no blob ships an empty upload. Clearing forces the user
        // to click "Choose File" and attach their own copy.
        if (preserveFileRefs) return f;
        return { ...f, value: '', fileName: undefined, fileType: undefined };
      });
      content = JSON.stringify(formFields);
      // Structured form fields come only from `-F`/`--form`, which is always
      // multipart/form-data — even when every field is text. Mark it so the
      // send path doesn't downgrade to x-www-form-urlencoded (→ 415).
      patch.body = { type: bodyType, content, formEncoding: 'multipart' };
    } else {
      // `-d` with an x-www-form-urlencoded content-type → keep urlencoded.
      content = parsed.body;
      patch.body = { type: bodyType, content };
    }
  }

  if (parsed.auth?.type === 'bearer') {
    patch.auth = { type: 'bearer', token: parsed.auth.token };
  } else if (parsed.auth?.type === 'basic') {
    patch.auth = {
      type: 'basic',
      username: parsed.auth.username,
      password: parsed.auth.password,
    };
  }

  const name = urlWithoutProtocol.split('?')[0].split('/').pop() || 'Imported cURL';
  return { patch, name };
}
