import "server-only";
import { JsonKnowledgeRepository } from "./jsonStore";
import type { KnowledgeRepository } from "./types";

/**
 * The single place the concrete repository is chosen. Swapping to Supabase means
 * adding one class and changing this line — nothing else imports the
 * implementation directly.
 */
let instance: KnowledgeRepository | null = null;

export function repository(): KnowledgeRepository {
  instance ??= new JsonKnowledgeRepository();
  return instance;
}

export * from "./types";
