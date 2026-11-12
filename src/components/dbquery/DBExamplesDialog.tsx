import { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Search, Copy, Wand2, BookOpen } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DBKind } from '@/types';

interface DBExamplesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Used to default the active tab + the "Use this" insert target. */
  kind?: DBKind;
  /** Insert the chosen snippet into the editor and close the modal. */
  onInsert: (text: string) => void;
}

type Family = 'sql' | 'mongo';

interface Example {
  /** i18n key suffix — title/desc live at examples.<family>.<section>.<key>.* */
  key: string;
  /** Searchable tags for the filter input */
  tags: string[];
  /** Raw query body — pasted into the editor as-is */
  code: string;
}

interface Section {
  /** i18n key suffix — title lives at examples.<family>.<key>.title */
  key: string;
  items: Example[];
}

const SQL_SECTIONS: Section[] = [
  {
    key: 'basics',
    items: [
      {
        key: 'listRows',
        tags: ['select', 'basic'],
        code: `SELECT * FROM "users" LIMIT 25;`,
      },
      {
        key: 'countRows',
        tags: ['count', 'aggregate'],
        code: `SELECT COUNT(*) FROM "users";`,
      },
      {
        key: 'pickColumns',
        tags: ['select', 'project'],
        code: `SELECT id, email, created_at\nFROM "users"\nORDER BY created_at DESC\nLIMIT 50;`,
      },
      {
        key: 'distinctValues',
        tags: ['distinct'],
        code: `SELECT DISTINCT status FROM "orders";`,
      },
    ],
  },
  {
    key: 'filtering',
    items: [
      {
        key: 'equalityIn',
        tags: ['where', 'in'],
        code: `SELECT *\nFROM "orders"\nWHERE status IN ('paid','pending')\n  AND currency = 'USD'\nLIMIT 50;`,
      },
      {
        key: 'patternMatch',
        tags: ['like', 'ilike', 'search'],
        code: `SELECT id, email\nFROM "users"\nWHERE email ILIKE '%@example.com'\nLIMIT 50;`,
      },
      {
        key: 'dateRange',
        tags: ['date', 'range'],
        code: `SELECT *\nFROM "orders"\nWHERE placed_at >= '2025-01-01'\n  AND placed_at <  '2025-02-01'\nORDER BY placed_at DESC\nLIMIT 100;`,
      },
      {
        key: 'nullHandling',
        tags: ['null'],
        code: `SELECT *\nFROM "users"\nWHERE deleted_at IS NULL\nLIMIT 50;`,
      },
    ],
  },
  {
    key: 'aggregation',
    items: [
      {
        key: 'groupByCount',
        tags: ['group by', 'count'],
        code: `SELECT status, COUNT(*) AS n\nFROM "orders"\nGROUP BY status\nORDER BY n DESC;`,
      },
      {
        key: 'sumAvg',
        tags: ['sum', 'avg', 'aggregate'],
        code: `SELECT customer_id,\n       SUM(total) AS revenue,\n       AVG(total) AS avg_basket\nFROM "orders"\nWHERE status = 'paid'\nGROUP BY customer_id\nHAVING SUM(total) > 100\nORDER BY revenue DESC\nLIMIT 25;`,
      },
      {
        key: 'dailySeries',
        tags: ['date_trunc', 'timeseries'],
        code: `SELECT date_trunc('day', placed_at) AS day,\n       COUNT(*)                AS orders,\n       SUM(total)              AS revenue\nFROM "orders"\nWHERE placed_at >= NOW() - INTERVAL '30 days'\nGROUP BY 1\nORDER BY 1;`,
      },
    ],
  },
  {
    key: 'joins',
    items: [
      {
        key: 'innerJoin',
        tags: ['join'],
        code: `SELECT o.id, o.total, u.email\nFROM "orders" o\nJOIN "users" u ON u.id = o.user_id\nWHERE o.status = 'paid'\nORDER BY o.placed_at DESC\nLIMIT 50;`,
      },
      {
        key: 'leftJoin',
        tags: ['left join'],
        code: `SELECT u.id, u.email, COUNT(o.id) AS paid_orders\nFROM "users" u\nLEFT JOIN "orders" o\n  ON o.user_id = u.id\n AND o.status  = 'paid'\nGROUP BY u.id, u.email\nORDER BY paid_orders DESC\nLIMIT 25;`,
      },
      {
        key: 'selfJoin',
        tags: ['join', 'self'],
        code: `SELECT m.name AS manager, e.name AS report\nFROM "employees" e\nJOIN "employees" m ON e.manager_id = m.id\nORDER BY m.name, e.name;`,
      },
    ],
  },
  {
    key: 'windows',
    items: [
      {
        key: 'cte',
        tags: ['cte', 'with'],
        code: `WITH paid AS (\n  SELECT user_id, SUM(total) AS revenue\n  FROM "orders"\n  WHERE status = 'paid'\n  GROUP BY user_id\n)\nSELECT u.email, paid.revenue\nFROM paid\nJOIN "users" u ON u.id = paid.user_id\nORDER BY paid.revenue DESC\nLIMIT 20;`,
      },
      {
        key: 'rowNumber',
        tags: ['window', 'row_number'],
        code: `SELECT *\nFROM (\n  SELECT o.*,\n         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY placed_at) AS rn\n  FROM "orders" o\n) t\nWHERE t.rn = 1;`,
      },
      {
        key: 'cumulativeSum',
        tags: ['window', 'running'],
        code: `SELECT day,\n       revenue,\n       SUM(revenue) OVER (ORDER BY day) AS cumulative\nFROM (\n  SELECT date_trunc('day', placed_at) AS day, SUM(total) AS revenue\n  FROM "orders"\n  WHERE status = 'paid'\n  GROUP BY 1\n) t\nORDER BY day;`,
      },
    ],
  },
  {
    key: 'jsonColumns',
    items: [
      {
        key: 'extractField',
        tags: ['json', 'jsonb'],
        code: `SELECT id,\n       metadata ->> 'campaign' AS campaign,\n       (metadata ->> 'spend')::numeric AS spend\nFROM "events"\nWHERE metadata ? 'campaign'\nLIMIT 50;`,
      },
      {
        key: 'filterJson',
        tags: ['json'],
        code: `SELECT *\nFROM "users"\nWHERE settings -> 'flags' ->> 'beta' = 'true'\nLIMIT 50;`,
      },
    ],
  },
  {
    key: 'inspection',
    items: [
      {
        key: 'explainAnalyze',
        tags: ['explain', 'perf'],
        code: `EXPLAIN (FORMAT JSON, ANALYZE)\nSELECT *\nFROM "orders"\nWHERE status = 'paid'\n  AND placed_at >= NOW() - INTERVAL '7 days';`,
      },
      {
        key: 'listColumns',
        tags: ['schema', 'introspect'],
        code: `SELECT column_name, data_type, is_nullable\nFROM information_schema.columns\nWHERE table_schema = 'public'\n  AND table_name   = 'users'\nORDER BY ordinal_position;`,
      },
      {
        key: 'biggestTables',
        tags: ['size', 'storage'],
        code: `SELECT relname AS table,\n       pg_size_pretty(pg_total_relation_size(relid)) AS total_size\nFROM pg_catalog.pg_statio_user_tables\nORDER BY pg_total_relation_size(relid) DESC\nLIMIT 20;`,
      },
    ],
  },
  {
    key: 'templating',
    items: [
      {
        key: 'envVars',
        tags: ['vars', 'env'],
        code: `SELECT *\nFROM "orders"\nWHERE user_id = '{{userId}}'\n  AND status  = '{{status}}'\nLIMIT 50;`,
      },
      {
        key: 'multiStatement',
        tags: ['multi-statement'],
        code: `SELECT COUNT(*) FROM "users";\nSELECT COUNT(*) FROM "orders";\nSELECT status, COUNT(*) FROM "orders" GROUP BY status;`,
      },
    ],
  },
];

