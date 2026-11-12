// Mock-data generator (Mockaroo-style). Fully client-side, procedural — small
// generic word/name lists + Math.random. No dependencies, no network.

export type FieldType =
  | 'rowNumber' | 'uuid' | 'firstName' | 'lastName' | 'fullName' | 'email' | 'username'
  | 'phone' | 'boolean' | 'integer' | 'decimal' | 'date' | 'datetime' | 'city' | 'country'
  | 'company' | 'word' | 'sentence' | 'paragraph' | 'url' | 'ipv4' | 'color' | 'enum' | 'constant';

export interface FieldTypeDef {
  type: FieldType;
  label: string;
  group: string;
  /** which option inputs this type exposes */
  opts?: Array<'min' | 'max' | 'decimals' | 'from' | 'to' | 'list' | 'value'>;
}

export const FIELD_TYPES: FieldTypeDef[] = [
  { type: 'rowNumber', label: 'Row number', group: 'Basic' },
  { type: 'uuid', label: 'UUID', group: 'Basic' },
  { type: 'boolean', label: 'Boolean', group: 'Basic' },
  { type: 'integer', label: 'Integer', group: 'Number', opts: ['min', 'max'] },
  { type: 'decimal', label: 'Decimal', group: 'Number', opts: ['min', 'max', 'decimals'] },
  { type: 'firstName', label: 'First name', group: 'Person' },
  { type: 'lastName', label: 'Last name', group: 'Person' },
  { type: 'fullName', label: 'Full name', group: 'Person' },
  { type: 'email', label: 'Email', group: 'Person' },
  { type: 'username', label: 'Username', group: 'Person' },
  { type: 'phone', label: 'Phone', group: 'Person' },
  { type: 'city', label: 'City', group: 'Location' },
  { type: 'country', label: 'Country', group: 'Location' },
  { type: 'ipv4', label: 'IPv4', group: 'Location' },
  { type: 'company', label: 'Company', group: 'Commerce' },
  { type: 'url', label: 'URL', group: 'Commerce' },
  { type: 'color', label: 'Color (hex)', group: 'Commerce' },
  { type: 'date', label: 'Date', group: 'Time', opts: ['from', 'to'] },
  { type: 'datetime', label: 'Datetime (ISO)', group: 'Time', opts: ['from', 'to'] },
  { type: 'word', label: 'Word', group: 'Text' },
  { type: 'sentence', label: 'Sentence', group: 'Text' },
  { type: 'paragraph', label: 'Paragraph', group: 'Text' },
  { type: 'enum', label: 'Enum (pick from list)', group: 'Custom', opts: ['list'] },
  { type: 'constant', label: 'Constant', group: 'Custom', opts: ['value'] },
];

export interface MockField {
  id: string;
  name: string;
  type: FieldType;
  min?: number;
  max?: number;
  decimals?: number;
  from?: string;
  to?: string;
  list?: string;
  value?: string;
  /** percent of rows to leave null (0-100) */
  blank?: number;
}

// ── generic source data (short, generic) ────────────────────────────────
const FIRST = ['Ada', 'Kenan', 'Mert', 'Zoe', 'Liam', 'Emma', 'Noah', 'Olivia', 'Ethan', 'Mia', 'Aria', 'Leo', 'Nora', 'Ivan', 'Sara', 'Omar', 'Lena', 'Yusuf', 'Elif', 'Deniz'];
const LAST = ['Kurt', 'Yilmaz', 'Demir', 'Kaya', 'Smith', 'Johnson', 'Brown', 'Garcia', 'Nguyen', 'Kim', 'Rossi', 'Novak', 'Silva', 'Haddad', 'Ivanov', 'Wagner', 'Costa', 'Popov', 'Chen', 'Diallo'];
const CITY = ['Istanbul', 'Ankara', 'Izmir', 'Berlin', 'Paris', 'Madrid', 'Rome', 'Lisbon', 'Vienna', 'Prague', 'Warsaw', 'Oslo', 'Dublin', 'Zurich', 'Athens', 'Porto'];
const COUNTRY = ['Turkey', 'Germany', 'France', 'Spain', 'Italy', 'Portugal', 'Austria', 'Poland', 'Norway', 'Ireland', 'Greece', 'Netherlands', 'Sweden', 'Denmark'];
const COMPANY_A = ['Blue', 'Nova', 'Peak', 'Bright', 'Core', 'Swift', 'Quantum', 'Pixel', 'Astra', 'Vertex', 'North', 'Cloud', 'Iron', 'Green'];
const COMPANY_B = ['Systems', 'Labs', 'Works', 'Group', 'Tech', 'Digital', 'Solutions', 'Dynamics', 'Networks', 'Studio', 'Industries', 'Data'];
const WORDS = ['lorem', 'ipsum', 'dolor', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'tempor', 'labore', 'magna', 'aliqua', 'enim', 'minim', 'veniam', 'nostrud', 'aliquip', 'commodo', 'velit', 'cillum', 'fugiat', 'nulla', 'proident', 'culpa', 'officia', 'mollit'];
const TLD = ['com', 'io', 'net', 'org', 'dev', 'co'];

