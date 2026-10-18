import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTaskReport, projectHook, taskPrompt, MAX_INPUT_BYTES, MAX_EVENT_BYTES } from '../src/hooks.mjs';

const taskId = 'abdffc43-2710-4a4b-86ae-530f6eb994cc';
const report = { taskId, outcome: 'completed', summary: 'Returned greeting: "Hello! Hope your day is going well."', verification: 'No tools were used', risks: 'None' };
const json = JSON.stringify(report);
const config = { taskId, claudeSessionId: taskId, parentId: 'parent' };

for (const [label, response] of [
  ['plain JSON', json],
  ['greeting before JSON', `Hello! Hope your day is going well.\n\n${json}`],
  ['fenced JSON after prose', `Done.\n\n\`\`\`json\n${json}\n\`\`\``],
  ['prose following JSON', `${json}\nThat is the report.`],
  ['unrelated JSON before matching report', `{"other":true}\n${json}`],
]) {
  test(`extracts exactly one matching bounded report: ${label}`, () => {
    assert.deepEqual(extractTaskReport(response, taskId), report);
    const event = projectHook({ session_id: taskId, hook_event_name: 'Stop', last_assistant_message: response }, config);
    assert.equal(event.report.outcome, 'completed');
    assert.equal(event.report.summary, report.summary);
    assert(!JSON.stringify(event).includes('That is the report.'));
  });
}

test('quotes, escaped backslashes and braces inside JSON strings do not break scanning', () => {
  const special = { ...report, summary: 'quoted "{ braces }" and a backslash \\ and an apostrophe \' here' };
  assert.deepEqual(extractTaskReport(`Finished.\n${JSON.stringify(special)}`, taskId), special);
});

test('malformed JSON with unescaped nested quotation marks is not repaired or declared successful', () => {
  const invalid = `{"taskId":"${taskId}","outcome":"completed","summary":"Greeting: "Hello!""}`;
  assert.equal(extractTaskReport(`Hello!\n${invalid}`, taskId), null);
  const event = projectHook({ session_id: taskId, hook_event_name: 'Stop', last_assistant_message: invalid }, config);
  assert.equal(event.report, undefined);
});

test('conflicting matching reports, wrong task, unknown outcome and missing summary fail closed', () => {
  assert.equal(extractTaskReport(`${json}\n${JSON.stringify({ ...report, outcome: 'failed' })}`, taskId), null);
  assert.equal(extractTaskReport(json, 'different-task'), null);
  assert.equal(extractTaskReport(JSON.stringify({ ...report, outcome: 'maybe' }), taskId), null);
  assert.equal(extractTaskReport(JSON.stringify({ taskId, outcome: 'completed' }), taskId), null);
});

test('oversized responses/reports and excess JSON objects are bounded', () => {
  assert.equal(extractTaskReport('a'.repeat(MAX_INPUT_BYTES + 1) + json, taskId), null);
  assert.equal(extractTaskReport(JSON.stringify({ ...report, summary: 'a'.repeat(MAX_EVENT_BYTES) }), taskId), null);
  assert.equal(extractTaskReport('{}\n'.repeat(65) + json, taskId), null);
});

test('prompt provides a valid JSON example and explicitly puts greeting inside summary', () => {
  const prompt = taskPrompt(taskId, 'Return a greeting');
  assert.match(prompt, /Put the requested answer or greeting inside summary/);
  assert.match(prompt, /escape any quotation marks/);
  const example = extractTaskReport(prompt, taskId);
  assert.equal(example.outcome, 'completed');
});
