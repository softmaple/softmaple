import type { RichTextEventBatch } from "@softmaple/block-model";

/**
 * Service-role-only database functions.
 *
 * `append_document_event_batches` is revoked from `anon` and `authenticated`
 * and therefore absent from the generated `Database` types, which describe the
 * browser-reachable Data API. Declaring it here keeps the seeder fully typed
 * without widening the type the application uses, and without pretending the
 * function is reachable from a browser session.
 *
 * Source of truth: `packages/db/prisma/migrations/20260811043830_add_cloudflare_collab_rpc`.
 */
export type ServiceRoleDatabase = {
  readonly public: {
    readonly Tables: Record<never, never>;
    readonly Views: Record<never, never>;
    readonly Functions: {
      readonly append_document_event_batches: {
        readonly Args: {
          readonly p_actor_id: string;
          readonly p_batches: ReadonlyArray<RichTextEventBatch>;
          readonly p_document_id: string;
        };
        readonly Returns: ReadonlyArray<string>;
      };
    };
    readonly Enums: Record<never, never>;
    readonly CompositeTypes: Record<never, never>;
  };
};
