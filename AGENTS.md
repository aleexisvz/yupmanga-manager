# AGENTS.md

Guide for agents (Claude Code, Codex, etc.) working in this repository.

## Git workflow

### Local work: free
- Make as many commits as you need, and create or delete branches.
- Every change goes in a new branch created from an up-to-date `main` (for example `feat/...`, `fix/...`, `test/...`). Never commit important changes directly to `main`.
- Use Conventional Commits (`feat(scope): ...`, `fix: ...`, `test: ...`), following the existing history.
- Update the docs in the same branch when behavior or commands change.

### Approval gate: push, PR and merge in one decision
- When the change is ready locally, stop and tell the user the branch, the commits, and how to test them. Ask for one decision covering the push, the PR and the merge.
- On approval, do all of it in one pass: push the branch, open the PR with the full description, merge it with a merge commit, update local `main`, and delete the feature branch both locally and on the remote.
- Never push, open a PR or merge before that approval. An approval covers that change only, not later ones.
- If the user asks for only part of the flow (for example, just the push), do only that part.

### Pull requests
- Every change reaches `main` through a Pull Request. Never push directly to `main`.
- The PR description has these sections:
  - **Summary**: what problem it solves.
  - **What changed**: the main changes.
  - **Reviewer notes**: decisions, risks and limitations.
  - **Testing**: what was verified (typecheck, tests, real run) and what was not.
- Merge with a merge commit, following the history: the subject is `<PR title> (#N)`, and the body summarizes the PR's changes.

## Useful commands

```bash
npm run dev      # Interactive CLI
npm test         # vitest
npx tsc --noEmit # typecheck
```
