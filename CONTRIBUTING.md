# Contributing to GraphLoom

Thanks for your interest! GraphLoom is in pre-alpha; the ground rules below
apply from day one and will grow as the codebase does.

## Ground rules

1. **Read the constitution first.** The
   [master specification](docs/prompts/master_prompt.md) and the
   [ADRs](docs/adr/README.md) define non-negotiable constraints. The big ones:
   - No business logic in framework wrappers (`@graphloom/angular`, `@graphloom/react`).
   - D3 may never touch the DOM — math-only micro-packages, enforced by lint
     (ADR-0006).
   - All model mutations go through the command bus; no public mutable model
     API (ADR-0001).
   - Strict TypeScript; no `any` unless genuinely unavoidable (justify in a
     comment).
   - Every public API ships with TSDoc and tests.
2. **Work is tracked.** Tasks live in the
   [implementation tracker](docs/plans/implementation-tracker.html). Reference
   the task ID (e.g. `P3-T04`) in your PR description.
3. **Architecture changes need an ADR.** If your change alters a decision
   recorded in `docs/adr/`, write a superseding ADR and discuss it in an issue
   before implementing.

## Development setup

- **Node**: version in `.nvmrc` (24 LTS). With nvm: `nvm use`.
- **pnpm**: `corepack enable pnpm` — the version is pinned via `packageManager`
  in the root `package.json`.
- **Install**: `pnpm install`. This also wires the git hooks
  (`core.hooksPath .githooks`) so commitlint runs on `commit-msg`.

Workspace commands (Nx-cached; run from the repo root):

| Command          | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| `pnpm build`     | tsup ESM builds for all packages + Vite build of `apps/examples`    |
| `pnpm test`      | Vitest with v8 coverage (80% threshold, ramping to 95%)             |
| `pnpm lint`      | ESLint incl. architectural boundary rules, then the fixture proof   |
| `pnpm typecheck` | `tsc -b` over the whole project-reference graph                     |
| `pnpm e2e`       | Playwright against `apps/examples` (Chromium/Firefox/WebKit)        |
| `pnpm pkgcheck`  | publint + arethetypeswrong on every package's build output          |

Per-package: `pnpm --filter @graphloom/<name> test` (or `build`, `lint`,
`typecheck`). Adding a dependency on a DOM-touching d3 package fails at
install time by policy (ADR-0006, `.pnpmfile.cjs`).

## Commits & pull requests

- **Conventional Commits** are required (`feat:`, `fix:`, `docs:`, `refactor:`,
  `test:`, `chore:`, with package scopes, e.g. `feat(core): add group collapse
  command`). Enforced by commitlint.
- Keep PRs focused on one task where possible.
- CI must be green: lint, type-check, tests, e2e, accessibility checks,
  benchmarks, and a production build (the "Phase Gate" checks in the tracker
  apply to PRs incrementally).
- User-facing changes need a Changeset (`pnpm changeset`).

## Reporting bugs

Use the issue templates (available from Phase 15; until then, open a plain
issue). A minimal reproduction — eventually via the docs playground — makes
fixes dramatically faster.

## Code of conduct

Be excellent to each other. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
