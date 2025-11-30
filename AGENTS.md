# Repository Guidelines

## Project Structure & Module Organization
- Source lives in `src/`. Entrypoints: `extension.ts` (activation), `mainOrchestrator.ts` (agent routing), `autonomousAgent.ts` (agent lifecycle), `managerViewProvider.ts` / `artifactViewerProvider.ts` (webviews), and `liftoffEditorPanel.ts` (full-tab UI). Utilities sit in `src/utils`, types in `src/types`, MCP helpers in `src/mcp`, safety rails in `src/safety`, memory in `src/memory`, UI assets in `src/webview`. Avoid new work under `src/_legacy`.
- Builds emit to `dist/` (`main` points to `dist/extension.js`). Shared assets/icons live in `resources/`.
- Local MCP/config templates are in `.mcp.json` and `.serena/`; keep user-specific secrets out of version control.

## Build, Test, and Development Commands
- `npm install` — install dependencies (Playwright downloads on first install).
- `npm run compile` — type-check and emit `dist/` for packaging or running the extension.
- `npm run watch` — incremental rebuild; pair with VS Code “Run Extension” (F5) for live debugging.
- `npm run lint` / `npm run lint:fix` — lint TypeScript sources and auto-fix style issues.

## Coding Style & Naming Conventions
- TypeScript targeting VS Code 1.85+ / Node 18; prefer async/await over raw promises.
- Formatting: 4-space indentation, single quotes, trailing semicolons, and ESM imports. Prefix logs with `[Liftoff]` for traceability.
- Naming: Classes/interfaces in PascalCase, functions/variables in camelCase, constants in UPPER_SNAKE_CASE. Co-locate helpers with their owning module or webview.
- Webviews load assets from `src/webview` and should route filesystem needs through the providers rather than direct access.

## Testing Guidelines
- No automated suite ships today; always run `npm run lint` before submitting.
- Add lightweight unit tests in `src/**/__tests__` or `*.test.ts` when introducing logic. For UI changes, list manual steps (spawn agent, set API key, trigger handoffs, verify artifacts) in the PR description.
- When touching storage or automation, confirm Playwright still launches and persistence (`src/persistence.ts`) remains intact.

## Commit & Pull Request Guidelines
- Follow existing history: short, imperative summaries with optional clarifiers (e.g., `Add hybrid cloud/local architecture for cost optimization`). Aim for one logical change per commit.
- PRs should include a concise summary, screenshots/GIFs for webview changes, testing notes (commands and manual scenarios), and any config/model defaults touched. Link related issues and flag breaking changes to settings or agent flows.

## Security & Configuration Tips
- Never commit API keys or model endpoints; rely on VS Code settings (`liftoff.*`) and local `.mcp.json`.
- When changing Playwright or model defaults, note required downloads or model sizes, and scrub persisted session data before sharing logs.
