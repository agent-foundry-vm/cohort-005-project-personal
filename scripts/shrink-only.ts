// Shared parts of the checks that keep an allowlist from growing.
// An allowlist is a set of named lists. Each list holds entries, such as the
// paths a lint rule is turned off for. A check compares the lists in the
// staged file with the same lists at HEAD and fails on any new entry.
// Removing entries always passes.

import { execFileSync } from "node:child_process";

export type Allowlists = Map<string, Set<string>>;

export type AddedEntry = { list: string; entry: string };

export function addEntry(lists: Allowlists, list: string, entry: string) {
  const entries = lists.get(list) ?? new Set<string>();
  entries.add(entry);
  lists.set(list, entries);
}

// The entries in `after` that are not in the same list in `before`, sorted by
// list and then entry.
export function addedEntries(
  before: Allowlists,
  after: Allowlists
): AddedEntry[] {
  const added: AddedEntry[] = [];
  for (const [list, entries] of after) {
    for (const entry of entries) {
      if (!before.get(list)?.has(entry)) added.push({ list, entry });
    }
  }
  return added.sort(
    (a, b) => a.list.localeCompare(b.list) || a.entry.localeCompare(b.entry)
  );
}

// `rev` is a git object prefix: "HEAD:" for the last commit, ":" for the
// index. Returns null when the file does not exist at that revision, for
// example in the first commit that adds it.
export function readAtRevision(rev: string, path: string): string | null {
  try {
    return execFileSync("git", ["show", `${rev}${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}