function pick<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }
function randInt(min: number, max: number): number {
  const lo = Math.ceil(min); const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}
function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function words(n: number): string { return Array.from({ length: n }, () => pick(WORDS)).join(' '); }
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

function genOne(f: MockField, rowIndex: number): unknown {
  switch (f.type) {
    case 'rowNumber': return rowIndex + 1;
    case 'uuid': return crypto.randomUUID();
    case 'boolean': return Math.random() < 0.5;
    case 'integer': return randInt(f.min ?? 0, f.max ?? 1000);
    case 'decimal': {
      const lo = f.min ?? 0, hi = f.max ?? 1000, d = f.decimals ?? 2;
      return Number((Math.random() * (hi - lo) + lo).toFixed(d));
    }
    case 'firstName': return pick(FIRST);
    case 'lastName': return pick(LAST);
    case 'fullName': return `${pick(FIRST)} ${pick(LAST)}`;
    case 'email': return `${slug(pick(FIRST))}.${slug(pick(LAST))}${randInt(1, 99)}@${slug(pick(COMPANY_A))}.${pick(TLD)}`;
    case 'username': return `${slug(pick(FIRST))}_${slug(pick(LAST))}${randInt(1, 999)}`;
    case 'phone': return `+${randInt(1, 99)} ${randInt(100, 999)} ${randInt(100, 999)} ${randInt(1000, 9999)}`;
    case 'city': return pick(CITY);
    case 'country': return pick(COUNTRY);
    case 'ipv4': return `${randInt(1, 254)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`;
    case 'company': return `${pick(COMPANY_A)} ${pick(COMPANY_B)}`;
    case 'url': return `https://${slug(pick(COMPANY_A))}.${pick(TLD)}/${slug(pick(WORDS))}`;
    case 'color': return '#' + randInt(0, 0xffffff).toString(16).padStart(6, '0');
    case 'date': return randomDate(f.from, f.to).toISOString().slice(0, 10);
    case 'datetime': return randomDate(f.from, f.to).toISOString();
    case 'word': return pick(WORDS);
    case 'sentence': return cap(words(randInt(6, 12))) + '.';
    case 'paragraph': return Array.from({ length: randInt(3, 5) }, () => cap(words(randInt(6, 12))) + '.').join(' ');
    case 'enum': {
      const items = (f.list ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      return items.length ? pick(items) : null;
    }
    case 'constant': return f.value ?? '';
    default: return null;
  }
}

function randomDate(from?: string, to?: string): Date {
  const start = from ? Date.parse(from) : Date.parse('2020-01-01');
  const end = to ? Date.parse(to) : Date.now();
  const lo = Number.isNaN(start) ? Date.parse('2020-01-01') : start;
  const hi = Number.isNaN(end) ? Date.now() : end;
  return new Date(lo + Math.random() * (hi - lo));
}

export function generateRows(fields: MockField[], count: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const n = Math.max(0, Math.min(count, 100000));
  for (let i = 0; i < n; i++) {
    const row: Record<string, unknown> = {};
    for (const f of fields) {
      const key = f.name.trim() || f.type;
      if (f.blank && Math.random() * 100 < f.blank) { row[key] = null; continue; }
      row[key] = genOne(f, i);
    }
    rows.push(row);
  }
  return rows;
}

// ── formatters ───────────────────────────────────────────────────────────
export type OutputFormat = 'json' | 'ndjson' | 'csv' | 'sql';

export function formatRows(rows: Record<string, unknown>[], fields: MockField[], format: OutputFormat, table: string): string {
  const cols = fields.map((f) => f.name.trim() || f.type);
  switch (format) {
    case 'json':
      return JSON.stringify(rows, null, 2);
    case 'ndjson':
      return rows.map((r) => JSON.stringify(r)).join('\n');
    case 'csv': {
      const head = cols.map(csvCell).join(',');
      const body = rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')).join('\n');
      return head + '\n' + body;
    }
    case 'sql': {
      const t = slug(table) || 'mock_data';
      const colList = cols.map((c) => `\`${c}\``).join(', ');
      return rows
        .map((r) => `INSERT INTO \`${t}\` (${colList}) VALUES (${cols.map((c) => sqlCell(r[c])).join(', ')});`)
        .join('\n');
    }
  }
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function sqlCell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
}
