import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RULE = "clock(no-ambient)";
const PLUGIN = fileURLToPath(new URL("./clock.js", import.meta.url));
const OXLINT = fileURLToPath(
  new URL("../node_modules/oxlint/bin/oxlint", import.meta.url)
);

type Diagnostic = { code: string; filename: string; message: string };

// Lints `source`, written to `path` inside a fresh directory, with only the
// clock rule turned on, and returns the clock rule's diagnostics.
function lint(path: string, source: string): Diagnostic[] {
  const dir = mkdtempSync(join(tmpdir(), "clock-rule-"));
  const file = join(dir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  const config = join(dir, ".oxlintrc.json");
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [PLUGIN],
      rules: { "clock/no-ambient": "error" },
    })
  );
  const result = spawnSync(
    process.execPath,
    [OXLINT, "-c", config, "--format", "json", path],
    { cwd: dir, encoding: "utf8" }
  );
  rmSync(dir, { recursive: true, force: true });
  const report = JSON.parse(result.stdout) as { diagnostics: Diagnostic[] };
  return report.diagnostics.filter((diagnostic) => diagnostic.code === RULE);
}

describe("clock/no-ambient", () => {
  it("reports new Date() with no arguments in a lib file", () => {
    const found = lint("app/lib/a.ts", "export const now = new Date();\n");

    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/take the time as an argument/i);
  });

  it("reports Date.now() in a module file", () => {
    const found = lint(
      "app/modules/billing/lib/a.ts",
      "export const now = Date.now();\n"
    );

    expect(found).toHaveLength(1);
  });

  it("reports new Date without parentheses", () => {
    expect(lint("app/lib/a.ts", "export const now = new Date;\n")).toHaveLength(
      1
    );
  });

  it("allows new Date(value)", () => {
    const source = "export const at = (iso: string) => new Date(iso);\n";

    expect(lint("app/lib/a.ts", source)).toEqual([]);
  });

  it("allows other Date members", () => {
    const source = 'export const at = Date.parse("2027-01-01");\n';

    expect(lint("app/lib/a.ts", source)).toEqual([]);
  });

  it("allows the clock in test files", () => {
    const source = "export const now = new Date(Date.now());\n";

    expect(lint("app/lib/a.test.ts", source)).toEqual([]);
    expect(lint("app/modules/billing/tests/a.test.tsx", source)).toEqual([]);
  });

  it("allows the clock outside app/modules and app/lib", () => {
    const source = "export const now = () => [new Date(), Date.now()];\n";

    expect(lint("app/routes/home.tsx", source)).toEqual([]);
    expect(lint("app/components/clock.tsx", source)).toEqual([]);
    expect(lint("scripts/seed.ts", source)).toEqual([]);
  });
});
