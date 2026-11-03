/**
 * The feedback grammar, made checkable (renderer/feedback work, 2026-09-26).
 *
 * The constitution states it exactly: "Success toast: past participle of the
 * CTA verb + ledger noun ('Statement archived'), top-right, ≤ 3 lines, 5s
 * timeout." Every slice authored one and nothing ever read it, so nothing
 * checked it — and `Action reorderd` shipped in the record.
 *
 * WHAT THIS DOES NOT CHECK, and why. The first version flagged seven slices
 * and six were its own misreading:
 *
 *   `success: none (navigation)` parses as the STRING "none (navigation)",
 *   not null. Slices express "no toast" both ways, and a checker that knows
 *   only one convention reports the other as a violation.
 *
 *   A mutation with no toast can be right. edit-variable is inline: the cell
 *   returning to text with the new value IS the feedback, and a toast there
 *   would be heavier than the change.
 *
 * So the rule is narrow on purpose: WHEN a toast exists, it must follow the
 * grammar. That catches a real typo and invents nothing.
 */

/** Past participle per canonical verb. `edit` commits via Save, so its toast
 *  says "saved" — the constitution's own example follows the commit verb. */
export const PARTICIPLE = Object.freeze({
  create: "created", add: "added", edit: "saved", save: "saved",
  delete: "deleted", remove: "removed", duplicate: "duplicated",
  archive: "archived", restore: "restored", publish: "published",
  download: "downloaded", import: "imported", export: "exported",
  invite: "invited", assign: "assigned", unassign: "unassigned",
  enroll: "enrolled", start: "started", approve: "approved",
  reject: "rejected", enable: "enabled", disable: "disabled",
  reorder: "reordered", close: "closed",
});

/** True when a slice says "no toast", however it says it. */
export function isNoToast(success) {
  if (success === null || success === undefined) return true;
  const s = String(success).trim().toLowerCase();
  return s === "" || s === "null" || s === "~" || s.startsWith("none");
}

/**
 * Check one slice's success toast. Returns problems, never throws.
 *
 * `noun` is matched on its first word: a toast for `commission slip` reads
 * "Commission slip corrected", and requiring the whole phrase would reject
 * the plural and possessive forms English actually produces.
 */
export function checkToast({ cta, object, success }) {
  if (isNoToast(success)) return [];
  const text = String(success).toLowerCase();
  const problems = [];
  const want = PARTICIPLE[cta];
  if (want && !text.includes(want)) {
    problems.push(
      `toast "${success}" does not contain "${want}" — the grammar is the past ` +
        `participle of the CTA verb plus the ledger noun`,
    );
  }
  const noun = String(object ?? "").trim().split(/\s+/)[0]?.toLowerCase();
  if (noun && !text.includes(noun)) {
    problems.push(`toast "${success}" does not name the object "${object}"`);
  }
  return problems;
}
