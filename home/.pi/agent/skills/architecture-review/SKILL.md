---
name: architecture-review
description: Reviews code changes for release blockers, correctness risks, architecture quality, fit with existing project structure, and overengineering, then generates a standalone HTML review page. Use for code reviews, architectural assessments, implementation reviews, or /architecture-review.
compatibility: Requires Git for change-based reviews and Node.js 20 or newer for the HTML report.
---

# Architecture Review

Perform an evidence-based code and architecture review. Do not modify the implementation unless the user separately asks for fixes. The final deliverable is a standalone HTML review generated through the `generate-html` skill.

## 1. Establish scope

Use the first applicable scope:

1. The files, commit range, branch, pull request, or feature named by the user.
2. Staged changes when the index is non-empty.
3. Tracked working-tree changes when present.
4. The current project architecture when there are no changes.

State the chosen scope. Read repository instructions such as `AGENTS.md`, build manifests, architecture documentation, and relevant tests before judging the implementation.

## 2. Build the architecture baseline

Trace enough existing code to answer:

- Where are the entry points and ownership boundaries?
- What layers/modules exist, and which direction do dependencies flow?
- Where do similar features live today?
- How are state, persistence, errors, authorization, and external calls handled?
- Which tests encode the expected behavior?

Do not infer the intended architecture from folder names alone. Cite concrete paths and line numbers.

## 3. Review the implementation

Inspect changed code and its callers/callees. Check:

### Blockers and correctness

- broken behavior, crashes, data loss, security or authorization failures;
- invalid migrations, incompatible API/schema changes, race conditions, or leaked resources;
- missing required error paths or rollback behavior;
- failures that prevent build, test, deployment, or safe operation.

A **blocker** must be reproducible or supported by a concrete execution path. Do not call style preferences blockers.

### Architecture fit

- whether responsibilities live in the correct existing layer;
- whether dependency direction and module boundaries remain coherent;
- whether the implementation reuses established abstractions appropriately;
- whether it duplicates or conflicts with existing logic;
- how data and control flow through the old and new architecture;
- whether tests are placed at the right boundary.

### Overengineering and underengineering

Look specifically for:

- abstractions with only one speculative use;
- factories, adapters, configuration, or indirection without a current requirement;
- new dependencies when existing code or the standard library is sufficient;
- generalized frameworks built for a narrow feature;
- duplicated models or unnecessary state synchronization;
- missing boundaries where complexity or risk genuinely requires one.

Prefer the simplest implementation that satisfies current requirements and matches repository conventions. Explain the concrete maintenance cost of any complexity you criticize.

## 4. Validate

Run the narrowest relevant static checks and tests available. Do not hide failures. Separate:

- verified behavior;
- findings based on static evidence;
- risks that could not be validated.

## 5. Grade findings

Use these levels consistently:

- **Blocker** — unsafe or impossible to merge/deploy without correction.
- **Major** — significant correctness or architectural defect that should be fixed.
- **Minor** — bounded maintainability, testing, or design issue.
- **Suggestion** — optional simplification or improvement.

Every finding must include:

1. concise title and severity;
2. evidence with file and line references;
3. impact or failure scenario;
4. smallest reasonable correction.

Exclude vague advice and findings without actionable evidence.

## 6. Produce the report

Write a Markdown report using this structure:

```markdown
# Architecture Review: <scope>

> Verdict: BLOCK | CHANGES REQUESTED | APPROVE

## Executive summary
## Scope and validation
## Blockers
## Major findings
## Architecture fit
## Overengineering assessment
## Minor findings and suggestions
## What was done well
## Recommended next steps
## Evidence reviewed
```

Write `None found` under empty finding sections. Include a concise explanation of how the implementation fits into the existing request/data/control flow.

Then load and follow the `generate-html` skill to render and open the report. Return:

- the verdict;
- blocker and major-finding counts;
- the absolute HTML path and `file://` URL;
- tests/checks run and any validation gaps.
