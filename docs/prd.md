# Skill Scope PRD

2026-11-19 · Draft

Terms are defined in [GLOSSARY.md](../GLOSSARY.md).

## 1. Problem Statement

Teams spend a lot of time writing and revising CLAUDE.md, AGENTS.md, skills and subagents, but nobody knows whether they actually work in day-to-day sessions. Three questions go unanswered:

- Is a skill used when it should be? Is it triggered when it shouldn't be?
- Of the dozens of rules in a rule file, which ones never come into play, and which ones the agent keeps breaking?
- After a revision, did things get better or worse?

Existing tools don't answer these questions:
- **Skill evaluation tools** (skillgrade, Caliper, skill-creator, `claude plugin eval`, etc.) run prepared tasks in a sandbox and never look at real sessions.
- **The few tools that read real sessions**: Claude Code's `/skill-doctor` only counts invocations and context cost; warpdotdev's skill-doctor gives each session one overall compliance score. None of them judges rules one by one or compares before and after a change.

So whether a change helped is currently a matter of gut feeling. For details on existing tools, see [explore/evaluation-mechanisms.md](explore/evaluation-mechanisms.md).

## 2. Target Users

| User | Who | Cares about |
|---|---|---|
| **Skill / rule author** | Writes and maintains skills, rule files and subagents; usually the team member most familiar with agents, or the lead | Whether what they wrote is used correctly; how a change performs |
| **Team member** | Writes code with Claude Code, Codex or other agents every day | Low setup cost and no slowdown of the agent; their code and sessions must not leak |

## 3. User Stories

### Must

**US1 · Install once, then forget it**
As a developer who codes with Claude Code or Codex every day, I want to install and log in once and then not think about it, so that I keep working as usual and the team can still see how our skills and rules perform.
- [ ] One command installs, logs in and joins the team.
- [ ] It finds the agents installed on my machine without manual configuration.
- [ ] Using the agent feels no slower after installation.
- [ ] After a session ends, results appear on the team web page without any action from me.

**US2 · Code and conversations never leak**
As a developer, I want to be sure my code and my conversations with the agent are not uploaded anywhere, so that I can keep it running on work projects.
- [ ] My raw conversations and code never leave my machine.
- [ ] I can see what has been uploaded at any time.
- [ ] No conversation excerpt and none of my personal files are uploaded without my approval.

**US3 · See how my work performs in real use**
As someone who writes skills, subagents or rule files for the team, I want to see an evaluation result for each skill, each subagent and each rule in real work, so that I know which ones help and which need changes.
- [ ] Every skill, subagent and rule has its own evaluation result.
- [ ] The evaluation result shows where the problem is.
- [ ] I can trace a result back to the related conversation excerpts (those members approved).

**US4 · Better or worse after a change**
As someone who just edited a skill or rule file, I want to compare evaluation results before and after the change, so that I know whether the change is worth keeping.
- [ ] Selecting a file shows a comparison between its versions.
- [ ] The interface says clearly when there is not yet enough data to draw a conclusion.

### Should

**US5 · Team-wide view**
As a team lead, I want a summary of evaluation results across the team's skills, subagents and rule files, so that I can decide what to fix first.
- [ ] Results from all members' sessions are aggregated.
- [ ] I can filter by skill, subagent or rule file.

**US6 · Controlled spending**
As a developer, I want to choose the model used for grading and cap the spending, so that I never spend a lot without knowing.
- [ ] It works with a single configured model.
- [ ] I can set a spending cap and see the actual spend.

## 4. Success Metrics

| Metric | How to measure |
|---|---|
| Accurate evaluation results: agree with human judgment | Compare against human-labeled results |
| Setup cost: steps and time from install to the first result | Run the install flow in a clean environment |
| Impact on the agent: extra time added by hooks | Hook timing statistics |
| Grading cost: grading spend per session | Local spend log |
| Adapter coverage: every first-batch adapter parses real logs correctly | Per-adapter tests |

Concrete targets are set by each module owner.

## 5. Architecture and Technical Constraints

- Architecture diagram (shared by both run modes; modules and data flow): [archify/skill-scope-architecture](archify/skill-scope-architecture/index.html)
- Runtime connected mode data-flow sequence diagram (connecting to the server, then collecting data, grading and uploading): [archify/skill-scope-runtime-sequence](archify/skill-scope-runtime-sequence/index.html)

Each diagram's source is the `candidate.json` in the same folder; editing rules are in [archify/rule.md](archify/rule.md).

- Two run modes:
  - **Local mode**: the user starts grading manually through the CLI; the CLI calls the Adapter and Grader directly, results stay local, and no background process is needed.
  - **Runtime connected mode**: adds a background process (the Runtime daemon) to local mode. The connection follows multica: the CLI logs in through the browser to obtain a token, and the daemon registers with the server and stays connected. After each session the daemon queues it, calls the Adapter and Grader, enforces the spending cap, and uploads results read from the local store.
- Grading runs on the user's machine and raw sessions never leave it; the server receives only evaluation results and excerpts the user approved.
- Versions of skills, subagents and rule files are recorded by a hook when each session starts; sessions from before installation are not processed.
- The tech stack is TypeScript throughout; the CLI, server and web UI share one set of data structure definitions.
- Multiple agents: the adapter interface is open. The first batch supports Claude Code, Codex, Antigravity, DeepSeek Harness and WorkBuddy; other agents plug in later through the same interface. Per-agent log details are in [explore/agent-logs.md](explore/agent-logs.md).
- External dependencies: each agent's local log format and hook mechanism. These are not committed public interfaces and can change at any time.
- Deployment: the server can be self-hosted, and an official cloud is also operated.
- Risks: the biggest risks are adapters whose log formats have not yet been verified on a real install, and the official cloud.
- Quality: every change to the grading logic must be checked for accuracy regressions.

Open questions for module owners:
- What an evaluation result contains and how it is produced
- How to measure whether evaluation results are accurate
- How to split a Rule File into Rule Items
- How to compare versions fairly
- How each agent's adapter is implemented
- The server's team model and report format
- Whether, and how, local mode uploads its evaluation results

## 6. Scope

**What gets evaluated**: skills, subagents and rule files (down to each Rule Item). Hooks are out of scope; whether other plugin components are included will be decided later.

**Not doing**:
- Rule syncing and distribution: existing tools such as ruler, rulesync and agentsync already do this.
- User-facing pre-release testing: users cannot write their own test tasks or run experiments in Skill Scope.
- Causal claims: results show trends only and never claim "this change caused the difference".
