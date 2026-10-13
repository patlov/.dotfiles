import assert from "node:assert/strict";
import test from "node:test";
import { containsGitCommand, containsGitCommit, containsGitNoVerify, unsafeCommitShape } from "../git-command.ts";
import { cloakSecrets, findSecrets } from "../secret-patterns.ts";

const fakeGoogleKey = `AIza${"A".repeat(35)}`;

test("detects and cloaks provider keys", () => {
  assert.equal(findSecrets(`api_key = "${fakeGoogleKey}"`).length > 0, true);
  const result = cloakSecrets(`api_key = "${fakeGoogleKey}"`);
  assert.equal(result.text.includes(fakeGoogleKey), false);
  assert.match(result.text, /REDACTED/);
});

test("detects generic literal credential assignments", () => {
  const fakeSecret = ["this", "is", "a", "real", "looking", "secret"].join("-");
  assert.equal(findSecrets(`client_secret: "${fakeSecret}"`).length, 1);
});

function assignment(value: string, name = "apiKey"): string {
  return `const ${name} = ${value};`;
}

test("ignores complete unquoted runtime calls and member references", () => {
  const expressions = [
    "this.getApiKey()",
    "this.getToken()",
    "this.apiKeyValue",
    "getCredential()",
    'localStorage.getItem("stored-api-key")',
    "window.localStorage.getItem('stored-api-key')",
    'normalize(localStorage.getItem("stored-api-key"))',
    'normalize(localStorage.getItem("stored-api-key") ?? "")',
    'this["apiKeyValue"]',
  ];
  for (const expression of expressions) {
    const source = assignment(expression);
    assert.deepEqual(findSecrets(source), [], expression);
    assert.equal(cloakSecrets(source).text, source);
  }
});

test("ignores locally declared credential references", () => {
  for (const expression of ["runtimeApiKey", "runtimeOptions.apiKey", 'runtimeOptions["apiKey"]']) {
    const source = [
      assignment("this.getApiKey()", "runtimeApiKey"),
      assignment("loadOptions()", "runtimeOptions"),
      assignment(expression),
    ].join("\n");
    assert.deepEqual(findSecrets(source), [], expression);
  }
});

test("detects quoted and unquoted literal secrets despite runtime-looking text", () => {
  const literals = [
    ["opaque", "credential", "value"].join(""),
    ["opaque", "credential", "value"].join("."),
    ["this.getApiKey()", "literal-secret"].join("-"),
    ["this.getApiKey()", "opaquecredentialvalue"].join("??"),
    ["this.getApiKey()", "opaquecredentialvalue"].join("||"),
    ["localStorage.getItem", "literal-secret"].join("-"),
    ["runtimeApiKey", "literal-secret"].join("-"),
  ];
  for (const literal of literals) {
    for (const value of [literal, `"${literal}"`, `'${literal}'`]) {
      const source = assignment(value);
      assert.equal(findSecrets(source).length, 1, value);
      assert.equal(cloakSecrets(source).text.includes(literal), false, value);
    }
  }
  // Quoting a runtime expression makes it a literal, not a lookup.
  assert.equal(findSecrets(assignment(`"${"this.getApiKey()"}"`)).length, 1);
});

test("mixed runtime references and literal secrets still produce blocking findings", () => {
  const literal = ["opaque", "credential", "value"].join("-");
  for (const value of [literal, `"${literal}"`]) {
    for (const separator of ["\n", " "]) {
      const source = [
        assignment("this.getApiKey()"),
        assignment(value, "token"),
        assignment('localStorage.getItem("stored-password")', "password"),
      ].join(separator);
      const findings = findSecrets(source);
      assert.deepEqual(findings, [{ label: "credential assignment", value: literal }]);
      const cloaked = cloakSecrets(source);
      assert.equal(cloaked.count, 1);
      assert.equal(cloaked.text.includes(literal), false);
      assert.equal(cloaked.text.includes("this.getApiKey()"), true);
    }
  }
});

test("does not ignore long literals inside storage lookup wrappers", () => {
  const literal = ["opaque", "credential", "value"].join("-");
  const expression = `normalize(localStorage.getItem("stored-key") ?? "${literal}")`;
  assert.equal(findSecrets(assignment(expression)).length > 0, true);
});

test("provider signatures remain detected inside runtime-looking expressions", () => {
  const source = assignment(`localStorage.getItem("${fakeGoogleKey}")`);
  assert.equal(findSecrets(source).some((match) => match.value === fakeGoogleKey), true);
  assert.equal(cloakSecrets(source).text.includes(fakeGoogleKey), false);
});

test("ignores environment references and placeholders", () => {
  assert.deepEqual(findSecrets('api_key = "$GEMINI_API_KEY"'), []);
  assert.deepEqual(findSecrets("apiKey = config.google_search_api_key"), []);
  assert.deepEqual(findSecrets('token: "<redacted>"'), []);
});

test("recognizes git commands and commits", () => {
  assert.equal(containsGitCommand("git status"), true);
  assert.equal(containsGitCommit("git commit -m test"), true);
  assert.equal(containsGitCommand("echo digit"), false);
});

test("scopes no-verify detection to Git commands", () => {
  assert.equal(containsGitNoVerify("git commit --no-verify"), true);
  assert.equal(containsGitNoVerify("grep --no-verify AGENTS.md && git status"), false);
});

test("requires staging and commit to use separate tool calls", () => {
  assert.match(unsafeCommitShape("git add . && git commit -m test") ?? "", /separate/);
  assert.match(unsafeCommitShape("git commit -am test") ?? "", /bypasses/);
  assert.equal(unsafeCommitShape("git commit -m test"), undefined);
});
