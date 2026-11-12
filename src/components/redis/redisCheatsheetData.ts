// Redis cheatsheet content for the in-panel Cookbook.
// Descriptions and examples are authored for this tool; the command syntax is
// factual reference. Click-to-insert drops `example` into the command console.

export interface CheatEntry {
  cmd: string;
  syntax: string;
  desc: string;
  example: string;
  write?: boolean; // needs a write grant + "Writes enabled"
  danger?: boolean; // discouraged / blocked in this tool
}

export interface CheatGroup {
  id: string;
  label: string;
  entries: CheatEntry[];
}

// Short "how to use Redis-specific functions" primer shown at the top.
export const REDIS_TIPS: { title: string; body: string }[] = [
  {
    title: 'Pick the right data type',
    body: 'Model your data by shape: string for a single value/counter, hash for an object of fields, list for a queue/log, set for unique membership, sorted set for ranked/leaderboard data, stream for an append-only event log.',
  },
  {
    title: 'Browse with SCAN, never KEYS',
    body: 'KEYS scans the whole keyspace and blocks the server — it is blocked in this tool. Use SCAN with a MATCH pattern (the key browser already does). The same applies to whole-collection reads: prefer HSCAN / SSCAN / ZSCAN over HGETALL / SMEMBERS on large keys.',
  },
  {
    title: 'Expire caches and sessions',
    body: 'Give cache/session keys a TTL so they clean themselves up: SET ... EX <seconds>, or EXPIRE on an existing key. TTL / PTTL tell you the remaining lifetime; PERSIST removes it.',
  },
  {
    title: 'Counters are atomic',
    body: 'INCR / INCRBY / HINCRBY change and return the new value in one atomic step — no read-modify-write race. Great for rate limits, view counts, and IDs.',
  },
  {
    title: 'Read-only by default',
    body: 'This console runs read commands freely. Write commands need a write grant on the connection AND the "Writes enabled" switch. Dangerous commands (FLUSHALL, KEYS, CONFIG, EVAL, …) are always blocked.',
  },
];

