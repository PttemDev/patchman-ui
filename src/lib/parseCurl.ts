/**
 * Robust cURL command parser with shell-aware tokenizer.
 *
 * Handles all common paste sources:
 *  - Chrome DevTools "Copy as cURL (bash)" / "Copy as cURL (cmd)"
 *  - Firefox DevTools "Copy as cURL"
 *  - Safari Web Inspector "Copy as cURL"
 *  - Postman "Copy as cURL"
 *  - Manual / hand-written curl commands
 *
 * Supports:
 *  - Single-quoted strings (literal, no escape)
 *  - Double-quoted strings (with \" \\ \$ \` \n escaping)
 *  - $'...' ANSI-C quoting (with \' \\ \n \t \r etc.)
 *  - Backslash escaping outside quotes
 *  - Backslash-newline and ^-newline (Windows CMD) line continuations
 *  - -H / --header
 *  - -X / --request
 *  - -d / --data / --data-raw / --data-binary / --data-ascii / --data-urlencode
 *  - --json (sets Content-Type + Accept headers automatically)
 *  - -F / --form / --form-string
 *  - -u / --user (Basic auth)
 *  - -b / --cookie
 *  - -A / --user-agent
 *  - -e / --referer
 *  - --compressed
 *  - --url (explicit URL flag)
 *  - Bare URL argument (positional)
 */

export interface ParsedCurl {
  method: string;
  /** URL without query string and without scheme prefix duplication —
   *  carries the scheme inline (so callers can decide whether to strip). */
  url: string;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  /** Query parameters extracted from the URL's `?...` segment. Stripped
   *  from `url` so the URL bar stays short and the Params editor is the
   *  single source of truth for the user. */
  params: Array<{ key: string; value: string; enabled: boolean }>;
  body: string;
  bodyType: 'json' | 'form' | 'raw' | 'none';
  /** Structured `-F` / `--form` field list. Only populated when
   *  bodyType='form'. Callers wiring this into the Body editor should
   *  JSON.stringify it into `RequestBody.content` so FormDataEditor's
   *  `parseFormFields` recognizes the structured shape. `body` still
   *  carries a newline-joined string view for the QA paste paths that
   *  consume it verbatim. */
  formFields?: Array<{
    key: string;
    value: string;
    type: 'text' | 'file';
    enabled: boolean;
    fileName?: string;
    fileType?: string;
  }>;
  protocol: string;
  auth?: {
    type: 'basic' | 'bearer';
    username?: string;
    password?: string;
    token?: string;
  };
}

// parseFormFieldEntry interprets one `-F`/`--form` argument the way
// curl(1) does:
//   name=value                   → text field
//   name=@/path/to/file          → file reference
//   name=@file;type=mime/type    → file with explicit content type
//   name=@file;filename=other    → file with a renamed filename
//   name=<file                   → text loaded from file (treated as text;
//                                   we can't read the file at import time)
// curl also supports `headers=...` segments after `;`, but those are
// niche enough that we strip them rather than try to round-trip them.
// Anything we don't recognize stays in `value` verbatim so the import
// is lossy-but-visible.
function parseFormFieldEntry(raw: string): {
  key: string;
  value: string;
  type: 'text' | 'file';
  enabled: boolean;
  fileName?: string;
  fileType?: string;
} {
  const eqIdx = raw.indexOf('=');
  if (eqIdx < 0) {
    // Malformed -F (no '='): keep the raw text as the value so the user
    // sees it and can correct it manually.
    return { key: raw, value: '', type: 'text', enabled: true };
  }
  const key = raw.slice(0, eqIdx);
  const rest = raw.slice(eqIdx + 1);

  if (rest.startsWith('@')) {
    // File reference. Split off any `;key=value` segments — we read
    // `type` and `filename`, drop everything else.
    const segments = rest.slice(1).split(';');
    let fileName = segments[0];
    let fileType: string | undefined;
    for (let s = 1; s < segments.length; s++) {
      const seg = segments[s];
      const segEq = seg.indexOf('=');
      if (segEq < 0) continue;
      const segKey = seg.slice(0, segEq).trim().toLowerCase();
      const segVal = seg.slice(segEq + 1).trim();
      if (segKey === 'type') fileType = segVal;
      else if (segKey === 'filename') fileName = segVal;
    }
    return {
      key,
      // The actual file blob can't survive a cURL paste — we only have
      // the path. Surface the filename in `value` so the form-data
      // editor shows something meaningful; the user is expected to
      // re-attach the file before sending.
      value: fileName,
      type: 'file',
      enabled: true,
      fileName,
      fileType,
    };
  }

  // `<file` is text-from-file. We can't read it at parse time; preserve
  // the literal so the user sees what curl would have read.
  return { key, value: rest, type: 'text', enabled: true };
}

