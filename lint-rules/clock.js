// Module and lib code takes the time as an argument, so a test can run it at
// a fixed moment ("Inject the clock" in CODING_STANDARDS.md). This rule
// reports `new Date()` with no arguments and `Date.now()` in non-test files
// under app/modules/ and app/lib/. The rule scopes itself by file name, so
// the config turns it on everywhere without an override list.

const SCOPE = /(^|\/)app\/(modules|lib)\//;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

const inScope = (filename) => {
  const path = filename.replaceAll("\\", "/");
  return SCOPE.test(path) && !TEST_FILE.test(path);
};

const isDate = (node) => node.type === "Identifier" && node.name === "Date";

const isDateNow = (callee) =>
  callee.type === "MemberExpression" &&
  !callee.computed &&
  isDate(callee.object) &&
  callee.property.name === "now";

const noAmbientClock = {
  meta: {
    type: "problem",
    messages: {
      ambient:
        "Take the time as an argument (`now: Date`) instead of reading the clock here. Callers pass it, and tests pass a fixed time.",
    },
  },
  create(context) {
    if (!inScope(context.filename)) return {};
    return {
      NewExpression(node) {
        if (isDate(node.callee) && node.arguments.length === 0) {
          context.report({ node, messageId: "ambient" });
        }
      },
      CallExpression(node) {
        if (isDateNow(node.callee)) {
          context.report({ node, messageId: "ambient" });
        }
      },
    };
  },
};

export default {
  meta: { name: "clock" },
  rules: { "no-ambient": noAmbientClock },
};
