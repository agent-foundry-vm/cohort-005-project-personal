// Runs the real `.dependency-cruiser.cjs` rules against small planted trees,
// so each boundary rule is shown failing on an offender and passing without one.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cruise, type IConfiguration } from "dependency-cruiser";

const require = createRequire(import.meta.url);
const config = require("../.dependency-cruiser.cjs") as IConfiguration;

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

/** Writes `files` into a fresh temp project and returns the rule names it breaks. */
async function violations(files: Record<string, string>): Promise<string[]> {
  root = mkdtempSync(join(tmpdir(), "boundaries-"));
  const all = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        module: "ES2022",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        verbatimModuleSyntax: true,
        paths: { "~/*": ["./app/*"] },
      },
    }),
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  const result = await cruise(["app"], {
    ...config.options,
    validate: true,
    ruleSet: { forbidden: config.forbidden },
    baseDir: root,
    tsConfig: { fileName: join(root, "tsconfig.json") },
  });
  if (typeof result.output === "string") throw new Error(result.output);
  return result.output.summary.violations.map((v) => v.rule.name).sort();
}

const COMPONENT = {
  "app/components/comment-thread.tsx":
    "export type Comment = { id: number };\nexport function CommentThread() { return null; }\n",
};

describe("modules-no-components", () => {
  it("fails when a module file imports a value from a component", async () => {
    expect(
      await violations({
        ...COMPONENT,
        "app/modules/feedback/index.ts":
          'import { CommentThread } from "~/components/comment-thread";\nexport const x = CommentThread;\n',
      })
    ).toEqual(["modules-no-components"]);
  });

  it("fails on a type-only import, from a module's lib/ too", async () => {
    expect(
      await violations({
        ...COMPONENT,
        "app/modules/feedback/lib/queries.ts":
          'import type { Comment } from "~/components/comment-thread";\nexport const c: Comment[] = [];\n',
      })
    ).toEqual(["modules-no-components"]);
  });

  it("allows a component to import a type from a module", async () => {
    expect(
      await violations({
        "app/modules/feedback/index.ts":
          "export type Comment = { id: number };\n",
        "app/components/comment-thread.tsx":
          'import type { Comment } from "~/modules/feedback";\nexport const c: Comment[] = [];\n',
      })
    ).toEqual([]);
  });
});

describe("no-circular", () => {
  it("fails on a cycle of value imports", async () => {
    expect(
      await violations({
        "app/lib/a.ts":
          'import { b } from "~/lib/b";\nexport const a = () => b;\n',
        "app/lib/b.ts":
          'import { a } from "~/lib/a";\nexport const b = () => a;\n',
      })
    ).toEqual(["no-circular"]);
  });

  it("ignores a cycle closed by a type-only import", async () => {
    expect(
      await violations({
        "app/lib/a.ts":
          'import { b } from "~/lib/b";\nexport type A = number;\nexport const a = () => b;\n',
        "app/lib/b.ts":
          'import type { A } from "~/lib/a";\nexport const b: A = 1;\n',
      })
    ).toEqual([]);
  });
});
