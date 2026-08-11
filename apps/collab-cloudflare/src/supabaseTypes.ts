import type { Database, Json } from "@softmaple/db";
import type { DocumentEventCursor } from "@softmaple/collab-runtime";

type PublicSchema = Database["public"];
type GeneratedFunctions = PublicSchema["Functions"];

/**
 * Server-only RPCs may not exist in generated types until their migration has
 * been applied. Override the BIGINT cursor because Supabase's generator maps
 * int8 arguments to number, while collaboration cursors must remain lossless
 * decimal strings in JavaScript.
 */
export type CollabDatabase = Omit<Database, "public"> & {
  public: Omit<PublicSchema, "Functions"> & {
    Functions: Omit<
      GeneratedFunctions,
      "append_document_event_batches" | "read_document_event_page"
    > & {
      append_document_event_batches: {
        Args: {
          p_actor_id: string;
          p_batches: Json;
          p_document_id: string;
        };
        Returns: string[];
      };
      read_document_event_page: {
        Args: {
          p_after_cursor: DocumentEventCursor;
          p_document_id: string;
          p_limit?: number;
        };
        Returns: Json;
      };
    };
  };
};
