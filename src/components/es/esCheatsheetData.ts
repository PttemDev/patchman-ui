// Elasticsearch / Kibana-console cheatsheet for the in-panel cookbook.
// Descriptions and examples are authored for this tool (not copied from the
// Elastic docs); the endpoint + DSL shapes are factual reference. Click-to-
// insert drops `example` — a full `METHOD path` + JSON body — into the console.

export interface ESCheatEntry {
  /** Short label shown in the row, e.g. "match" or "_cat/indices". */
  cmd: string;
  /** One-line signature summary for the tooltip. */
  syntax: string;
  /** Original plain-language description. */
  desc: string;
  /** Full request inserted into the editor on click. */
  example: string;
  /** Needs a write grant + "Writes enabled" on the connection. */
  write?: boolean;
}

export interface ESCheatGroup {
  id: string;
  label: string;
  entries: ESCheatEntry[];
}

export const ES_TIPS: { title: string; body: string }[] = [
  {
    title: 'One request per block',
    body: 'Each request is a METHOD path line followed by an optional JSON body. Separate several requests with a blank line. Cmd/Ctrl+Enter runs the one under the cursor; "Run all" fires them top to bottom.',
  },
  {
    title: 'Target an index in the path',
    body: 'Put the index (or alias, or comma list, or wildcard) before the endpoint: GET orders-*/_search. Field autocomplete in the body reads that index’s mapping once you’ve opened it in the index browser.',
  },
  {
    title: 'Query vs filter context',
    body: 'Clauses under must / should score and rank hits; clauses under filter only include/exclude and are cacheable. Reach for filter on exact terms, ranges and dates where relevance scoring adds nothing.',
  },
  {
    title: 'Read-only by default',
    body: 'Searches and _cat / _mapping / _stats calls run freely. Anything that mutates (PUT, DELETE, _bulk, _update_by_query…) needs a write grant plus the "Writes enabled" switch, and is re-checked on the backend.',
  },
];

