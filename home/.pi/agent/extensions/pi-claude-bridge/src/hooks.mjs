import { randomUUID } from 'node:crypto';

export const HOOKS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'Stop', 'StopFailure', 'SessionEnd'];
export const MAX_EVENT_BYTES = 16384;
export const MAX_INPUT_BYTES = 1048576;

// Defense in depth only: never claim regex redaction is a secret boundary.
export function safeText(value, max = 1200) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{16})\b/g, '[redacted credential]')
    .replace(/\b(authorization|api[_-]?key|password|secret|token)\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .slice(0, max);
}

// Scan complete top-level objects, respecting braces and escaped quotes inside
// JSON strings. Never regex-match arbitrary prose into a completion report.
export function extractTaskReport(text, taskId) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) return null;
  let start = -1, depth = 0, inString = false, escaped = false, candidates = 0;
  const matches = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (start < 0) {
      if (ch === '{') { start = i; depth = 1; }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      if (++candidates > 64) return null;
      const candidate = text.slice(start, i + 1);
      start = -1;
      if (Buffer.byteLength(candidate, 'utf8') > MAX_EVENT_BYTES) continue;
      try {
        const report = JSON.parse(candidate);
        if (report.taskId === taskId && ['completed', 'failed', 'needs_input'].includes(report.outcome) && typeof report.summary === 'string') matches.push(report);
      } catch { /* Invalid JSON is not repaired or treated as task success. */ }
    }
  }
  // Multiple matching objects could contradict each other: fail closed.
  return matches.length === 1 ? matches[0] : null;
}

export function projectHook(input, config) {
  if (!input || input.session_id !== config.claudeSessionId || input.agent_id || !HOOKS.includes(input.hook_event_name)) return null;
  const event = {
    version: 1, id: randomUUID(), taskId: config.taskId,
    parentId: config.parentId, claudeSessionId: config.claudeSessionId,
    type: input.hook_event_name, at: Date.now(),
  };
  if (input.hook_event_name === 'UserPromptSubmit') {
    // Correlate the first bounded task, not arbitrary later user turns.
    event.matchesTask = typeof input.prompt === 'string' && input.prompt.includes(`[bridge-task:${config.taskId}]`);
  }
  if (['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure'].includes(event.type)) {
    event.tool = /^[A-Za-z0-9_.:-]{1,120}$/.test(input.tool_name ?? '') ? input.tool_name : 'unknown';
    if (event.type === 'PreToolUse' && input.tool_name === 'AskUserQuestion') event.needsInput = true;
  }
  if (event.type === 'SessionStart') event.model = safeText(input.model, 120);
  if (event.type === 'Notification') event.permission = input.notification_type === 'permission_prompt';
  if (event.type === 'Stop') {
    event.backgroundPending = (Array.isArray(input.background_tasks) && input.background_tasks.length > 0) || (Array.isArray(input.session_crons) && input.session_crons.length > 0);
    // A Stop callback is a candidate, not a verified successful task.
    const report = extractTaskReport(input.last_assistant_message, config.taskId);
    if (report) {
      event.report = {
        outcome: report.outcome, summary: safeText(report.summary),
        verification: safeText(report.verification, 600), risks: safeText(report.risks, 600),
      };
    }
    // Surrounding free-form prose is deliberately not retained or forwarded.
  }
  if (event.type === 'StopFailure') event.error = /^[a-z_]{1,80}$/.test(input.error ?? '') ? input.error : 'unknown';
  return event;
}

export function taskPrompt(taskId, task) {
  const example = JSON.stringify({ taskId, outcome: 'completed', summary: 'Concise result goes here', verification: 'What you actually checked', risks: 'Remaining issues or none' });
  return `[bridge-task:${taskId}]\n${task}\n\nThis is one bounded bridge task. Do not start background work, schedules, or delegate to other agents. Keep native permission prompts enabled; a human answers them in this pane. Never include secrets or credentials in your final report. Finish with one valid JSON object only (no markdown or separate greeting). Put the requested answer or greeting inside summary. Use double-quoted JSON keys and strings; escape any quotation marks inside string values. Use outcome completed, failed, or needs_input as appropriate. Exact report shape:\n${example}\nCompletion is a self-report, not independent verification.`;
}

export function hookSettings(relayPath, configPath, nodePath) {
  // Shell form supports existing CLI versions; each fixed path is quoted.
  const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
  const command = [nodePath, relayPath, configPath].map(quote).join(' ');
  return { hooks: Object.fromEntries(HOOKS.map(type => [type, [{ hooks: [{ type: 'command', command, timeout: 3 }] }]])) };
}
