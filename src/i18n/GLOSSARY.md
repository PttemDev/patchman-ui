# i18n translation glossary & rules

Consistency reference for translating PatchMan to **en / tr / es / zh**. Read
this before adding translations so terms match across the whole app.

## Rules
- **Reuse `common:`** for generic words (save, cancel, delete, add, edit, search,
  refresh, copy, loading, error, name, type, status, actions…). Don't re-add them
  per namespace.
- **Keep well-known technical / product nouns in English** (do NOT translate) —
  they read as jargon in every language and translating them hurts a dev tool:
  Kafka **Topic / Broker / Partition / Consumer / Offset / Lag**; Kubernetes /
  **Pod / Namespace / Deployment / Cluster / Node / ConfigMap**; Git /
  **branch / commit / merge / push / pull / rebase / diff**; **Redis /
  Elasticsearch / S3 / bucket**; HTTP method names (GET/POST/PUT…); **JSON / YAML
  / SQL / JWT / OAuth / MCP / DNS / TTL**; product names (PatchMan).
- Translate UI/action words, sentences, labels, placeholders, empty states,
  toasts, tooltips, errors.
- Keep every locale namespace **key-for-key identical** across all 4 languages
  (enforced by `scripts/check-i18n.mjs` / the pre-commit hook).
- Interpolation: use i18next `{{var}}` placeholders; keep the variable name
  identical in all languages.

## Core term table (translate these consistently)
| English | tr | es | zh |
|---|---|---|---|
| Connection | Bağlantı | Conexión | 连接 |
| Request | İstek | Solicitud | 请求 |
| Response | Yanıt | Respuesta | 响应 |
| Collection | Koleksiyon | Colección | 集合 |
| Environment | Ortam | Entorno | 环境 |
| Workspace | Çalışma alanı | Espacio de trabajo | 工作区 |
| Query | Sorgu | Consulta | 查询 |
| Database | Veritabanı | Base de datos | 数据库 |
| Table | Tablo | Tabla | 表 |
| Message | Mesaj | Mensaje | 消息 |
| Key | Anahtar | Clave | 键 |
| Value | Değer | Valor | 值 |
| Send | Gönder | Enviar | 发送 |
| Share | Paylaş | Compartir | 共享 |
| Read-only | Salt okunur | Solo lectura | 只读 |
| Owner | Sahip | Propietario | 所有者 |
| Loading… | Yükleniyor… | Cargando… | 加载中… |
| No X yet | Henüz X yok | Aún no hay X | 尚无 X |
| Failed to … | … başarısız | Error al … | …失败 |

## File layout
`src/i18n/locales/<lng>/<namespace>.json`. New namespace = drop 4 files
(en/tr/es/zh), auto-loaded by `src/i18n/index.ts`. Use
`const { t } = useTranslation('<namespace>')` in components.
