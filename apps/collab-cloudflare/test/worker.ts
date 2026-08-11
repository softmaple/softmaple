import type { DocumentRoomServices } from "@softmaple/collab-runtime";
import { DocumentRoomDO } from "../src/document-room-do";
import worker from "../src/index";
import { createRoomServicesForBackend } from "../src/room-services";
import { createMemoryDocumentBackend } from "./memory-backend";

export class TestDocumentRoomDO extends DocumentRoomDO {
  protected override createServices(documentId: string): DocumentRoomServices {
    return createRoomServicesForBackend(
      documentId,
      createMemoryDocumentBackend(documentId),
    );
  }
}

export default worker;