// ── Shell tokenizer ──────────────────────────────────────────────────

function tokenize(input: string): string[] {
  // Normalize line continuations:
  //  - bash:    backslash + optional whitespace + newline
  //  - Windows: ^ + optional whitespace + newline
  let src = input.replace(/\\\s*\r?\n/g, ' ').replace(/\^\s*\r?\n/g, ' ');

  // Also collapse any remaining \r
  src = src.replace(/\r/g, '');

  const tokens: string[] = [];
  let i = 0;
  const len = src.length;

  while (i < len) {
    // Skip whitespace
    while (i < len && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n')) i++;
    if (i >= len) break;

    let token = '';

    while (i < len && src[i] !== ' ' && src[i] !== '\t' && src[i] !== '\n') {
      const ch = src[i];

      // $'...' ANSI-C quoting
      if (ch === '$' && i + 1 < len && src[i + 1] === "'") {
        i += 2; // skip $'
        while (i < len && src[i] !== "'") {
          if (src[i] === '\\' && i + 1 < len) {
            const esc = src[i + 1];
            switch (esc) {
              case '\\': token += '\\'; i += 2; break;
              case "'":  token += "'";  i += 2; break;
              case 'n':  token += '\n'; i += 2; break;
              case 't':  token += '\t'; i += 2; break;
              case 'r':  token += '\r'; i += 2; break;
              case 'a':  token += '\x07'; i += 2; break;
              case 'b':  token += '\b'; i += 2; break;
              case 'f':  token += '\f'; i += 2; break;
              case 'v':  token += '\v'; i += 2; break;
              default:   token += src[i + 1]; i += 2; break;
            }
          } else {
            token += src[i];
            i++;
          }
        }
        if (i < len) i++; // skip closing '
        continue;
      }

      // Single-quoted string: everything literal until closing '
      if (ch === "'") {
        i++; // skip opening '
        while (i < len && src[i] !== "'") {
          token += src[i];
          i++;
        }
        if (i < len) i++; // skip closing '
        continue;
      }

      // Double-quoted string: allows \" \\ \$ \` \n escaping
      if (ch === '"') {
        i++; // skip opening "
        while (i < len && src[i] !== '"') {
          if (src[i] === '\\' && i + 1 < len) {
            const next = src[i + 1];
            if (next === '"' || next === '\\' || next === '$' || next === '`') {
              token += next;
              i += 2;
              continue;
            }
            if (next === 'n') { token += '\n'; i += 2; continue; }
            if (next === 't') { token += '\t'; i += 2; continue; }
            if (next === 'r') { token += '\r'; i += 2; continue; }
            // Preserve other backslash sequences literally
            token += src[i];
            i++;
          } else {
            token += src[i];
            i++;
          }
        }
        if (i < len) i++; // skip closing "
        continue;
      }

      // Backslash escape outside quotes
      if (ch === '\\' && i + 1 < len) {
        token += src[i + 1];
        i += 2;
        continue;
      }

      // Regular character
      token += ch;
      i++;
    }

    if (token.length > 0) {
      tokens.push(token);
    }
  }

  return tokens;
}

// ── Curl flag parser ─────────────────────────────────────────────────

/**
 * Returns the value for a flag that expects a value.
 * Handles:
 *  - `-H value`    (separate tokens)
 *  - `-Hvalue`     (joined short flag)
 *  - `--header=value` (long flag with =)
 *  - `--header value` (separate tokens)
 */
function getFlagValue(
  tokens: string[],
  i: number,
  short: string,
  long: string,
): { value: string; skip: number } | null {
  const arg = tokens[i];

  // Exact match: value is next token
  if ((short && arg === short) || (long && arg === long)) {
    if (i + 1 < tokens.length) {
      return { value: tokens[i + 1], skip: 2 };
    }
    return null;
  }

  // Joined form for short flags: -Hvalue
  if (short && arg.startsWith(short) && arg.length > short.length) {
    return { value: arg.slice(short.length), skip: 1 };
  }

  // Long flag with = : --header=value
  if (long && arg.startsWith(long + '=')) {
    return { value: arg.slice(long.length + 1), skip: 1 };
  }

  return null;
}

/** Try multiple long-form aliases for a flag (e.g. --data-raw, --data-binary, --data). */
function getDataFlagValue(
  tokens: string[],
  i: number,
): { value: string; skip: number } | null {
  // Order matters: try longer forms first to avoid --data matching --data-raw
  return (
    getFlagValue(tokens, i, '', '--data-raw') ||
    getFlagValue(tokens, i, '', '--data-binary') ||
    getFlagValue(tokens, i, '', '--data-ascii') ||
    getFlagValue(tokens, i, '', '--data-urlencode') ||
    getFlagValue(tokens, i, '-d', '--data')
  );
}

/**
 * Undo the "smart" Unicode substitutions macOS (and rich-text web editors)
 * silently apply when text is pasted from sources like Apple Notes, Notion,
 * Slack, or Google Docs:
 *  - U+2013 EN DASH / U+2014 EM DASH back to `--` so `—header` parses
 *    as `--header`
 *  - U+2018/U+2019 (curly single quotes) and U+201C/U+201D (curly double
 *    quotes) back to straight quotes so the tokenizer's quoting logic
 *    actually triggers
 *  - U+00A0 NO-BREAK SPACE back to a normal space so token boundaries land
 *    where they should
 * Pre-normalizing here keeps the tokenizer's source ASCII-clean without
 * sprinkling case-by-case handling inside it.
 */
function normalizeSmartPunctuation(input: string): string {
  return input
    .replace(/[–—]/g, '--')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, ' ');
}

