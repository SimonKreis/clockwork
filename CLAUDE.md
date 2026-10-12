Read AGENTS.md. It is the single source of truth for this repository and is not duplicated here.

## Claude Code specifics

- Skills live in `.claude/skills/` and are mirrored to `.agents/skills/` for other harnesses. Keep
  the two in sync when you edit one.
- `CONTEXT.md` holds the decision state. Read it before proposing work: it records what is
  settled, what was rejected and why, and the open questions with confidence levels.
- This project requires no MCP server and no external service.
