// Fails when a module under app/modules/ has no test file in its tests/
// folder. Modules are tested through their entry points (see
// app/modules/README.md), so a module without tests has nothing checking it.
// Reads the index, so it checks what is about to be committed.
// Usage: node scripts/check-module-tests.ts

import { execFileSync } from "node:child_process";

const MODULES_ROOT = "app/modules/";
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

// The modules, by folder name, that have no test file anywhere under their
// tests/ folder. `paths` are repository-relative, with forward slashes.
export function modulesWithoutTests(paths: string[]): string[] {
  const modules = new Set<string>();
  const tested = new Set<string>();
  for (const path of paths) {
    if (!path.startsWith(MODULES_ROOT)) continue;
    const [name, ...rest] = path.slice(MODULES_ROOT.length).split("/");
    if (rest.length === 0) continue; // a file such as README.md, not a module
    modules.add(name);
    if (rest[0] === "tests" && TEST_FILE.test(path)) tested.add(name);
  }
  return [...modules].filter((name) => !tested.has(name)).sort();
}

if (import.meta.main) {
  const paths = execFileSync("git", ["ls-files", "-z", MODULES_ROOT], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  const untested = modulesWithoutTests(paths);
  if (untested.length > 0) {
    for (const name of untested) {
      console.error(
        `${MODULES_ROOT}${name} has no test file in ${MODULES_ROOT}${name}/tests/.`
      );
    }
    console.error(
      "Every module ships tests. Test it through its entry points: see app/modules/README.md."
    );
    process.exit(1);
  }
}