const CURL_FLAG_RE = /(^|\s)(?:-H|-X|-d|-F|-u|-b|-A|-e|--header|--request|--data(?:-(?:raw|binary|ascii|urlencode))?|--json|--form(?:-string)?|--user|--cookie|--user-agent|--referer|--compressed|--url)(\s|=)/i;
const URL_TOKEN_RE = /(?:^|\s|['"`])(?:https?:\/\/|\/\/)\S+/i;

/** Permissive: any input the Import cURL dialog should try to ingest.
 *  Used by `parseCurl` when the literal `curl` prefix is missing. */
function looksLikeCurlInput(input: string): boolean {
  return CURL_FLAG_RE.test(input) || URL_TOKEN_RE.test(input);
}

/**
 * Strict check for URL-bar paste: only intercept when input clearly carries
 * curl semantics (literal `curl` token or at least one curl flag). A bare
 * URL paste must fall through to the URL bar's plain-paste path, otherwise
 * we silently overwrite the user's method/headers/body on every URL paste.
 */
export function looksLikeCurlCommand(input: string): boolean {
  const t = normalizeSmartPunctuation(input).trim();
  if (!t) return false;
  if (/^curl(\s|\t|$)/i.test(t)) return true;
  return CURL_FLAG_RE.test(t);
}

export function parseCurl(curlCommand: string): ParsedCurl | null {
  const trimmed = normalizeSmartPunctuation(curlCommand).trim();
  if (!trimmed) return null;

  // Accept three input shapes:
  //   1. Proper command: `curl 'https://…' -H ...`
  //   2. Naked Postman-style: `'https://…' --header ... --data ...`
  //   3. URL-only fragment: `postman request 'https://…?orderId=…'`
  // The tokenizer assumes a leading argv[0]; for shapes 2 and 3 we prepend
  // a synthetic `curl `. We accept anything that either has the literal
  // `curl` prefix, a curl-specific flag, or simply contains a URL-shaped
  // token (http/https://, //, or a quoted string with a domain dot).
  // The URL-only branch is intentionally permissive so the Import dialog
  // can ingest "smart paste" fragments; the URL-bar paste handler does
  // its own pre-check (see `looksLikeCurlInput` below) to avoid hijacking
  // a plain URL paste.
  let toParse = trimmed;
  const hasCurlPrefix = /^curl(\s|\t|$)/i.test(toParse);
  if (!hasCurlPrefix) {
    if (!looksLikeCurlInput(toParse)) return null;
    toParse = 'curl ' + toParse;
  }

  const tokens = tokenize(toParse);
  if (tokens.length === 0 || tokens[0].toLowerCase() !== 'curl') return null;

  let method = '';
  let url = '';
  const headers: Array<{ key: string; value: string; enabled: boolean }> = [];
  const dataFragments: string[] = [];
  let hasJsonFlag = false;
  let hasFormData = false;
  const formFields: string[] = [];
  let basicAuth = '';
  let compressed = false;

  let i = 1; // skip "curl"
  while (i < tokens.length) {
    const arg = tokens[i];

    // ── Method: -X / --request ──
    const methodVal = getFlagValue(tokens, i, '-X', '--request');
    if (methodVal) {
      method = methodVal.value.toUpperCase();
      i += methodVal.skip;
      continue;
    }

    // ── Header: -H / --header ──
    const headerVal = getFlagValue(tokens, i, '-H', '--header');
    if (headerVal) {
      const colonIdx = headerVal.value.indexOf(':');
      if (colonIdx > 0) {
        const key = headerVal.value.substring(0, colonIdx).trim();
        const value = headerVal.value.substring(colonIdx + 1).trim();
        // Don't add duplicate headers, last one wins (like curl)
        const existingIdx = headers.findIndex(
          (h) => h.key.toLowerCase() === key.toLowerCase(),
        );
        if (existingIdx >= 0) {
          headers[existingIdx] = { key, value, enabled: true };
        } else {
          headers.push({ key, value, enabled: true });
        }
      }
      i += headerVal.skip;
      continue;
    }

    // ── Data: -d / --data / --data-raw / --data-binary / --data-ascii / --data-urlencode ──
    const dataVal = getDataFlagValue(tokens, i);
    if (dataVal) {
      dataFragments.push(dataVal.value);
      i += dataVal.skip;
      continue;
    }

    // ── JSON: --json ──
    const jsonVal = getFlagValue(tokens, i, '', '--json');
    if (jsonVal) {
      dataFragments.push(jsonVal.value);
      hasJsonFlag = true;
      i += jsonVal.skip;
      continue;
    }

    // ── Form: -F / --form / --form-string ──
    const formVal = getFlagValue(tokens, i, '-F', '--form') || getFlagValue(tokens, i, '', '--form-string');
    if (formVal) {
      formFields.push(formVal.value);
      hasFormData = true;
      i += formVal.skip;
      continue;
    }

    // ── Basic auth: -u / --user ──
    const authVal = getFlagValue(tokens, i, '-u', '--user');
    if (authVal) {
      basicAuth = authVal.value;
      i += authVal.skip;
      continue;
    }

    // ── User-Agent: -A / --user-agent ──
    const uaVal = getFlagValue(tokens, i, '-A', '--user-agent');
    if (uaVal) {
      const existingIdx = headers.findIndex((h) => h.key.toLowerCase() === 'user-agent');
      if (existingIdx >= 0) {
        headers[existingIdx] = { key: 'User-Agent', value: uaVal.value, enabled: true };
      } else {
        headers.push({ key: 'User-Agent', value: uaVal.value, enabled: true });
      }
      i += uaVal.skip;
      continue;
    }

    // ── Referer: -e / --referer ──
    const refVal = getFlagValue(tokens, i, '-e', '--referer');
    if (refVal) {
      const existingIdx = headers.findIndex((h) => h.key.toLowerCase() === 'referer');
      if (existingIdx >= 0) {
        headers[existingIdx] = { key: 'Referer', value: refVal.value, enabled: true };
      } else {
        headers.push({ key: 'Referer', value: refVal.value, enabled: true });
      }
      i += refVal.skip;
      continue;
    }

    // ── Cookie: -b / --cookie ──
    const cookieVal = getFlagValue(tokens, i, '-b', '--cookie');
    if (cookieVal) {
      const existingIdx = headers.findIndex((h) => h.key.toLowerCase() === 'cookie');
      if (existingIdx >= 0) {
        headers[existingIdx] = { key: 'Cookie', value: cookieVal.value, enabled: true };
      } else {
        headers.push({ key: 'Cookie', value: cookieVal.value, enabled: true });
      }
      i += cookieVal.skip;
      continue;
    }

    // ── Explicit URL: --url ──
    const urlFlagVal = getFlagValue(tokens, i, '', '--url');
    if (urlFlagVal) {
      url = urlFlagVal.value;
      i += urlFlagVal.skip;
      continue;
    }

    // ── Compressed: --compressed ──
    if (arg === '--compressed') {
      compressed = true;
      i++;
      continue;
    }

    // ── Boolean flags to skip (consume without value) ──
    if (
      arg === '-s' || arg === '--silent' ||
      arg === '-S' || arg === '--show-error' ||
      arg === '-i' || arg === '--include' ||
      arg === '-v' || arg === '--verbose' ||
      arg === '-k' || arg === '--insecure' ||
      arg === '-L' || arg === '--location' ||
      arg === '-g' || arg === '--globoff' ||
      arg === '-N' || arg === '--no-buffer' ||
      arg === '-f' || arg === '--fail' ||
      arg === '--fail-with-body' ||
      arg === '--fail-early' ||
      arg === '--http1.1' || arg === '--http2' || arg === '--http3' ||
      arg === '--tr-encoding' ||
      arg === '--raw' ||
      arg === '--tcp-fastopen' ||
      arg === '--no-keepalive' ||
      arg === '--keepalive-time' ||
      arg === '--no-sessionid' ||
      arg === '--path-as-is' ||
      arg === '--ssl' || arg === '--ssl-reqd' ||
      arg === '--create-dirs'
    ) {
      i++;
      continue;
    }

    // ── Combined short boolean flags like -sSL, -kvL ──
    if (/^-[a-zA-Z]{2,}$/.test(arg) && !arg.startsWith('--')) {
      // Check if all chars are known boolean short flags
      const booleanShorts = new Set(['s', 'S', 'i', 'v', 'k', 'L', 'g', 'N', 'f', 'O', 'J', 'l', 'q', '#', '0', '1', '2', '3', '4', '6']);
      const chars = arg.slice(1).split('');
      if (chars.every((c) => booleanShorts.has(c))) {
        i++;
        continue;
      }
    }

    // ── Flags that take a value but we don't care about ──
    if (
      arg === '-o' || arg === '--output' ||
      arg === '-w' || arg === '--write-out' ||
      arg === '-m' || arg === '--max-time' ||
      arg === '--connect-timeout' ||
      arg === '-x' || arg === '--proxy' ||
      arg === '-U' || arg === '--proxy-user' ||
      arg === '-E' || arg === '--cert' ||
      arg === '--key' ||
      arg === '--cacert' ||
      arg === '--capath' ||
      arg === '-c' || arg === '--cookie-jar' ||
      arg === '--resolve' ||
      arg === '--retry' ||
      arg === '--retry-delay' ||
      arg === '--retry-max-time' ||
      arg === '--max-redirs' ||
      arg === '-t' || arg === '--telnet-option' ||
      arg === '-T' || arg === '--upload-file' ||
      arg === '-r' || arg === '--range' ||
      arg === '-C' || arg === '--continue-at' ||
      arg === '-Y' || arg === '--speed-limit' ||
      arg === '-y' || arg === '--speed-time' ||
      arg === '--limit-rate' ||
      arg === '--interface' ||
      arg === '--local-port' ||
      arg === '--dns-servers' ||
      arg === '--dns-interface' ||
      arg === '--dns-ipv4-addr' ||
      arg === '--dns-ipv6-addr'
    ) {
      i += 2; // skip flag + value
      continue;
    }

    // ── Positional argument: treat as URL if it looks like one ──
    if (!arg.startsWith('-')) {
      // Could be a URL
      if (!url && (arg.includes('://') || arg.includes('localhost') || arg.includes('/') || arg.includes('.'))) {
        url = arg;
      }
      i++;
      continue;
    }

    // Unknown flag - skip it
    i++;
  }

  if (!url) return null;

  // ── Determine protocol ──
  let protocol = 'https://';
  if (url.startsWith('http://')) {
    protocol = 'http://';
  } else if (url.startsWith('https://')) {
    protocol = 'https://';
  } else {
    // No protocol specified, assume https
    url = 'https://' + url;
  }

  // ── Split off the query string into structured params ──
  // We want the Params editor to be the single source of truth — the URL
  // bar stays short and the user can toggle/edit each param. Anything we
  // can't decode (malformed %XX, bracketed array keys, etc.) we surface
  // verbatim so the round-trip preserves intent.
  const params: ParsedCurl['params'] = [];
  const qIdx = url.indexOf('?');
  if (qIdx >= 0) {
    const queryString = url.slice(qIdx + 1);
    url = url.slice(0, qIdx);
    if (queryString) {
      for (const pair of queryString.split('&')) {
        if (!pair) continue;
        const eqIdx = pair.indexOf('=');
        let key: string;
        let value: string;
        if (eqIdx >= 0) {
          key = pair.slice(0, eqIdx);
          value = pair.slice(eqIdx + 1);
        } else {
          key = pair;
          value = '';
        }
        const safeDecode = (s: string) => {
          try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
        };
        params.push({ key: safeDecode(key), value: safeDecode(value), enabled: true });
      }
    }
  }

  // ── Build body ──
  let body = '';
  let bodyType: ParsedCurl['bodyType'] = 'none';

  if (dataFragments.length > 0) {
    body = dataFragments.join('&');
    bodyType = 'raw';

    // Auto-detect JSON
    if (hasJsonFlag) {
      bodyType = 'json';
    } else {
      try {
        JSON.parse(body);
        bodyType = 'json';
      } catch {
        // Check Content-Type header
        const ctHeader = headers.find((h) => h.key.toLowerCase() === 'content-type');
        if (ctHeader?.value.toLowerCase().includes('application/json')) {
          bodyType = 'json';
        } else if (ctHeader?.value.toLowerCase().includes('application/x-www-form-urlencoded')) {
          bodyType = 'form';
        }
      }
    }
  } else if (hasFormData && formFields.length > 0) {
    body = formFields.join('\n');
    bodyType = 'form';
  }

  // Structured form-field view for callers that wire into the Body
  // editor. We compute it here once so curlToTab / paste handlers don't
  // have to re-split. Only populated when the user supplied -F flags.
  const structuredFormFields = hasFormData
    ? formFields.map(parseFormFieldEntry)
    : undefined;

  // ── Determine method ──
  if (!method) {
    if (body || hasFormData) {
      method = 'POST';
    } else {
      method = 'GET';
    }
  }

  // ── --json auto-headers (only if not already set) ──
  if (hasJsonFlag) {
    if (!headers.find((h) => h.key.toLowerCase() === 'content-type')) {
      headers.push({ key: 'Content-Type', value: 'application/json', enabled: true });
    }
    if (!headers.find((h) => h.key.toLowerCase() === 'accept')) {
      headers.push({ key: 'Accept', value: 'application/json', enabled: true });
    }
  }

  // ── --compressed auto-header ──
  if (compressed && !headers.find((h) => h.key.toLowerCase() === 'accept-encoding')) {
    headers.push({ key: 'Accept-Encoding', value: 'gzip, deflate, br', enabled: true });
  }

  // ── Auth ──
  let auth: ParsedCurl['auth'];
  if (basicAuth) {
    const colonIdx = basicAuth.indexOf(':');
    if (colonIdx >= 0) {
      auth = {
        type: 'basic',
        username: basicAuth.substring(0, colonIdx),
        password: basicAuth.substring(colonIdx + 1),
      };
    } else {
      auth = { type: 'basic', username: basicAuth, password: '' };
    }
  } else {
    // Check for Bearer token in headers
    const authHeader = headers.find((h) => h.key.toLowerCase() === 'authorization');
    if (authHeader?.value.toLowerCase().startsWith('bearer ')) {
      auth = {
        type: 'bearer',
        token: authHeader.value.substring(7).trim(),
      };
    }
  }

  return { method, url, headers, params, body, bodyType, formFields: structuredFormFields, protocol, auth };
}

/**
 * Convenience wrapper that returns headers as Record<string, string>
 * for use in QA TestCaseWizard.
 */
export function parseCurlAsRecord(curlCommand: string): {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
} | null {
  const parsed = parseCurl(curlCommand);
  if (!parsed) return null;

  const headers: Record<string, string> = {};
  for (const h of parsed.headers) {
    headers[h.key] = h.value;
  }

  return {
    method: parsed.method,
    url: parsed.url,
    headers,
    body: parsed.body,
  };
}
