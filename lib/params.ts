import { notFound } from "next/navigation";
import { gameFromSlug, type Game } from "./games";

/** Resolve a /[game] route segment or render the 404 page. */
export function requireGameSlug(slug: string): Game {
  const game = gameFromSlug(slug);
  if (!game) notFound();
  return game;
}