export const REDIS_CHEATSHEET: CheatGroup[] = [
  {
    id: 'keys',
    label: 'Keys & TTL',
    entries: [
      { cmd: 'SCAN', syntax: 'SCAN cursor [MATCH pattern] [COUNT n] [TYPE type]', desc: 'Cursor-paginated keyspace walk (start at 0). Safe replacement for KEYS.', example: 'SCAN 0 MATCH user:* COUNT 100' },
      { cmd: 'EXISTS', syntax: 'EXISTS key [key ...]', desc: 'How many of the given keys exist.', example: 'EXISTS user:1 user:2' },
      { cmd: 'TYPE', syntax: 'TYPE key', desc: 'Data type of a key (string/hash/list/set/zset/stream).', example: 'TYPE user:1' },
      { cmd: 'TTL', syntax: 'TTL key', desc: 'Seconds left before a key expires (-1 no expiry, -2 missing).', example: 'TTL session:abc' },
      { cmd: 'EXPIRE', syntax: 'EXPIRE key seconds', desc: 'Set a key to expire after N seconds.', example: 'EXPIRE session:abc 3600', write: true },
      { cmd: 'PERSIST', syntax: 'PERSIST key', desc: 'Remove a key’s expiry so it lives forever.', example: 'PERSIST session:abc', write: true },
      { cmd: 'DEL', syntax: 'DEL key [key ...]', desc: 'Delete keys (blocking). Prefer UNLINK for large keys.', example: 'DEL temp:1', write: true },
      { cmd: 'UNLINK', syntax: 'UNLINK key [key ...]', desc: 'Delete keys, reclaiming memory in the background.', example: 'UNLINK cache:page:1', write: true },
      { cmd: 'RENAME', syntax: 'RENAME key newkey', desc: 'Rename a key (overwrites newkey if present).', example: 'RENAME draft:1 post:1', write: true },
      { cmd: 'KEYS', syntax: 'KEYS pattern', desc: 'Blocked here — blocks the server on big keyspaces. Use SCAN.', example: 'SCAN 0 MATCH * COUNT 100', danger: true },
    ],
  },
  {
    id: 'string',
    label: 'Strings & counters',
    entries: [
      { cmd: 'GET', syntax: 'GET key', desc: 'Read a string value.', example: 'GET greeting' },
      { cmd: 'SET', syntax: 'SET key value [EX seconds] [NX|XX] [KEEPTTL]', desc: 'Write a string; EX adds a TTL, NX only if absent.', example: 'SET user:1:name "Kenan" EX 3600', write: true },
      { cmd: 'SETEX', syntax: 'SETEX key seconds value', desc: 'Set a value with a TTL in one call.', example: 'SETEX otp:1 120 "482913"', write: true },
      { cmd: 'MGET', syntax: 'MGET key [key ...]', desc: 'Read many string keys at once.', example: 'MGET greeting counter' },
      { cmd: 'INCR', syntax: 'INCR key', desc: 'Atomically add 1 and return the new value.', example: 'INCR page:views', write: true },
      { cmd: 'INCRBY', syntax: 'INCRBY key increment', desc: 'Atomically add an integer.', example: 'INCRBY wallet:1 50', write: true },
      { cmd: 'APPEND', syntax: 'APPEND key value', desc: 'Append to a string, return new length.', example: 'APPEND log:1 " done"', write: true },
      { cmd: 'GETDEL', syntax: 'GETDEL key', desc: 'Read a value and delete it atomically.', example: 'GETDEL otp:1', write: true },
    ],
  },
  {
    id: 'hash',
    label: 'Hashes (objects)',
    entries: [
      { cmd: 'HSET', syntax: 'HSET key field value [field value ...]', desc: 'Set one or more fields of a hash.', example: 'HSET user:1 name Kenan role admin', write: true },
      { cmd: 'HGET', syntax: 'HGET key field', desc: 'Read a single field.', example: 'HGET user:1 name' },
      { cmd: 'HGETALL', syntax: 'HGETALL key', desc: 'Read every field/value (avoid on huge hashes → HSCAN).', example: 'HGETALL user:1' },
      { cmd: 'HDEL', syntax: 'HDEL key field [field ...]', desc: 'Remove fields from a hash.', example: 'HDEL user:1 role', write: true },
      { cmd: 'HINCRBY', syntax: 'HINCRBY key field increment', desc: 'Atomically add to a numeric field.', example: 'HINCRBY user:1 logins 1', write: true },
      { cmd: 'HSCAN', syntax: 'HSCAN key cursor [MATCH pattern] [COUNT n]', desc: 'Cursor-paginate a large hash’s fields.', example: 'HSCAN user:1 0 COUNT 50' },
    ],
  },
  {
    id: 'list',
    label: 'Lists (queues/logs)',
    entries: [
      { cmd: 'RPUSH', syntax: 'RPUSH key value [value ...]', desc: 'Append to the tail (enqueue).', example: 'RPUSH queue:jobs job1 job2', write: true },
      { cmd: 'LPUSH', syntax: 'LPUSH key value [value ...]', desc: 'Prepend to the head.', example: 'LPUSH recent:1 view-a', write: true },
      { cmd: 'LRANGE', syntax: 'LRANGE key start stop', desc: 'Read a range (0 -1 = all; avoid on huge lists).', example: 'LRANGE queue:jobs 0 9' },
      { cmd: 'LPOP', syntax: 'LPOP key [count]', desc: 'Remove and return from the head (dequeue).', example: 'LPOP queue:jobs', write: true },
      { cmd: 'RPOP', syntax: 'RPOP key [count]', desc: 'Remove and return from the tail.', example: 'RPOP queue:jobs', write: true },
      { cmd: 'LLEN', syntax: 'LLEN key', desc: 'Number of elements in a list.', example: 'LLEN queue:jobs' },
    ],
  },
  {
    id: 'set',
    label: 'Sets (membership)',
    entries: [
      { cmd: 'SADD', syntax: 'SADD key member [member ...]', desc: 'Add unique members.', example: 'SADD tags:post:1 redis go', write: true },
      { cmd: 'SMEMBERS', syntax: 'SMEMBERS key', desc: 'All members (avoid on huge sets → SSCAN).', example: 'SMEMBERS tags:post:1' },
      { cmd: 'SISMEMBER', syntax: 'SISMEMBER key member', desc: 'Is a value in the set? (1/0)', example: 'SISMEMBER tags:post:1 redis' },
      { cmd: 'SREM', syntax: 'SREM key member [member ...]', desc: 'Remove members.', example: 'SREM tags:post:1 go', write: true },
      { cmd: 'SCARD', syntax: 'SCARD key', desc: 'Number of members.', example: 'SCARD tags:post:1' },
      { cmd: 'SSCAN', syntax: 'SSCAN key cursor [MATCH pattern] [COUNT n]', desc: 'Cursor-paginate a large set.', example: 'SSCAN tags:post:1 0 COUNT 50' },
    ],
  },
  {
    id: 'zset',
    label: 'Sorted sets (rankings)',
    entries: [
      { cmd: 'ZADD', syntax: 'ZADD key score member [score member ...]', desc: 'Add/update members with a score.', example: 'ZADD leaderboard 120 carol 100 alice', write: true },
      { cmd: 'ZRANGE', syntax: 'ZRANGE key start stop [WITHSCORES] [REV]', desc: 'Members by rank; REV for high-to-low.', example: 'ZRANGE leaderboard 0 9 REV WITHSCORES' },
      { cmd: 'ZRANGEBYSCORE', syntax: 'ZRANGEBYSCORE key min max', desc: 'Members within a score range.', example: 'ZRANGEBYSCORE leaderboard 100 200' },
      { cmd: 'ZSCORE', syntax: 'ZSCORE key member', desc: 'A member’s score.', example: 'ZSCORE leaderboard carol' },
      { cmd: 'ZINCRBY', syntax: 'ZINCRBY key increment member', desc: 'Atomically bump a member’s score.', example: 'ZINCRBY leaderboard 5 alice', write: true },
      { cmd: 'ZRANK', syntax: 'ZRANK key member [WITHSCORE]', desc: 'Rank (position) of a member.', example: 'ZRANK leaderboard carol' },
    ],
  },
  {
    id: 'stream',
    label: 'Streams (event logs)',
    entries: [
      { cmd: 'XADD', syntax: 'XADD key * field value [field value ...]', desc: 'Append an entry (* = auto id).', example: 'XADD events:orders * type created orderId 1001', write: true },
      { cmd: 'XRANGE', syntax: 'XRANGE key start end [COUNT n]', desc: 'Read entries by id range (- + = all).', example: 'XRANGE events:orders - + COUNT 20' },
      { cmd: 'XLEN', syntax: 'XLEN key', desc: 'Number of entries in the stream.', example: 'XLEN events:orders' },
      { cmd: 'XINFO', syntax: 'XINFO STREAM key', desc: 'Metadata: length, first/last id, groups.', example: 'XINFO STREAM events:orders' },
    ],
  },
  {
    id: 'pubsub',
    label: 'Pub/Sub',
    entries: [
      { cmd: 'PUBLISH', syntax: 'PUBLISH channel message', desc: 'Send a message to a channel (fire-and-forget).', example: 'PUBLISH notifications "hello"', write: true },
      { cmd: 'SUBSCRIBE', syntax: 'SUBSCRIBE channel [channel ...]', desc: 'Use the read-only Pub/Sub peek mode above instead — it subscribes with a deadline, no commit.', example: 'SUBSCRIBE notifications', danger: true },
    ],
  },
  {
    id: 'server',
    label: 'Server & inspect',
    entries: [
      { cmd: 'PING', syntax: 'PING [message]', desc: 'Liveness check.', example: 'PING' },
      { cmd: 'DBSIZE', syntax: 'DBSIZE', desc: 'Number of keys in the current DB.', example: 'DBSIZE' },
      { cmd: 'INFO', syntax: 'INFO [section]', desc: 'Server stats (memory, clients, keyspace, …).', example: 'INFO keyspace' },
      { cmd: 'MEMORY USAGE', syntax: 'MEMORY USAGE key [SAMPLES n]', desc: 'Approx bytes a key uses (SAMPLES 0 = exact).', example: 'MEMORY USAGE user:1 SAMPLES 0' },
      { cmd: 'OBJECT ENCODING', syntax: 'OBJECT ENCODING key', desc: 'Internal encoding (ziplist/listpack/hashtable/…).', example: 'OBJECT ENCODING user:1' },
    ],
  },
];
