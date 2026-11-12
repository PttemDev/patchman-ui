// vendor-k8s-schema.mjs — fetch the canonical Kubernetes JSON schemas and
// vendor the supported kinds as the offline monaco-yaml completion corpus.
//
//   node scripts/vendor-k8s-schema.mjs
//
// Source of truth: yannh/kubernetes-json-schema — the `-standalone-strict`
// variant is fully dereferenced (every $ref inlined) and has
// additionalProperties:false, so it needs no network resolution at runtime and
// gives strict field validation. Required for the app's offline/CSP story:
// monaco-yaml is configured with enableSchemaRequest:false and these imported
// JSON blobs, so NOTHING is fetched when a YAML editor mounts.
//
//   https://raw.githubusercontent.com/yannh/kubernetes-json-schema/master/<VER>-standalone-strict/<kind>.json
//
// Output: fe/src/lib/monacoLangKit/yaml/k8s-schemas/<kind>.json  (one per kind)
//
// Only the kinds the K8s explorer lists/edits are vendored, to keep the bundle
// small. If the network is unreachable the script writes a MINIMAL hand-authored
// schema per missing kind (apiVersion/kind/metadata/spec) so completion still
// works offline, and reports which kinds fell back.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Try newest first, step down to whatever the upstream repo actually has.
const VERSIONS = ['v1.31.0', 'v1.30.0', 'v1.29.0', 'v1.28.0'];

// singular kind id → upstream schema file basename (lowercase, no version).
const KINDS = [
  'deployment',
  'pod',
  'service',
  'configmap',
  'statefulset',
  'daemonset',
  'job',
  'cronjob',
  'ingress',
  'secret',
  'namespace',
  'node',
];

const OUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/lib/monacoLangKit/yaml/k8s-schemas',
);

// Human-friendly apiVersion/kind pairs for the minimal fallback schemas.
const META = {
  deployment: { apiVersion: 'apps/v1', kind: 'Deployment' },
  pod: { apiVersion: 'v1', kind: 'Pod' },
  service: { apiVersion: 'v1', kind: 'Service' },
  configmap: { apiVersion: 'v1', kind: 'ConfigMap' },
  statefulset: { apiVersion: 'apps/v1', kind: 'StatefulSet' },
  daemonset: { apiVersion: 'apps/v1', kind: 'DaemonSet' },
  job: { apiVersion: 'batch/v1', kind: 'Job' },
  cronjob: { apiVersion: 'batch/v1', kind: 'CronJob' },
  ingress: { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress' },
  secret: { apiVersion: 'v1', kind: 'Secret' },
  namespace: { apiVersion: 'v1', kind: 'Namespace' },
  node: { apiVersion: 'v1', kind: 'Node' },
};

function minimalSchema(kind) {
  const { apiVersion, kind: Kind } = META[kind];
  return {
    type: 'object',
    additionalProperties: false,
    required: ['apiVersion', 'kind'],
    properties: {
      apiVersion: { type: 'string', enum: [apiVersion], description: `${Kind} apiVersion` },
      kind: { type: 'string', enum: [Kind], description: 'Resource kind' },
      metadata: {
        type: 'object',
        description: 'Standard object metadata',
        properties: {
          name: { type: 'string' },
          namespace: { type: 'string' },
          labels: { type: 'object', additionalProperties: { type: 'string' } },
          annotations: { type: 'object', additionalProperties: { type: 'string' } },
        },
      },
      spec: { type: 'object', description: `${Kind} spec` },
      status: { type: 'object', description: `${Kind} status` },
    },
  };
}

// Resolve the first VERSION that actually serves a given kind's schema.
async function fetchKind(kind) {
  for (const ver of VERSIONS) {
    const url = `https://raw.githubusercontent.com/yannh/kubernetes-json-schema/master/${ver}-standalone-strict/${kind}.json`;
    let res;
    try {
      res = await fetch(url);
    } catch {
      // Network down entirely — bail out to trigger the offline fallback.
      throw new Error('network-unreachable');
    }
    if (res.ok) {
      const schema = await res.json();
      return { schema, ver };
    }
  }
  return null; // reachable, but no version has this kind — use minimal fallback
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const vendored = [];
  const fallback = [];
  let offline = false;

  for (const kind of KINDS) {
    let schema = null;
    let ver = null;
    if (!offline) {
      try {
        const got = await fetchKind(kind);
        if (got) ({ schema, ver } = got);
      } catch (e) {
        if (e.message === 'network-unreachable') {
          offline = true;
          process.stderr.write('Network unreachable — hand-authoring minimal schemas.\n');
        }
      }
    }
    if (!schema) {
      schema = minimalSchema(kind);
      fallback.push(kind);
    } else {
      vendored.push({ kind, ver });
    }
    const out = resolve(OUT_DIR, `${kind}.json`);
    await writeFile(out, JSON.stringify(schema, null, 0) + '\n', 'utf8');
  }

  if (vendored.length) {
    const ver = vendored[0].ver;
    process.stderr.write(`Vendored ${vendored.length} kinds from yannh/kubernetes-json-schema (${ver}): ${vendored.map((v) => v.kind).join(', ')}\n`);
  }
  if (fallback.length) {
    process.stderr.write(`Hand-authored minimal schemas for: ${fallback.join(', ')}\n`);
  }
  process.stderr.write(`Wrote ${KINDS.length} schemas → ${OUT_DIR}\n`);
}

main().catch((err) => {
  process.stderr.write(`vendor-k8s-schema failed: ${err.message}\n`);
  process.exit(1);
});
