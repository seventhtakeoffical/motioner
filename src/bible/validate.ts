import { z } from "zod";
import { BibleSchema, type Bible } from "./schema";

/**
 * The runtime half of the M7 validation gate: where a Bible stops being
 * `unknown` JSON and becomes a typed value the pipeline may trust. This is
 * the only sanctioned way to turn outside input into a Bible — the
 * compiler's gated entry (src/compiler/gate.ts) calls this before anything
 * else happens.
 */

/** Turns a ZodError into one readable message listing every failing path. */
export function formatZodError(label: string, error: z.ZodError): string {
  const lines = error.issues.map(
    (issue) =>
      `  - ${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`,
  );
  return `${label}:\n${lines.join("\n")}`;
}

/**
 * Parse unknown input into a Bible, or throw with a message that names
 * every invalid path. Deliberately throws rather than returning a result
 * object: downstream of this gate, an invalid Bible must not be
 * representable, and the callers who want to *inspect* failures (the M13
 * review tooling) can catch.
 */
export function parseBible(input: unknown): Bible {
  const result = BibleSchema.safeParse(input);
  if (!result.success) {
    throw new Error(formatZodError("Invalid Production Bible", result.error));
  }
  return result.data;
}
