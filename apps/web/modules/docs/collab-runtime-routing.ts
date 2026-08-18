/**
 * Explicit, reversible, document-scoped decision for which collaboration
 * backend a document connects to: the existing Nitro+Redis runtime
 * (apps/collab) or the Cloudflare Durable Objects runtime
 * (apps/collab-cloudflare). See apps/web/README.md#collaboration-runtime-routing.
 */

export const COLLAB_RUNTIME = {
  Cloudflare: "cloudflare",
  Nitro: "nitro",
} as const;

export type CollabRuntime =
  (typeof COLLAB_RUNTIME)[keyof typeof COLLAB_RUNTIME];

export type CollabRuntimeRoutingConfig = {
  readonly allowlist: ReadonlySet<string>;
  readonly cloudflareConfigured: boolean;
  readonly denylist: ReadonlySet<string>;
  readonly override: CollabRuntime | null;
  readonly rolloutPercent: number;
};

const HASH_BUCKET_COUNT = 100;

/** FNV-1a 32-bit hash, used only for stable percentage-cohort bucketing. */
const fnv1a32 = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const decideCollabRuntime = (
  documentId: string,
  config: CollabRuntimeRoutingConfig,
): CollabRuntime => {
  if (!config.cloudflareConfigured) return COLLAB_RUNTIME.Nitro;
  if (config.denylist.has(documentId)) return COLLAB_RUNTIME.Nitro;
  if (config.allowlist.has(documentId)) return COLLAB_RUNTIME.Cloudflare;
  if (config.override !== null) return config.override;

  const bucket = fnv1a32(documentId) % HASH_BUCKET_COUNT;
  return bucket < config.rolloutPercent
    ? COLLAB_RUNTIME.Cloudflare
    : COLLAB_RUNTIME.Nitro;
};

const parseDocumentIdList = (raw: string | undefined): ReadonlySet<string> =>
  new Set(
    (raw ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );

const clampRolloutPercent = (raw: string | undefined): number => {
  const parsed = Number(raw ?? "0");
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, Math.trunc(parsed)));
};

const parseOverride = (raw: string | undefined): CollabRuntime | null =>
  raw === COLLAB_RUNTIME.Nitro || raw === COLLAB_RUNTIME.Cloudflare
    ? raw
    : null;

/**
 * Single source of truth for the Cloudflare collaboration endpoint, shared by
 * the runtime decision below and by endpoint resolution
 * (`collab-target.ts`), so selecting Cloudflare and resolving Cloudflare can
 * never disagree about whether it is deployed.
 *
 * `COLLAB_CLOUDFLARE_WS_URL` is the preferred, server-only name: endpoints are
 * resolved server-side now, so the value no longer has to reach the browser.
 * The legacy `NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL` still works so existing
 * deployments keep running unchanged. Each name is normalized before
 * precedence is applied, so a declared-but-blank preferred variable (what
 * copying `.env.example` leaves behind) reads as unset rather than shadowing a
 * configured legacy value.
 */
const normalizeEndpoint = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

export const readCloudflareCollabBaseUrl = (): string | undefined =>
  normalizeEndpoint(process.env.COLLAB_CLOUDFLARE_WS_URL) ??
  normalizeEndpoint(process.env.NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL);

export const readCollabRuntimeRoutingConfig =
  (): CollabRuntimeRoutingConfig => ({
    allowlist: parseDocumentIdList(
      process.env.COLLAB_CLOUDFLARE_DOCUMENT_ALLOWLIST,
    ),
    cloudflareConfigured: readCloudflareCollabBaseUrl() !== undefined,
    denylist: parseDocumentIdList(
      process.env.COLLAB_CLOUDFLARE_DOCUMENT_DENYLIST,
    ),
    override: parseOverride(process.env.COLLAB_RUNTIME_OVERRIDE),
    rolloutPercent: clampRolloutPercent(
      process.env.COLLAB_CLOUDFLARE_ROLLOUT_PERCENT,
    ),
  });

export const resolveCollabRuntime = (documentId: string): CollabRuntime =>
  decideCollabRuntime(documentId, readCollabRuntimeRoutingConfig());
