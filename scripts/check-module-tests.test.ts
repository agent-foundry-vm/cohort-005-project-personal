import { describe, expect, it } from "vitest";
import { modulesWithoutTests } from "./check-module-tests";

describe("modulesWithoutTests", () => {
  it("passes when every module has a test file in tests/", () => {
    expect(
      modulesWithoutTests([
        "app/modules/README.md",
        "app/modules/example/index.ts",
        "app/modules/example/tests/example.test.ts",
        "app/modules/forms/index.tsx",
        "app/modules/forms/tests/nested/form.test.tsx",
      ])
    ).toEqual([]);
  });

  it("names a module with no tests/ folder", () => {
    expect(
      modulesWithoutTests([
        "app/modules/lesson-page/index.server.ts",
        "app/modules/lesson-page/lesson.ts",
      ])
    ).toEqual(["lesson-page"]);
  });

  it("names a module whose tests/ folder holds only fixtures", () => {
    expect(
      modulesWithoutTests([
        "app/modules/billing/index.ts",
        "app/modules/billing/tests/fixtures.ts",
        "app/modules/billing/lib/billing.test.ts",
      ])
    ).toEqual(["billing"]);
  });

  it("names each failing module once, sorted", () => {
    expect(
      modulesWithoutTests([
        "app/modules/zeta/index.ts",
        "app/modules/zeta/lib/a.ts",
        "app/modules/alpha/index.ts",
        "app/modules/ok/tests/ok.test.ts",
      ])
    ).toEqual(["alpha", "zeta"]);
  });
});
