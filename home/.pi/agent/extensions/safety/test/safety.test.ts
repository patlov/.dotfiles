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
