/**
 * The approval workflow (M13) — the filesystem shell around report.ts.
 *
 * Draft in `drafts/`, approved pair out in `approved/`: the Bible bytes and
 * the approval record the M7 gate demands. Two rules are enforced here, not
 * just documented:
 *
 *  - A draft with ANY validation error cannot be approved.
 *  - An artifact inside the approved directory can never be re-approved in
 *    place. Changes always flow through a new draft — and M7's content hash
 *    makes direct edits self-defeating anyway (the approval goes stale the
 *    moment a byte changes).
 *
 * `approvedAt` is a parameter: this module stays clock-free so tests are
 * deterministic; the CLI supplies the real timestamp.
 */

import fs from "node:fs";
import path from "node:path";
import {
  createApproval,
  parseApproval,
  verifyApproval,
  type BibleApproval,
} from "../src/bible/approval";
import { parseBible } from "../src/bible/validate";
import { buildReviewReport, type ReviewReport } from "./report";

export function loadJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/** drafts/foo.bible.json → drafts/foo.approval.json (if it exists). */
export function findSiblingApproval(biblePath: string): string | undefined {
  const candidate = biblePath.replace(/\.bible\.json$/, ".approval.json");
  return candidate !== biblePath && fs.existsSync(candidate)
    ? candidate
    : undefined;
}

/** Build the review report for a Bible file, picking up a sibling approval. */
export function reviewFile(
  biblePath: string,
  scriptText?: string,
): ReviewReport {
  const approvalPath = findSiblingApproval(biblePath);
  return buildReviewReport({
    bible: loadJson(biblePath),
    scriptText,
    approval: approvalPath ? loadJson(approvalPath) : undefined,
  });
}

export interface ApproveOptions {
  draftPath: string;
  approvedDir: string;
  reviewer: string;
  approvedAt: string;
  scriptText?: string;
}

export interface ApproveResult {
  biblePath: string;
  approvalPath: string;
  approval: BibleApproval;
  report: ReviewReport;
}

export function approveDraft(options: ApproveOptions): ApproveResult {
  const draftAbs = path.resolve(options.draftPath);
  const approvedAbs = path.resolve(options.approvedDir);
  if (draftAbs.startsWith(approvedAbs + path.sep)) {
    throw new Error(
      `Refusing to approve "${options.draftPath}": it is inside the approved ` +
        `directory. Approved artifacts are never edited or re-approved in ` +
        `place — regenerate a draft, review it, and approve that.`,
    );
  }

  const report = buildReviewReport({
    bible: loadJson(options.draftPath),
    scriptText: options.scriptText,
  });
  if (!report.ok || !report.bible) {
    throw new Error(
      `Refusing to approve: the draft has ${report.errors.length} validation ` +
        `error(s):\n${report.errors.join("\n")}`,
    );
  }

  const bible = report.bible;
  const approval = createApproval(bible, options.reviewer, options.approvedAt);

  fs.mkdirSync(options.approvedDir, { recursive: true });
  const biblePath = path.join(options.approvedDir, `${bible.id}.bible.json`);
  const approvalPath = path.join(
    options.approvedDir,
    `${bible.id}.approval.json`,
  );
  fs.writeFileSync(biblePath, JSON.stringify(bible, null, 2) + "\n");
  fs.writeFileSync(approvalPath, JSON.stringify(approval, null, 2) + "\n");

  // Paranoia that pays for itself: verify the artifacts as they exist ON
  // DISK — exactly what the gate will read — not the in-memory values.
  verifyApproval(
    parseBible(loadJson(biblePath)),
    parseApproval(loadJson(approvalPath)),
  );

  return { biblePath, approvalPath, approval, report };
}
