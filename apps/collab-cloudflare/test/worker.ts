import type {
  DocumentRoomServices,
  PresenceRoomServices,
} from "@softmaple/collab-runtime";
import { DocumentRoomDO } from "../src/document-room-do";
import { PresenceRoomDO } from "../src/presence-room-do";
import { createPresenceServicesForBackend } from "../src/presence-services";
import { createRoomServicesForBackend } from "../src/room-services";
import worker from "../src/index";
import { createMemoryDocumentBackend } from "./memory-backend";
import { createMemoryPresenceBackend } from "./memory-presence-backend";

export class TestDocumentRoomDO extends DocumentRoomDO {
  protected override createServices(documentId: string): DocumentRoomServices {
    return createRoomServicesForBackend(
      documentId,
      createMemoryDocumentBackend(documentId, this.ctx.storage),
    );
  }
}

export class TestPresenceRoomDO extends PresenceRoomDO {
  protected override createServices(): PresenceRoomServices {
    if (this.roomId === null) {
      throw new Error(
        "createServices called before a presence room id was set",
      );
    }
    return createPresenceServicesForBackend(
      this.ctx.storage,
      createMemoryPresenceBackend(this.roomId, this.ctx.storage),
    );
  }
}

export default worker;
