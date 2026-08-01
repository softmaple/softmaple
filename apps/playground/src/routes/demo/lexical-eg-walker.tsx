import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { LexicalEgWalkerDemo } from "@/modules/lexical-eg-walker/LexicalEgWalkerDemo";

const roomSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/);

const searchSchema = z.object({
  room: roomSchema.optional(),
});

export const Route = createFileRoute("/demo/lexical-eg-walker")({
  ssr: false,
  validateSearch: searchSchema,
  component: LexicalEgWalkerRoute,
});

function LexicalEgWalkerRoute() {
  const { room } = Route.useSearch();

  return <LexicalEgWalkerDemo requestedRoom={room} />;
}
