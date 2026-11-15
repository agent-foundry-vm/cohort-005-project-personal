// Fails a commit that adds a path to any `files` list in the oxlint config's
// overrides. Each override turns rules off (or down) for its files, so each
// list is an exemption list, and these lists can only shrink. Removing a path
// passes.
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

type OxlintConfig = {
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
      i = text.indexOf("*/", i + 2) + 2;
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
  while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
  return i + 1;
}

// One list per rule: the paths that some override sets that rule for.
function exemptionLists(text: string): Allowlists {
  const config = parseJsonc(text) as OxlintConfig;
  const lists: Allowlists = new Map();
  for (const override of config.overrides ?? []) {
    for (const rule of Object.keys(override.rules ?? {})) {
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

The exemption lists can only shrink. Take each path out of the override and
fix the code instead: split the function or the file until the rule passes.
Do not move the path to another override, and do not loosen the rule.

When you are done, run \`npm run check\` and commit again.`;
}

if (import.meta.main) {
  const head = readAtRevision("HEAD:", CONFIG);
  const staged = readAtRevision(":", CONFIG);
  const added = head && staged ? checkExemptions(head, staged) : [];
  if (added.length > 0) {
    console.error(formatFailure(added));
    process.exit(1);
  }
}
