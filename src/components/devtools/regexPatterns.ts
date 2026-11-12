// Catalog of ready-made regexes for the Regex tester tool. Sources are stored
// as raw strings (no surrounding slashes) so they feed straight into
// `new RegExp(pattern, flags)`. Kept purposely pragmatic over exhaustive.

export interface RegexPattern {
  id: string; // stable key; UI shows translated name/description via `regexLib.<id>.*`
  name: string; // English source reference (rendered from i18n, not this field)
  description: string; // English source reference (rendered from i18n)
  pattern: string; // the raw regex source (no surrounding slashes)
  flags: string; // e.g. "", "g", "gi", "u"
  sample: string; // a test string that meaningfully exercises the pattern
}

export interface RegexCategory {
  id: string; // UI shows translated name via `regexLib.cat.<id>`
  name: string; // English source reference
  patterns: RegexPattern[];
}

export const REGEX_LIBRARY: RegexCategory[] = [
  {
    id: 'validation',
    name: 'Validation',
    patterns: [
      {
        id: 'emailPragmatic',
        name: 'Email (pragmatic)',
        description: 'Practical email check — not full RFC 5322.',
        pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
        flags: '',
        sample: 'user@example.com',
      },
      {
        id: 'emailStrict',
        name: 'Email (stricter)',
        description: 'Restricted local/domain character set with a 2+ letter TLD.',
        pattern: '^[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}$',
        flags: '',
        sample: 'jane.doe+tag@sub.example.co',
      },
      {
        id: 'passwordStrong',
        name: 'Password (8+, upper, lower, digit, special)',
        description:
          'Min 8 chars with at least one lowercase, uppercase, digit, and special character.',
        pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,}$',
        flags: '',
        sample: 'Aa1!aaaa',
      },
      {
        id: 'passwordMedium',
        name: 'Password (8+, upper, lower, digit)',
        description: 'Min 8 chars with at least one lowercase, uppercase, and digit.',
        pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}$',
        flags: '',
        sample: 'Passw0rd',
      },
      {
        id: 'fullName',
        name: 'Full name (Ad Soyad, Unicode)',
        description:
          'Two or more Unicode words (supports Turkish letters); allows spaces, apostrophes, hyphens.',
        pattern: "^\\p{L}+(?:[ '-]\\p{L}+)+$",
        flags: 'u',
        sample: 'Jane Doe',
      },
      {
        id: 'urlHttp',
        name: 'URL (http/https)',
        description: 'Absolute http or https URL.',
        pattern: '^https?:\\/\\/[^\\s/$.?#].[^\\s]*$',
        flags: 'i',
        sample: 'https://example.com/path?q=1',
      },
      {
        id: 'slug',
        name: 'Slug',
        description: 'Lowercase URL slug — words joined by single hyphens.',
        pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
        flags: '',
        sample: 'my-cool-post-2',
      },
      {
        id: 'uuidV4',
        name: 'UUID (v4)',
        description: 'RFC 4122 version-4 UUID.',
        pattern:
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
        flags: '',
        sample: '9b2e4c1a-3f77-4a2b-8c1d-2e5f6a7b8c9d',
      },
      {
        id: 'hexColor',
        name: 'Hex color',
        description: '3- or 6-digit hex color with a leading #.',
        pattern: '^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$',
        flags: '',
        sample: '#1a2b3c',
      },
      {
        id: 'ipv4',
        name: 'IPv4',
        description: 'Dotted-quad IPv4 address (0–255 per octet).',
        pattern: '^(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)$',
        flags: '',
        sample: '192.0.2.10',
      },
      {
        id: 'isoDate',
        name: 'ISO date (YYYY-MM-DD)',
        description: 'Calendar date in YYYY-MM-DD form.',
        pattern: '^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])$',
        flags: '',
        sample: '2026-07-24',
      },
      {
        id: 'time24h',
        name: 'Time (24h HH:MM)',
        description: '24-hour clock time, HH:MM.',
        pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$',
        flags: '',
        sample: '23:59',
      },
      {
        id: 'phoneTr',
        name: 'Turkish phone',
        description: 'Turkish GSM number, optional +90/0 prefix and spacing.',
        pattern: '^(?:\\+90|0)?\\s?5\\d{2}\\s?\\d{3}\\s?\\d{2}\\s?\\d{2}$',
        flags: '',
        sample: '+90 532 123 45 67',
      },
      {
        id: 'phoneE164',
        name: 'Phone (E.164)',
        description: 'International phone number in E.164 form.',
        pattern: '^\\+?[1-9]\\d{1,14}$',
        flags: '',
        sample: '+905321234567',
      },
      {
        id: 'tcKimlik',
        name: 'Turkish ID (TC Kimlik No, format only)',
        description: '11 digits, not starting with 0 (format check only, no checksum).',
        pattern: '^[1-9]\\d{10}$',
        flags: '',
        sample: '12345678901',
      },
      {
        id: 'iban',
        name: 'IBAN (generic)',
        description: 'Generic IBAN — 2-letter country, 2 check digits, 11–30 alphanumerics.',
        pattern: '^[A-Z]{2}\\d{2}[A-Z0-9]{11,30}$',
        flags: '',
        sample: 'TR330006100519786457841326',
      },
    ],
  },
  {
    id: 'extraction',
    name: 'Extraction',
    patterns: [
      {
        id: 'numbers',
        name: 'Numbers (int/float)',
        description: 'Integers and decimals, with an optional leading minus.',
        pattern: '-?\\d+(?:\\.\\d+)?',
        flags: 'g',
        sample: 'qty 12 at 3.50 each, -4 returned',
      },
      {
        id: 'words',
        name: 'Words',
        description: 'Word tokens — letters, digits, and underscore.',
        pattern: '\\b\\w+\\b',
        flags: 'g',
        sample: 'hello world foo_bar',
      },
      {
        id: 'hashtags',
        name: 'Hashtags',
        description: 'Hashtags like #topic.',
        pattern: '#\\w+',
        flags: 'g',
        sample: 'love #getman and #devtools',
      },
      {
        id: 'mentions',
        name: 'Mentions',
        description: 'Mentions like @user.',
        pattern: '@\\w+',
        flags: 'g',
        sample: 'cc @jane and @team',
      },
      {
        id: 'htmlTags',
        name: 'HTML tags',
        description: 'Opening and closing HTML tags.',
        pattern: '<\\/?[a-zA-Z][^>]*>',
        flags: 'g',
        sample: '<p class="x">hi</p>',
      },
      {
        id: 'dupWord',
        name: 'Duplicate word',
        description: 'A word immediately repeated, captured in group 1.',
        pattern: '\\b(\\w+)\\s+\\1\\b',
        flags: 'gi',
        sample: 'the the cat sat sat',
      },
    ],
  },
];
