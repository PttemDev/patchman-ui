// Cookbook catalog: correct-by-default reference implementations for the
// things that are commonly done wrong. Each recipe pairs a "common mistake"
// note with side-by-side Go / TypeScript / Python / C# implementations.

export interface SnippetLang {
  lang: string; // display name, e.g. "Go"
  code: string;
}

export interface Recipe {
  id: string;
  title: string;
  pitfall: string; // the common mistake this recipe steers you away from
  langs: SnippetLang[];
}

export interface SnippetCategory {
  id: string;
  // Human-readable English name — kept as the source reference. The UI renders
  // the translated name via the i18n key `snippetsLib.cat.<id>` (devtools ns);
  // recipe `title`/`pitfall` likewise come from `snippetsLib.<recipe.id>.*`.
  name: string;
  recipes: Recipe[];
}

export const SNIPPETS: SnippetCategory[] = [
  {
    id: 'dateTime',
    name: 'Date & Time',
    recipes: [
      {
        id: 'time-parse',
        title: 'Parse & format timestamps (timezone-aware)',
        pitfall:
          'Parsing wall-clock strings in the server\'s local zone, or formatting without a zone — silently shifts times across DST and machines.',
        langs: [
          {
            lang: 'Go',
            code: `import "time"

// Prefer RFC3339 — it carries its own offset, so it is unambiguous.
t, err := time.Parse(time.RFC3339, "2026-07-24T12:00:00Z")
if err != nil { /* handle */ }

// Parsing a wall-clock string in a SPECIFIC zone (not the server local zone):
loc, _ := time.LoadLocation("Europe/Istanbul")
t2, err := time.ParseInLocation("2006-01-02 15:04:05", "2026-07-24 12:00:00", loc)

// Format back as RFC3339 in UTC:
s := t.UTC().Format(time.RFC3339)`,
          },
          {
            lang: 'TypeScript',
            code: `// Footgun: new Date("2026-07-24") is UTC midnight, but
// new Date("2026-07-24T12:00:00") (no offset) is parsed as LOCAL time.
// Always include an explicit offset/Z.
const t = new Date("2026-07-24T12:00:00Z"); // unambiguous (UTC)

// Format as ISO 8601 (UTC):
t.toISOString(); // "2026-07-24T12:00:00.000Z"

// Display in a specific zone without a library:
new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  dateStyle: "short",
  timeStyle: "medium",
}).format(t);`,
          },
          {
            lang: 'Python',
            code: `from datetime import datetime, timezone
from zoneinfo import ZoneInfo  # stdlib, 3.9+

# Parse ISO 8601 (3.11+ also accepts a trailing 'Z'):
t = datetime.fromisoformat("2026-07-24T12:00:00+00:00")

# NEVER use naive datetimes for instants — always attach a tz:
now = datetime.now(timezone.utc)

# Convert to a specific zone:
local = t.astimezone(ZoneInfo("Europe/Istanbul"))

# Format as ISO 8601:
t.isoformat()`,
          },
          {
            lang: 'C#',
            code: `using System;
using System.Globalization;

// Parse an ISO 8601 / RFC3339 string, preserving the offset (don't force local):
var t = DateTimeOffset.Parse("2026-07-24T12:00:00Z",
    CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

// Interpret a wall-clock value in a SPECIFIC zone (IANA ids work on .NET 6+):
var tz = TimeZoneInfo.FindSystemTimeZoneById("Europe/Istanbul");
var wall = new DateTime(2026, 7, 24, 12, 0, 0, DateTimeKind.Unspecified);
var instant = new DateTimeOffset(wall, tz.GetUtcOffset(wall));

// Format as round-trip ISO 8601 (UTC):
string s = t.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture);`,
          },
        ],
      },
      {
        id: 'epoch-convert',
        title: 'Convert epoch ↔ date',
        pitfall:
          'Mixing seconds and milliseconds — a silent 1000× error that lands you in 1970 or the year 52000.',
        langs: [
          {
            lang: 'Go',
            code: `import "time"

// Be explicit about the unit.
sec := time.Now().Unix()       // seconds
ms  := time.Now().UnixMilli()  // milliseconds

// Back to time.Time:
t1 := time.Unix(sec, 0).UTC()
t2 := time.UnixMilli(ms).UTC()`,
          },
          {
            lang: 'TypeScript',
            code: `const ms = Date.now();              // JS works in milliseconds
const sec = Math.floor(ms / 1000);  // seconds

new Date(ms);          // from milliseconds
new Date(sec * 1000);  // from seconds — remember to multiply!`,
          },
          {
            lang: 'Python',
            code: `import time
from datetime import datetime, timezone

sec = int(time.time())         # seconds
ms = int(time.time() * 1000)   # milliseconds

datetime.fromtimestamp(sec, tz=timezone.utc)       # from seconds
datetime.fromtimestamp(ms / 1000, tz=timezone.utc) # from milliseconds`,
          },
          {
            lang: 'C#',
            code: `using System;

long sec = DateTimeOffset.UtcNow.ToUnixTimeSeconds();      // seconds
long ms  = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); // milliseconds

DateTimeOffset t1 = DateTimeOffset.FromUnixTimeSeconds(sec);
DateTimeOffset t2 = DateTimeOffset.FromUnixTimeMilliseconds(ms);`,
          },
        ],
      },
    ],
  },
  {
    id: 'auth',
    name: 'Auth & Tokens',
    recipes: [
      {
        id: 'jwt-verify',
        title: 'Verify a JWT',
        pitfall:
          'Decoding without verifying the signature, accepting alg:none, not pinning the algorithm (RS→HS key confusion), or skipping exp/aud/iss.',
        langs: [
          {
            lang: 'Go',
            code: `import (
    "fmt"
    "github.com/golang-jwt/jwt/v5"
)

token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
    // Pin the method — this defeats alg:none and RS/HS key confusion.
    if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
        return nil, fmt.Errorf("unexpected alg: %v", t.Header["alg"])
    }
    return []byte(secret), nil
},
    jwt.WithValidMethods([]string{"HS256"}),
    jwt.WithExpirationRequired(),
    jwt.WithAudience("my-api"),
    jwt.WithIssuer("my-issuer"),
)
if err != nil || !token.Valid {
    // reject
}`,
          },
          {
            lang: 'TypeScript',
            code: `import { jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

const { payload } = await jwtVerify(token, secret, {
  algorithms: ["HS256"],   // pin it — never trust the token's header
  issuer: "my-issuer",
  audience: "my-api",
});
// exp/nbf are checked automatically; throws on any failure.`,
          },
          {
            lang: 'Python',
            code: `import jwt  # PyJWT

payload = jwt.decode(
    token,
    key=secret,
    algorithms=["HS256"],          # required — pins the algorithm
    audience="my-api",
    issuer="my-issuer",
    options={"require": ["exp", "iat"]},
)
# Raises on bad signature / expiry.
# NEVER pass options={"verify_signature": False} in production.`,
          },
          {
            lang: 'C#',
            code: `using System;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Text;

var handler = new JwtSecurityTokenHandler();
var parameters = new TokenValidationParameters
{
    ValidateIssuerSigningKey = true,
    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
    ValidAlgorithms = new[] { SecurityAlgorithms.HmacSha256 }, // pin the alg
    ValidateIssuer = true,   ValidIssuer = "my-issuer",
    ValidateAudience = true, ValidAudience = "my-api",
    ValidateLifetime = true, // checks exp / nbf
    ClockSkew = TimeSpan.FromSeconds(30),
};
// Throws SecurityTokenException on any failure:
var principal = handler.ValidateToken(token, parameters, out _);`,
          },
        ],
      },
      {
        id: 'password-hash',
        title: 'Hash & verify passwords',
        pitfall:
          'Hashing passwords with SHA-256/MD5 — they are far too fast. Use a slow, salted KDF (bcrypt / scrypt / argon2).',
        langs: [
          {
            lang: 'Go',
            code: `import "golang.org/x/crypto/bcrypt"

// Hash (cost 12+). bcrypt generates and stores a per-password salt.
hash, err := bcrypt.GenerateFromPassword([]byte(pw), 12)

// Verify (constant-time comparison happens inside):
err = bcrypt.CompareHashAndPassword(hash, []byte(pw))
ok := err == nil`,
          },
          {
            lang: 'TypeScript',
            code: `import bcrypt from "bcrypt";

const hash = await bcrypt.hash(pw, 12); // cost factor 12+
const ok = await bcrypt.compare(pw, hash);`,
          },
          {
            lang: 'Python',
            code: `from argon2 import PasswordHasher  # argon2-cffi

ph = PasswordHasher()
hash = ph.hash(pw)  # salt is generated and embedded automatically

try:
    ph.verify(hash, pw)
    ok = True
except Exception:
    ok = False`,
          },
          {
            lang: 'C#',
            code: `// BCrypt.Net-Next (NuGet). Salt is generated and embedded in the hash.
using BCrypt.Net;

string hash = BCrypt.HashPassword(pw, workFactor: 12);
bool ok = BCrypt.Verify(pw, hash);

// Built-in alternative: ASP.NET Core Identity's PasswordHasher<T> (PBKDF2).`,
          },
        ],
      },
      {
        id: 'hmac-verify',
        title: 'Verify an HMAC signature',
        pitfall:
          'Comparing signatures with == / bytes.Equal leaks timing. Use a constant-time compare.',
        langs: [
          {
            lang: 'Go',
            code: `import (
    "crypto/hmac"
    "crypto/sha256"
)

mac := hmac.New(sha256.New, []byte(secret))
mac.Write(payload)
expected := mac.Sum(nil)

// Constant-time — NOT bytes.Equal or == on the hex string.
ok := hmac.Equal(expected, received)`,
          },
          {
            lang: 'TypeScript',
            code: `import { createHmac, timingSafeEqual } from "crypto";

const expected = createHmac("sha256", secret).update(payload).digest();
const received = Buffer.from(sigHex, "hex");

// Length check first — timingSafeEqual throws on length mismatch.
const ok =
  expected.length === received.length &&
  timingSafeEqual(expected, received);`,
          },
          {
            lang: 'Python',
            code: `import hmac, hashlib

expected = hmac.new(secret, payload, hashlib.sha256).digest()

# Constant-time comparison:
ok = hmac.compare_digest(expected, received)`,
          },
          {
            lang: 'C#',
            code: `using System.Security.Cryptography;
using System.Text;

using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
byte[] expected = hmac.ComputeHash(payload);

// Constant-time comparison:
bool ok = CryptographicOperations.FixedTimeEquals(expected, received);`,
          },
        ],
      },
      {
        id: 'secure-token',
        title: 'Generate a secure random token',
        pitfall:
          'math/rand · Math.random() · random.random() are NOT cryptographically secure — never use them for tokens, IDs, or secrets.',
        langs: [
          {
            lang: 'Go',
            code: `import (
    "crypto/rand"          // NOT math/rand
    "encoding/base64"
)

b := make([]byte, 32)
if _, err := rand.Read(b); err != nil { /* handle */ }
token := base64.RawURLEncoding.EncodeToString(b)`,
          },
          {
            lang: 'TypeScript',
            code: `import { randomBytes } from "crypto";
const token = randomBytes(32).toString("base64url");

// In the browser:
const buf = new Uint8Array(32);
crypto.getRandomValues(buf); // not Math.random()`,
          },
          {
            lang: 'Python',
            code: `import secrets

token = secrets.token_urlsafe(32)  # not random.random()`,
          },
          {
            lang: 'C#',
            code: `using System;
using System.Security.Cryptography;

byte[] b = RandomNumberGenerator.GetBytes(32); // CSPRNG, not System.Random
string token = Convert.ToBase64String(b)
    .Replace('+', '-').Replace('/', '_').TrimEnd('=');`,
          },
        ],
      },
    ],
  },
  {
    id: 'encoding',
    name: 'Encoding',
    recipes: [
      {
        id: 'base64url',
        title: 'Base64url encode / decode',
        pitfall:
          'Standard base64 uses + / and = padding, which break in URLs and JWTs. Those use base64url (- _) with no padding.',
        langs: [
          {
            lang: 'Go',
            code: `import "encoding/base64"

// URL-safe, no padding (as used in JWTs):
enc := base64.RawURLEncoding.EncodeToString(data)
dec, err := base64.RawURLEncoding.DecodeString(enc)`,
          },
          {
            lang: 'TypeScript',
            code: `// Node 16+:
const enc = Buffer.from(data).toString("base64url");
const dec = Buffer.from(enc, "base64url");

// Browser (standard -> url-safe):
const b64url = btoa(str)
  .replace(/\\+/g, "-")
  .replace(/\\//g, "_")
  .replace(/=+$/, "");`,
          },
          {
            lang: 'Python',
            code: `import base64

# Encode, stripping padding:
enc = base64.urlsafe_b64encode(data).rstrip(b"=")

# Decode — re-pad to a multiple of 4 first:
pad = b"=" * (-len(enc) % 4)
dec = base64.urlsafe_b64decode(enc + pad)`,
          },
          {
            lang: 'C#',
            code: `using System;

// Encode url-safe, no padding:
string enc = Convert.ToBase64String(data)
    .Replace('+', '-').Replace('/', '_').TrimEnd('=');

// Decode — restore chars and padding:
string s = enc.Replace('-', '+').Replace('_', '/');
s += (s.Length % 4) switch { 2 => "==", 3 => "=", _ => "" };
byte[] dec = Convert.FromBase64String(s);

// .NET 9+: use System.Buffers.Text.Base64Url directly.`,
          },
        ],
      },
    ],
  },
  {
    id: 'data',
    name: 'Data & Reliability',
    recipes: [
      {
        id: 'sql-param',
        title: 'Parameterized SQL query',
        pitfall:
          'Building SQL with string concatenation / format = SQL injection. Always use placeholders and let the driver bind values.',
        langs: [
          {
            lang: 'Go',
            code: `// Placeholders — the driver escapes values. NEVER fmt.Sprintf into SQL.
row := db.QueryRow(
    "SELECT id, email FROM users WHERE email = $1",
    email,
)

// GORM:
db.Where("email = ?", email).First(&user)`,
          },
          {
            lang: 'TypeScript',
            code: `// node-postgres — values go in the params array, never in the string.
const { rows } = await pool.query(
  "SELECT id, email FROM users WHERE email = $1",
  [email],
);`,
          },
          {
            lang: 'Python',
            code: `# psycopg — pass params as the 2nd arg; do NOT %-format / f-string them in.
cur.execute(
    "SELECT id, email FROM users WHERE email = %s",
    (email,),
)`,
          },
          {
            lang: 'C#',
            code: `using Microsoft.Data.SqlClient;

// Parameterized — never string-concatenate values into SQL.
using var cmd = new SqlCommand(
    "SELECT id, email FROM users WHERE email = @email", conn);
cmd.Parameters.AddWithValue("@email", email);

// Dapper:
var user = conn.QueryFirstOrDefault<User>(
    "SELECT id, email FROM users WHERE email = @email", new { email });`,
          },
        ],
      },
      {
        id: 'retry-backoff',
        title: 'Retry with exponential backoff + jitter',
        pitfall:
          'Fixed-interval retries stampede a struggling server. Use exponential backoff with jitter, cap the delay, and bound total attempts.',
        langs: [
          {
            lang: 'Go',
            code: `import (
    "context"
    "errors"
    "math"
    "math/rand"
    "time"
)

func withBackoff(ctx context.Context, fn func() error) error {
    base, max := 200*time.Millisecond, 10*time.Second
    for attempt := 0; attempt < 6; attempt++ {
        if err := fn(); err == nil {
            return nil
        }
        d := time.Duration(float64(base) * math.Pow(2, float64(attempt)))
        if d > max {
            d = max
        }
        d = time.Duration(rand.Int63n(int64(d))) // full jitter (ok for jitter)
        select {
        case <-time.After(d):
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return errors.New("retries exhausted")
}`,
          },
          {
            lang: 'TypeScript',
            code: `async function withBackoff<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  const base = 200, max = 10_000;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1) throw e;
    }
    const cap = Math.min(max, base * 2 ** i);
    const delay = Math.random() * cap; // full jitter
    await new Promise((r) => setTimeout(r, delay));
  }
}`,
          },
          {
            lang: 'Python',
            code: `import random, time

def with_backoff(fn, tries=6, base=0.2, cap=10.0):
    for i in range(tries):
        try:
            return fn()
        except Exception:
            if i == tries - 1:
                raise
            # full jitter:
            time.sleep(random.uniform(0, min(cap, base * 2 ** i)))`,
          },
          {
            lang: 'C#',
            code: `using System;
using System.Threading;
using System.Threading.Tasks;

async Task<T> WithBackoffAsync<T>(Func<Task<T>> fn, int tries = 6,
                                  CancellationToken ct = default)
{
    for (int i = 0; ; i++)
    {
        try { return await fn(); }
        catch when (i < tries - 1) { }
        int cap = (int)Math.Min(10_000, 200 * Math.Pow(2, i));
        await Task.Delay(Random.Shared.Next(cap), ct); // full jitter
    }
}
// In production, prefer Polly's WaitAndRetry with jitter.`,
          },
        ],
      },
    ],
  },
];