const MONGO_SECTIONS: Section[] = [
  {
    key: 'addressForms',
    items: [
      {
        key: 'currentDb',
        tags: ['basics'],
        code: `db.users.find().limit(25)`,
      },
      {
        key: 'quotedCollection',
        tags: ['getCollection'],
        code: `db.getCollection('orders-archive').find().limit(25)`,
      },
      {
        key: 'switchDb',
        tags: ['getSiblingDB', 'database'],
        code: `db.getSiblingDB('patchman_demo').orders.find().limit(25)`,
      },
      {
        key: 'crossDb',
        tags: ['shorthand', 'database', 'dbname'],
        code: `db.patchman_demo.orders.find().limit(25)`,
      },
      {
        key: 'crossDbQuoted',
        tags: ['getSiblingDB', 'getCollection'],
        code: `db.getSiblingDB('patchman_demo').getCollection('events').find().limit(25)`,
      },
    ],
  },
  {
    key: 'filtering',
    items: [
      {
        key: 'equalityProjection',
        tags: ['find', 'project'],
        code: `db.users.find({ role: 'admin' }, { _id: 1, email: 1, name: 1 })`,
      },
      {
        key: 'comparison',
        tags: ['operator', 'range'],
        code: `db.orders.find({\n  status: 'paid',\n  total: { $gte: 100, $lt: 1000 }\n})`,
      },
      {
        key: 'inNin',
        tags: ['in', 'enum'],
        code: `db.orders.find({\n  status: { $in: ['paid', 'pending'] }\n})`,
      },
      {
        key: 'regex',
        tags: ['regex'],
        code: `db.users.find({ email: { $regex: '@example\\\\.com$', $options: 'i' } })`,
      },
      {
        key: 'fieldExists',
        tags: ['exists'],
        code: `db.users.find({ 'settings.beta': { $exists: true } })`,
      },
      {
        key: 'arrayMatch',
        tags: ['array'],
        code: `db.orders.find({ 'items.sku': 'PLAN-PRO' })`,
      },
    ],
  },
  {
    key: 'chained',
    items: [
      {
        key: 'limitSkipSort',
        tags: ['limit', 'skip', 'sort'],
        code: `db.orders.find({ status: 'paid' })\n  .sort({ placedAt: -1 })\n  .skip(0)\n  .limit(20)`,
      },
      {
        key: 'projection',
        tags: ['project'],
        code: `db.users.find({ role: 'admin' })\n  .project({ _id: 0, email: 1, name: 1 })`,
      },
      {
        key: 'countFetch',
        tags: ['count'],
        code: `db.orders.find({ status: 'paid' }).count()`,
      },
    ],
  },
  {
    key: 'aggregations',
    items: [
      {
        key: 'groupSum',
        tags: ['aggregate', 'group'],
        code: `db.orders.aggregate([\n  { $match: { status: 'paid' } },\n  { $group: { _id: '$userId', total: { $sum: '$total' }, n: { $sum: 1 } } },\n  { $sort:  { total: -1 } },\n  { $limit: 10 }\n])`,
      },
      {
        key: 'unwind',
        tags: ['aggregate', 'unwind'],
        code: `db.orders.aggregate([\n  { $unwind: '$items' },\n  { $group:  { _id: '$items.sku', units: { $sum: '$items.qty' } } },\n  { $sort:   { units: -1 } },\n  { $limit:  20 }\n])`,
      },
      {
        key: 'dailySeries',
        tags: ['aggregate', 'timeseries'],
        code: `db.orders.aggregate([\n  { $match: { status: 'paid' } },\n  { $group: {\n      _id: { $dateToString: { format: '%Y-%m-%d', date: '$placedAt' } },\n      orders:  { $sum: 1 },\n      revenue: { $sum: '$total' }\n  }},\n  { $sort: { _id: 1 } }\n])`,
      },
      {
        key: 'lookup',
        tags: ['aggregate', 'lookup', 'join'],
        code: `db.orders.aggregate([\n  { $match: { status: 'paid' } },\n  { $lookup: {\n      from: 'users', localField: 'userId', foreignField: '_id', as: 'user'\n  }},\n  { $unwind: '$user' },\n  { $project: { _id: 1, total: 1, 'user.email': 1 } },\n  { $limit: 25 }\n])`,
      },
    ],
  },
  {
    key: 'counts',
    items: [
      {
        key: 'countDocuments',
        tags: ['count'],
        code: `db.orders.countDocuments({ status: 'paid' })`,
      },
      {
        key: 'estimatedDocumentCount',
        tags: ['count'],
        code: `db.orders.estimatedDocumentCount()`,
      },
      {
        key: 'distinctValues',
        tags: ['distinct'],
        code: `db.products.distinct('tags')`,
      },
    ],
  },
  {
    key: 'singleDoc',
    items: [
      {
        key: 'findOne',
        tags: ['findone'],
        code: `db.users.findOne({ email: 'ada@example.com' })`,
      },
      {
        key: 'explainQuery',
        tags: ['explain'],
        code: `db.orders.find({ status: 'paid' }).explain('executionStats')`,
      },
    ],
  },
];

