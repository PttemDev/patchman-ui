import type { Monaco } from '@monaco-editor/react';
import { configureMonacoYaml } from 'monaco-yaml';

// Vendored, fully-dereferenced (-standalone-strict) Kubernetes JSON schemas —
// one per kind the K8s explorer lists/edits. Imported as in-memory JSON so
// NOTHING is fetched at runtime (see enableSchemaRequest:false below). Refresh
// with `node scripts/vendor-k8s-schema.mjs`.
import deployment from './k8s-schemas/deployment.json';
import pod from './k8s-schemas/pod.json';
import service from './k8s-schemas/service.json';
import configmap from './k8s-schemas/configmap.json';
import statefulset from './k8s-schemas/statefulset.json';
import daemonset from './k8s-schemas/daemonset.json';
import job from './k8s-schemas/job.json';
import cronjob from './k8s-schemas/cronjob.json';
import ingress from './k8s-schemas/ingress.json';
import secret from './k8s-schemas/secret.json';
import namespace from './k8s-schemas/namespace.json';
import node from './k8s-schemas/node.json';

// singular kind id (matches the editor model path `k8s-manifest/<kind>.yaml`,
// i.e. `detail.kind.toLowerCase()`) → its schema object.
const SCHEMAS: Record<string, unknown> = {
  deployment,
  pod,
  service,
  configmap,
  statefulset,
  daemonset,
  job,
  cronjob,
  ingress,
  secret,
  namespace,
  node,
};

let configured = false;

// registerYamlK8sSchemas wires monaco-yaml so the K8s explorer's editable YAML
// tab gets Kubernetes field completion + hover + validation, fully offline.
// Each schema is matched to a per-kind manifest path — the editor sets its model
// path to `k8s-manifest/<kind>.yaml`, so the schema follows the selected kind.
// Idempotent (guarded); safe to call once from registerLangKit at startup.
export function registerYamlK8sSchemas(monaco: Monaco): void {
  if (configured) return;
  configured = true;

  configureMonacoYaml(monaco, {
    enableSchemaRequest: false,
    validate: true,
    hover: true,
    completion: true,
    format: { enable: true },
    schemas: Object.entries(SCHEMAS).map(([kind, schema]) => ({
      uri: `inmemory://k8s/${kind}.json`,
      fileMatch: [`k8s-manifest/${kind}.yaml`, `**/${kind}.yaml`],
      schema: schema as object,
    })),
  });
}
