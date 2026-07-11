import { z } from "zod";
import type { Bible } from "./schema";
import { formatZodError } from "./validate";

/**
 * The approval half of the M7 trust boundary: what mechanically separates
 * "a draft Claude produced" from "a Bible a human reviewed and locked".
 * An approval is a small record binding a Bible's id to a content hash of
 * the exact document that was reviewed. The compiler's gated entry refuses
 * to run without one that verifies.
 *
 * The hash is FNV-1a 64 over *canonical* JSON (object keys recursively
 * sorted), so two semantically identical Bibles hash identically no matter
 * what key order their JSON was written in — and any content change at
 * all, one character of narration, breaks verification.
 *
 * Two deliberate constraints:
 *  - No crypto imports. The M6 lint fence bans node:crypto in the
 *    deterministic modules, and rightly so. FNV-1a is ~10 lines of pure
 *    BigInt arithmetic. Be honest about what that buys: tamper-EVIDENCE
 *    against accidental drift (the real risk in this pipeline), not
 *    cryptographic defense against an adversary who can also edit the
 *    approval file. If that threat model ever changes, this one function
 *    is the swap point.
 *  - No clock. `createApproval` takes `approvedAt` as an argument; the
 *    deterministic modules never read time. The approval workflow tooling
 *    (M13) is where a timestamp gets captured.
 */

export const BibleApprovalSchema = z
  .object({
    /** Must match the approved Bible's id. */
    bibleId: z.string().min(1),
    /** hashBible() of the exact document that was reviewed. */
    bibleHash: z.string().regex(/^[0-9a-f]{16}$/),
    /** Who signed off. Audit trail, not authorization — see module comment. */
    approvedBy: z.string().min(1),
    approvedAt: z.string().datetime(),
  })
  .strict();

export type BibleApproval = z.infer<typeof BibleApprovalSchema>;

/**
 * Canonical JSON: like JSON.stringify, but object keys are emitted in
 * sorted order at every depth, so serialization is a function of *value*
 * rather than of insertion order. Assumes JSON-safe input (no undefined,
 * functions, Dates, cycles) — which a parsed Bible is by construction.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    );
  return `{${entries.join(",")}}`;
}

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64 = 0xffffffffffffffffn;

/** FNV-1a 64-bit over the Bible's canonical JSON, as 16 lowercase hex chars. */
export function hashBible(bible: Bible): string {
  const text = canonicalJson(bible);
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i++) {
    // UTF-16 code units, mixed as two bytes each — deterministic on every
    // platform, no encoder dependency.
    const unit = text.charCodeAt(i);
    hash = ((hash ^ BigInt(unit & 0xff)) * FNV_PRIME) & U64;
    hash = ((hash ^ BigInt(unit >> 8)) * FNV_PRIME) & U64;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Build (and self-validate) an approval for the given Bible as reviewed. */
export function createApproval(
  bible: Bible,
  approvedBy: string,
  approvedAt: string,
): BibleApproval {
  return BibleApprovalSchema.parse({
    bibleId: bible.id,
    bibleHash: hashBible(bible),
    approvedBy,
    approvedAt,
  });
}

/** Parse unknown input into a BibleApproval, or throw listing every failure. */
export function parseApproval(input: unknown): BibleApproval {
  const result = BibleApprovalSchema.safeParse(input);
  if (!result.success) {
    throw new Error(formatZodError("Invalid Bible approval", result.error));
  }
  return result.data;
}

/**
 * The gate check: does this approval cover exactly this Bible? Throws with
 * a reviewer-actionable message otherwise.
 */
export function verifyApproval(bible: Bible, approval: BibleApproval): void {
  if (approval.bibleId !== bible.id) {
    throw new Error(
      `Approval is for Bible "${approval.bibleId}", but this Bible is "${bible.id}".`,
    );
  }
  const actual = hashBible(bible);
  if (actual !== approval.bibleHash) {
    throw new Error(
      `Bible "${bible.id}" has changed since it was approved ` +
        `(approved hash ${approval.bibleHash}, current hash ${actual}). ` +
        `Re-review and re-approve the current document.`,
    );
  }
}
