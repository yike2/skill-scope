# Skill Scope

Glossary for Skill Scope. For the product description, see [docs/prd.md](docs/prd.md).

## Terms

### What gets evaluated

**Skill**:
A packaged instruction set loaded on demand (for example a `SKILL.md` and its files), which the agent chooses to load when a task matches.
_Avoid_: tool, prompt

**Subagent**:
A named agent definition that the main agent can delegate a task to.

**Rule File**:
An instruction file loaded in every session, such as `CLAUDE.md` or `AGENTS.md`.
_Avoid_: memory file, config

**Rule Item**:
A single instruction inside a **Rule File**. Evaluation goes down to individual items rather than the file as a whole.
_Avoid_: rule, point, line

### Observation and evaluation

**Session**:
One complete record of a user working with a coding agent, from the first input to the end.
_Avoid_: conversation, trace, transcript, run

**Evaluation Result**:
Skill Scope's evaluation of how a **Skill**, **Subagent** or **Rule Item** performed in real use; the core output of the system.
_Avoid_: score, report, verdict

**Grader**:
The component that produces **Evaluation Results** on the user's machine.
_Avoid_: judge, evaluator

### Run modes

**Local mode**:
The user starts grading manually through the CLI; results stay on the machine and no background process is needed.

**Runtime connected mode**:
The CLI connects to the team server; after each session a background process grades automatically and uploads the results.

## Relationships

- A **Rule File** contains many **Rule Items**
- A **Session** records the versions of the skills, subagents and rule files in effect when it started
- The **Grader** produces **Evaluation Results** for **Skills**, **Subagents** and **Rule Items** from **Sessions**
