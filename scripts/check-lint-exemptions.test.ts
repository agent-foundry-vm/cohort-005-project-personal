import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkExemptions } from "./check-lint-exemptions";

const HEAD = `{
  // A comment, and a glob that looks like one: **/*.test.ts
  "rules": { "max-lines": ["error", { "max": 500 }] },
  "overrides": [
    {
      "files": ["**/*.test.ts", "**/*.test.tsx"],
      "rules": { "max-lines-per-function": "off" }
    },
    /* Files already over a size limit. */
    {
      "files": ["app/routes/a.tsx", "app/routes/b.tsx"],
      "rules": { "max-lines": "off", "max-params": "off" }
    }
  ]
}`;

describe("checkExemptions", () => {
  it("reports a path added to an override's files list, with each rule it turns off", () => {
    const staged = HEAD.replace(
      `"app/routes/b.tsx"]`,
      `"app/routes/b.tsx", "app/routes/c.tsx",]`
    );

    expect(checkExemptions(HEAD, staged)).toEqual([
      { list: "max-lines", entry: "app/routes/c.tsx" },
      { list: "max-params", entry: "app/routes/c.tsx" },
    ]);
  });

  it("passes when a path is removed", () => {
    const staged = HEAD.replace(`"app/routes/a.tsx", `, "");

    expect(checkExemptions(HEAD, staged)).toEqual([]);
  });

  it("passes when the lists are unchanged", () => {
    expect(checkExemptions(HEAD, HEAD)).toEqual([]);
  });

  it("passes when a path moves to another override for the same rule", () => {
    const staged = HEAD.replace(`"app/routes/a.tsx", `, "").replace(
      `"rules": { "max-lines": "off", "max-params": "off" }`,
      `"rules": { "max-lines": "off", "max-params": "off" }
    },
    {
      "files": ["app/routes/a.tsx"],
      "rules": { "max-params": "off", "max-lines": "off" }`
    );

    expect(checkExemptions(HEAD, staged)).toEqual([]);
  });

  it("reports every path of an override that gains a rule", () => {
    const staged = HEAD.replace(
      `"rules": { "max-lines-per-function": "off" }`,
      `"rules": { "max-lines-per-function": "off", "max-depth": "off" }`
    );

    expect(checkExemptions(HEAD, staged)).toEqual([
      { list: "max-depth", entry: "**/*.test.ts" },
      { list: "max-depth", entry: "**/*.test.tsx" },
    ]);
  });
});

describe("node scripts/check-lint-exemptions.ts", () => {
  const script = fileURLToPath(
    new URL("./check-lint-exemptions.ts", import.meta.url)
  );

  function repoWithConfig(config: string) {
    const dir = mkdtempSync(join(tmpdir(), "lint-exemptions-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    git("init", "--quiet");
    writeFileSync(join(dir, ".oxlintrc.json"), config);
    git("add", ".oxlintrc.json");
    git(
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--quiet",
      "-m",
      "init"
    );
    return { dir, git };
  }

  function stageAndRun(config: string) {
    const { dir, git } = repoWithConfig(HEAD);
    writeFileSync(join(dir, ".oxlintrc.json"), config);
    git("add", ".oxlintrc.json");
    const result = spawnSync(process.execPath, [script], {
      cwd: dir,
      encoding: "utf8",
    });
    rmSync(dir, { recursive: true, force: true });
    return result;
  }

  it("fails a staged config that adds a path, naming the path and the rule", () => {
    const result = stageAndRun(
      HEAD.replace(
        `"app/routes/b.tsx"]`,
        `"app/routes/b.tsx", "app/routes/c.tsx"]`
      )
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("app/routes/c.tsx: max-lines");
    expect(result.stderr).toContain("app/routes/c.tsx: max-params");
  });

  it("passes a staged config that removes a path", () => {
    const result = stageAndRun(HEAD.replace(`"app/routes/a.tsx", `, ""));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});

describe("the repository's own oxlint config", () => {
  it("parses, with its comments, into exemption lists", () => {
    const config = readFileSync(
      new URL("../.oxlintrc.json", import.meta.url),
      "utf8"
    );
    const nothing = `{ "overrides": [] }`;

    expect(checkExemptions(nothing, config)).toContainEqual({
      list: "max-lines-per-function",
      entry: "**/*.test.ts",
    });
  });
});