const TIP_KEYS = ['tip1', 'tip2', 'tip3'] as const;

export function DBExamplesDialog({ open, onOpenChange, kind, onInsert }: DBExamplesDialogProps) {
  const { t } = useTranslation('dbquery');
  const family: Family =
    kind === 'mongo' ? 'mongo' : 'sql';
  const [tab, setTab] = useState<Family>(family);
  const [q, setQ] = useState('');

  // Re-pick the right tab whenever the dialog is reopened against a
  // different connection kind.
  useMemo(() => {
    if (open) setTab(family);
  }, [open, family]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[860px] h-[85vh] flex flex-col gap-3 p-0">
        <DialogHeader className="px-6 pt-6 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> {t('examples.title')}
          </DialogTitle>
          <DialogDescription>
            <Trans
              t={t}
              i18nKey="examples.description"
              components={{ strong: <strong className="text-foreground" /> }}
            />
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 flex items-center gap-2 shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('examples.filterPlaceholder')}
              className="h-8 text-xs pl-7"
            />
          </div>
          <Badge variant="outline" className="text-[10px]">
            {tab === 'sql' ? t('examples.badgeSql') : t('examples.badgeMongo')}
          </Badge>
        </div>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Family)}
          className="flex-1 min-h-0 flex flex-col px-6"
        >
          <TabsList className="w-full grid grid-cols-2 shrink-0">
            <TabsTrigger value="sql">{t('examples.tabSql')}</TabsTrigger>
            <TabsTrigger value="mongo">{t('examples.tabMongo')}</TabsTrigger>
          </TabsList>
          {/* The scrollable list lives inside an absolutely-clipped div
              so the cards never escape the dialog and overlap the tips
              footer below. */}
          <TabsContent value="sql" className="flex-1 min-h-0 mt-2 overflow-hidden data-[state=inactive]:hidden">
            <div className="h-full overflow-y-auto pr-1">
              <CookbookList sections={SQL_SECTIONS} family="sql" filter={q} onInsert={(t) => { onInsert(t); onOpenChange(false); }} />
            </div>
          </TabsContent>
          <TabsContent value="mongo" className="flex-1 min-h-0 mt-2 overflow-hidden data-[state=inactive]:hidden">
            <div className="h-full overflow-y-auto pr-1">
              <CookbookList sections={MONGO_SECTIONS} family="mongo" filter={q} onInsert={(t) => { onInsert(t); onOpenChange(false); }} />
            </div>
          </TabsContent>
        </Tabs>

        <div className="border-t px-6 py-2 shrink-0 bg-background text-[11px] text-muted-foreground space-y-0.5">
          {TIP_KEYS.map((k) => (
            <p key={k}>· {t(`examples.${k}`)}</p>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CookbookList({
  sections, family, filter, onInsert,
}: {
  sections: Section[];
  family: Family;
  filter: string;
  onInsert: (text: string) => void;
}) {
  const { t } = useTranslation('dbquery');
  const lower = filter.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!lower) return sections;
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter((it) => {
          const title = t(`examples.${family}.${s.key}.${it.key}.title`);
          const desc = t(`examples.${family}.${s.key}.${it.key}.desc`);
          const hay = (title + ' ' + desc + ' ' + it.tags.join(' ') + ' ' + it.code).toLowerCase();
          return hay.includes(lower);
        }),
      }))
      .filter((s) => s.items.length > 0);
  }, [sections, family, lower, t]);

  if (filtered.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        {t('examples.noMatch')}
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-2">
      {filtered.map((section) => (
        <section key={section.key}>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            {t(`examples.${family}.${section.key}.title`)}
          </h3>
          <div className="space-y-2">
            {section.items.map((it) => (
              <ExampleCard
                key={it.key}
                item={it}
                titleKey={`examples.${family}.${section.key}.${it.key}.title`}
                descKey={`examples.${family}.${section.key}.${it.key}.desc`}
                onInsert={onInsert}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ExampleCard({
  item, titleKey, descKey, onInsert,
}: {
  item: Example;
  titleKey: string;
  descKey: string;
  onInsert: (text: string) => void;
}) {
  const { t } = useTranslation('dbquery');
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(item.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  };
  return (
    <div className="border rounded-md overflow-hidden">
      <div className="px-3 py-1.5 flex items-start gap-2 border-b bg-muted/30">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-semibold">{t(titleKey)}</p>
            {item.tags.map((tag) => (
              <span key={tag} className="text-[9px] px-1 py-0.5 rounded bg-accent/60 text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t(descKey)}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1" onClick={handleCopy}>
            <Copy className="h-3 w-3" />
            {copied ? t('common:copied') : t('common:copy')}
          </Button>
          <Button size="sm" className="h-6 text-[11px] gap-1" onClick={() => onInsert(item.code)}>
            <Wand2 className="h-3 w-3" />
            {t('examples.useThis')}
          </Button>
        </div>
      </div>
      <pre className={cn(
        'font-mono text-[11px] px-3 py-2 whitespace-pre-wrap break-words',
        'bg-background',
      )}>{item.code}</pre>
    </div>
  );
}
