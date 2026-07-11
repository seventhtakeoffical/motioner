import { parseApproval, verifyApproval } from "../bible/approval";
import { parseBible } from "../bible/validate";
import type { RecipeRegistry } from "../recipes";
import type { RenderPlan } from "../render-plan";
import { compileBible } from "./compile";

/**
 * The M7 gate: the compiler's production entry point, and the only path by
 * which outside input becomes a Render Plan. Three checks, in order:
 *
 *   1. Shape  — parse the Bible against the strict Zod schema.
 *   2. Trust  — parse the approval and verify its hash covers exactly
 *               this document. An unapproved or since-edited draft stops
 *               here, before a single frame is planned.
 *   3. Meaning — compileBible's own binding validation, as before.
 *
 * `compileBible` stays exported as the pure core (tests and future draft-
 * preview tooling use it deliberately), but anything that renders for real
 * goes through this gate.
 */
export function compileApprovedBible(
  bibleInput: unknown,
  approvalInput: unknown,
  recipes: RecipeRegistry,
): RenderPlan {
  const bible = parseBible(bibleInput);
  const approval = parseApproval(approvalInput);
  verifyApproval(bible, approval);
  return compileBible(bible, recipes);
}
