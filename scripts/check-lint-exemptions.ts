// Fails a commit that adds a path to an override in the oxlint config that
// turns a rule off or down to a warning for that path, or adds a pattern to
// the top-level ignorePatterns, which exempts its paths from all rules. Each
// such rule's paths, and ignorePatterns, are an exemption list, and these
// lists can only shrink. Removing a path
// passes, and so does an override that keeps a rule at "error", even with
// other options: tightening a rule is not an exemption. Numeric limits are
// not compared with the top-level setting, so ["error", 9] counts as error.
// lint-staged runs this only when .oxlintrc.json is staged, so other commits
// pay nothing for it.
// Usage: node scripts/check-lint-exemptions.ts

import {
  type AddedEntry,
  type Allowlists,
  addEntry,
  addedEntries,
  readAtRevision,
} from "./shrink-only.ts";

const CONFIG = ".oxlintrc.json";

// The list that the top-level ignorePatterns are reported under.
const IGNORED = "all rules";

type OxlintConfig = {
  ignorePatterns?: string[];
  overrides?: { files?: string[]; rules?: Record<string, unknown> }[];
};

// Strips the comments and trailing commas that oxlint allows in its config,
// so JSON.parse can read it. Strings are copied as they are: a glob such as
// "**/*.test.ts" contains "/*" but is not a comment.
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      const end = endOfString(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) throw new SyntaxError("Unterminated comment in JSONC");
      i = end + 2;
    } else {
      // A comma right before a closing bracket is a trailing comma.
      if (char === "}" || char === "]") out = out.replace(/,\s*$/, "");
      out += char;
      i++;
    }
  }
  return JSON.parse(out);
}

// The index just past the closing quote of the string that starts at `start`.
function endOfString(text: string, start: number): number {
  let i = start + 1;
  while (text[i] !== '"') {
    if (i >= text.length) throw new SyntaxError("Unterminated string in JSONC");
    i += text[i] === "\\" ? 2 : 1;
  }
  return i + 1;
}

// The severities that turn a rule off or down to a warning.
const LOOSE_SEVERITIES: unknown[] = ["off", "allow", 0, "warn", 1];

// A rule setting is a severity, or an array whose first item is the severity.
function loosens(setting: unknown): boolean {
  const severity = Array.isArray(setting) ? setting[0] : setting;
  return LOOSE_SEVERITIES.includes(severity);
}

// One list per rule: the paths that some override loosens that rule for.
// The ignorePatterns are one more list, for all rules.
function exemptionLists(text: string): Allowlists {
  const config = parseJsonc(text) as OxlintConfig;
  const lists: Allowlists = new Map();
  for (const pattern of config.ignorePatterns ?? []) {
    addEntry(lists, IGNORED, pattern);
  }
  for (const override of config.overrides ?? []) {
    for (const [rule, setting] of Object.entries(override.rules ?? {})) {
      if (!loosens(setting)) continue;
      for (const path of override.files ?? []) addEntry(lists, rule, path);
    }
  }
  return lists;
}

export function checkExemptions(head: string, staged: string): AddedEntry[] {
  return addedEntries(exemptionLists(head), exemptionLists(staged));
}

export function formatFailure(added: AddedEntry[]): string {
  const lines = added.map(({ list, entry }) => `  ${entry}: ${list}`);
  return `These paths are new in a lint exemption list in ${CONFIG}:

${lines.join("\n")}

The exemption lists can only shrink. Take each path out of the override (or
out of ignorePatterns, for "${IGNORED}") and fix the code instead: split the
function or the file until the rule passes. Do not move the path to another
override or to ignorePatterns, and do not loosen the rule.

When you are done, run \`npm run check\` and commit again.`;
}

if (import.meta.main) {
  const head = readAtRevision("HEAD:", CONFIG);
  const staged = readAtRevision(":", CONFIG);
  let added: AddedEntry[] = [];
  try {
    added = head && staged ? checkExemptions(head, staged) : [];
  } catch (error) {
    console.error(`Could not read ${CONFIG}: ${String(error)}
Fix the syntax of the staged file and commit again.`);
    process.exit(1);
  }
  if (added.length > 0) {
    console.error(formatFailure(added));
    process.exit(1);
  }
}
