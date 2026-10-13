# Verification contract

Before running checks, read the applicable repository guidance and choose the smallest checks
that can disprove the claimed result. A successful build proves a build, not a user flow.

For Lio, identified from its repository guidance rather than a hard-coded absolute checkout:
- Read `docs/engineering/browser-verification.md` for UI environment, tenant/role, evidence,
  authentication and authorised mutations.
- Read the tracked `.skillshare/skills/verify-asklio/SKILL.md` and relevant feature-map entries
  for existing browser flows, or the documented `e2e-verify`/task-stack route when appropriate.
  Missing personal skill registration does not prevent reading the tracked source.
- Read scoped backend/frontend guides and test instructions. Frontend checks and browser probes
  do not authorise adding Jest/React Testing Library tests.
- Backend integration tests use the repository's documented isolated runner, not an arbitrary
  MongoDB URL. Never reset shared data to get a passing check.

In other repositories, find their equivalent commands and existing verification harness.
Do not install a new harness merely because this pack is enabled.

Match proof to behaviour:
- Bugs: original failing trigger, then the same trigger after the fix.
- Persistence: exercise an authorised production API/UI path and read the result back.
- UI: relevant roles/flags/states, real navigation when claimed, and inspected visual evidence.
- Migrations/contracts: realistic saved inputs and relevant old/new consumers.
- Performance: equivalent workloads, correct output/work counts and repeated measurements;
  do not promote a noisy single run into a speedup claim.

Record exact code state, command/flow, expected and observed result, environment and limits.
Reuse existing evidence locations; curate secrets and customer data before showing artifacts.
Mark each criterion verified, failed, partial or blocked. Source inspection and runtime proof
are different evidence levels. A missing test or login is not proof of safety.

A regression test or probe should fail for the intended reason on the old behaviour and pass
on the fix. Tests need not be separate failing commits. Respect repository test restrictions,
and use temporary probes when committed tests are inappropriate.
