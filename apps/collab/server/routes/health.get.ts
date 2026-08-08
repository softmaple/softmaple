import { defineEventHandler } from "nitro/h3";

export default defineEventHandler(() => ({
  ok: true,
  service: "softmaple-collab",
  protocolVersion: 2,
  timestamp: new Date().toISOString(),
}));
