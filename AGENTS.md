# Agent context

Splatastrophe reconstructs real buildings from photographs as Gaussian splats and presents them in an interactive animation playground.

## Single source of truth

Read [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) before planning or implementing work. It is the sole maintained source for scope, architecture, decisions, milestones, budget, evaluation, and project-level implementation status. Update it when those change; keep this file as a short entry point rather than duplicating the plan or creating parallel roadmaps. GitHub Issues track individual tasks under that plan. Record completed work only when supported by code or experimental evidence.

The original proposals are historical references, not current requirements. Paper figures and product mockups are not implementation results.

## Research and data

Read the plan's [research and dataset context](docs/IMPLEMENTATION_PLAN.md#research-and-dataset-context), then the relevant paper/method section before changing that stage. Local paper PDFs are linked there.

- Distinguish appearance reconstruction (3DGS), geometric decomposition (DBW), and material simulation (PhysGaussian). Their adapters are project work, not assumed compatibility.
- Keep manual baselines, automatic experiments, simulated physics, and approximate visual effects clearly identified.
- Use the plan's dataset guidance; record the exact scene/version, camera provenance, split, scale, and attribution in its configuration. Keep large datasets/checkpoints outside Git.
- Validate a small complete path through export and browser playback before scaling GPU jobs or adding buildings. Log reproducible settings, results, limitations, and compute cost.

## Agent coordination: Slack and GitHub Issues

Use [GitHub Issues](https://github.com/SriyaKan/Splatastrophe/issues) to track tasks. Send all agent registrations, claims, updates, blockers, and handoffs **only to [#agent-coordination](https://splatastrophecs180.slack.com/archives/C0CJJHL4XJP)**. Do not post agent messages in `#all-splatastrophecs180` or other channels unless the human explicitly requests a specific exception.

- Before planning or editing, read the current `#agent-coordination` history and the full relevant threads, including handoffs addressed to your agent or human owner, alongside current GitHub issues and PRs. Confirm the channel's current assignments and interface agreements; repository inspection alone does not establish ownership.
- Register a unique agent name and human owner, claim a task, and record its issue, scope, branch, and affected files in `#agent-coordination`. Resolve overlapping claims before proceeding. A merged PR does not by itself transfer ownership of another agent's files; obtain agreement before changing their owned files or shared interfaces.
- Break work into small issues with one responsible agent, dependencies, and clear acceptance checks. Keep issue status current: in progress, blocked, review, or done. Reflect project decisions and verified milestones in the implementation plan.
- Use separate branches and checkouts/worktrees for concurrent tasks (`codex/` branches for Codex). Agree on shared-file or interface changes with their owner; never overwrite another agent's work.
- Keep one `#agent-coordination` thread per issue. Before posting, find and read the existing issue thread; create a top-level root only for a new issue with no thread. Record its permalink in the GitHub issue so other agents can find it.
- Post registrations, claims, progress, blockers, acknowledgments, handoffs, and checkpoints as replies in that issue's thread. Use the parent message's `thread_ts` and leave `reply_broadcast` false. Start another top-level message or broadcast a reply only when the human explicitly requests that announcement.
- Prefix messages with `[agent-name]` and include the issue link, branch/scope, status, brief update, artifact/test results, and next action. Address handoffs to a named agent and use the channel's REQUEST / ACK / BLOCKED / DONE format when applicable. Post only meaningful changes or requests; copy decisions back to the issue.
- Address handoffs to a named agent and wait for acknowledgment before transferring ownership. End sessions with a checkpoint. Mark work done only when acceptance checks and required integration are complete, with evidence linked.

If the coordination channel, relevant thread, or GitHub access is unavailable, tell the human owner and resolve ownership before overlapping work. Do not substitute a different Slack channel or assume there are no handoffs. These instructions do not make agents listen continuously; automatic exchanges need a runner that routes addressed tasks, deduplicates events, ignores its own messages, and limits reply chains.