export const ES_CHEATSHEET: ESCheatGroup[] = [
  {
    id: 'search',
    label: 'Search basics',
    entries: [
      {
        cmd: 'match_all',
        syntax: 'GET <index>/_search { query: { match_all: {} } }',
        desc: 'Return every document, most recent first when you add a sort.',
        example: 'GET my-index/_search\n{\n  "size": 20,\n  "query": { "match_all": {} }\n}',
      },
      {
        cmd: 'match',
        syntax: 'match: { <field>: <text> }',
        desc: 'Full-text match on an analyzed field — tokenized, order-independent.',
        example: 'GET my-index/_search\n{\n  "query": {\n    "match": { "title": "hello world" }\n  }\n}',
      },
      {
        cmd: 'term',
        syntax: 'term: { <field>: <exact> }',
        desc: 'Exact, un-analyzed match — use on keyword / numeric / boolean fields.',
        example: 'GET my-index/_search\n{\n  "query": {\n    "term": { "status.keyword": "active" }\n  }\n}',
      },
      {
        cmd: 'multi_match',
        syntax: 'multi_match: { query, fields: [...] }',
        desc: 'Run one text query across several fields at once.',
        example: 'GET my-index/_search\n{\n  "query": {\n    "multi_match": {\n      "query": "acme",\n      "fields": ["name", "description"]\n    }\n  }\n}',
      },
      {
        cmd: '_count',
        syntax: 'GET <index>/_count { query }',
        desc: 'Count matching documents without returning any hits.',
        example: 'GET my-index/_count\n{\n  "query": { "match_all": {} }\n}',
      },
    ],
  },
  {
    id: 'bool',
    label: 'Bool & filters',
    entries: [
      {
        cmd: 'bool must',
        syntax: 'bool: { must: [ ... ] }',
        desc: 'All clauses must match; each contributes to the relevance score.',
        example: 'GET my-index/_search\n{\n  "query": {\n    "bool": {\n      "must": [\n        { "match": { "title": "laptop" } },\n        { "match": { "brand": "acme" } }\n      ]\n    }\n  }\n}',
      },
      {
        cmd: 'bool filter',
        syntax: 'bool: { filter: [ ... ] }',
        desc: 'Include/exclude without scoring — fast and cacheable. Best for exact terms.',
        example: 'GET my-index/_search\n{\n  "query": {\n    "bool": {\n      "filter": [\n        { "term": { "status.keyword": "active" } }\n      ]\n    }\n  }\n}',
      },
      {
        cmd: 'bool should',
        syntax: 'bool: { should: [ ... ], minimum_should_match }',
        desc: 'Optional clauses that boost score; require N with minimum_should_match.',
        example: 'GET my-index/_search\n{\n  "query": {\n    "bool": {\n      "should": [\n        { "match": { "tags": "sale" } },\n        { "match": { "tags": "new" } }\n      ],\n      "minimum_should_match": 1\n    }\n  }\n}',
      },
      {
        cmd: 'bool must_not',
        syntax: 'bool: { must_not: [ ... ] }',
        desc: 'Exclude documents that match the listed clauses.',
        example: 'GET my-index/_search\n{\n  "query": {\n    "bool": {\n      "must_not": [\n        { "term": { "archived": true } }\n      ]\n    }\n  }\n}',
      },
    ],
  },
  {
    id: 'range',
    label: 'Ranges & existence',
    entries: [
      {
        cmd: 'range',
        syntax: 'range: { <field>: { gte, lte } }',
        desc: 'Match numbers or dates within a window (gte/gt/lte/lt).',
        example: 'GET my-index/_search\n{\n  "query": {\n    "range": {\n      "price": { "gte": 10, "lte": 100 }\n    }\n  }\n}',
      },
      {
        cmd: 'range (date)',
        syntax: 'range: { <date>: { gte: "now-7d/d" } }',
        desc: 'Relative date math — the last 7 days rounded to the day.',
        example: 'GET my-index/_search\n{\n  "query": {\n    "range": {\n      "created_at": { "gte": "now-7d/d", "lte": "now" }\n    }\n  }\n}',
      },
      {
        cmd: 'exists',
        syntax: 'exists: { field: <field> }',
        desc: 'Match documents that have a non-null value for the field.',
        example: 'GET my-index/_search\n{\n  "query": {\n    "exists": { "field": "email" }\n  }\n}',
      },
    ],
  },
  {
    id: 'aggs',
    label: 'Aggregations',
    entries: [
      {
        cmd: 'terms',
        syntax: 'aggs: { <name>: { terms: { field } } }',
        desc: 'Bucket documents by the distinct values of a keyword field.',
        example: 'GET my-index/_search\n{\n  "size": 0,\n  "aggs": {\n    "by_status": {\n      "terms": { "field": "status.keyword", "size": 10 }\n    }\n  }\n}',
      },
      {
        cmd: 'date_histogram',
        syntax: 'aggs: { <name>: { date_histogram: { field, calendar_interval } } }',
        desc: 'Bucket documents into fixed time intervals for a timeline.',
        example: 'GET my-index/_search\n{\n  "size": 0,\n  "aggs": {\n    "over_time": {\n      "date_histogram": {\n        "field": "created_at",\n        "calendar_interval": "day"\n      }\n    }\n  }\n}',
      },
      {
        cmd: 'metric (avg)',
        syntax: 'aggs: { <name>: { avg: { field } } }',
        desc: 'Compute a single metric — avg / sum / min / max / cardinality.',
        example: 'GET my-index/_search\n{\n  "size": 0,\n  "aggs": {\n    "avg_price": { "avg": { "field": "price" } }\n  }\n}',
      },
      {
        cmd: 'nested aggs',
        syntax: 'terms + sub-aggregation',
        desc: 'Roll a metric up inside each bucket — e.g. avg price per status.',
        example: 'GET my-index/_search\n{\n  "size": 0,\n  "aggs": {\n    "by_status": {\n      "terms": { "field": "status.keyword" },\n      "aggs": {\n        "avg_price": { "avg": { "field": "price" } }\n      }\n    }\n  }\n}',
      },
    ],
  },
  {
    id: 'shape',
    label: 'Sort & source',
    entries: [
      {
        cmd: 'sort',
        syntax: 'sort: [ { <field>: "asc"|"desc" } ]',
        desc: 'Order hits by a field instead of relevance score.',
        example: 'GET my-index/_search\n{\n  "sort": [ { "created_at": "desc" } ],\n  "query": { "match_all": {} }\n}',
      },
      {
        cmd: '_source',
        syntax: '_source: [ ... ]  or  { includes, excludes }',
        desc: 'Return only the fields you need to shrink the response.',
        example: 'GET my-index/_search\n{\n  "_source": ["id", "name", "price"],\n  "query": { "match_all": {} }\n}',
      },
      {
        cmd: 'paging',
        syntax: 'from + size',
        desc: 'Classic offset paging — from skips, size limits (cap ~10k).',
        example: 'GET my-index/_search\n{\n  "from": 0,\n  "size": 50,\n  "query": { "match_all": {} }\n}',
      },
    ],
  },
  {
    id: 'ops',
    label: 'Cat, mapping & analyze',
    entries: [
      {
        cmd: '_cat/indices',
        syntax: 'GET /_cat/indices?v',
        desc: 'One-line-per-index overview: health, docs, store size.',
        example: 'GET /_cat/indices?v',
      },
      {
        cmd: '_cat/health',
        syntax: 'GET /_cat/health?v',
        desc: 'Cluster health at a glance — status, node + shard counts.',
        example: 'GET /_cat/health?v',
      },
      {
        cmd: '_mapping',
        syntax: 'GET <index>/_mapping',
        desc: 'Inspect the field types the index actually stores.',
        example: 'GET my-index/_mapping',
      },
      {
        cmd: '_settings',
        syntax: 'GET <index>/_settings',
        desc: 'Read an index’s shard / replica / analysis settings.',
        example: 'GET my-index/_settings',
      },
      {
        cmd: '_analyze',
        syntax: 'POST <index>/_analyze { analyzer, text }',
        desc: 'See how an analyzer tokenizes text — debug why a match misses.',
        example: 'POST my-index/_analyze\n{\n  "analyzer": "standard",\n  "text": "The Quick Brown Fox"\n}',
      },
      {
        cmd: '_validate/query',
        syntax: 'POST <index>/_validate/query?explain=true { query }',
        desc: 'Check a query is well-formed and see how it rewrites — no hits returned.',
        example: 'POST my-index/_validate/query?explain=true\n{\n  "query": {\n    "match": { "title": "hello" }\n  }\n}',
      },
    ],
  },
];
