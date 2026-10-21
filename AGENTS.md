# Repository Guidelines

## Required Pre-task Reading

Before taking task actions, read `rules/rules.md` and `rules/requirements.md`, including user edits. Apply their current constraints and distinguish agreed requirements from proposals and unresolved decisions. Keep local conversation materials out of product output, Git commits, and deployment artifacts as specified in the rules.

## Project Structure & Module Organization

`wook-home` is currently a minimal repository containing `README.md` and `LICENSE` (MIT). There are no source, test, asset, or configuration directories yet. Keep the root focused on project documentation and configuration. When introducing application code, choose a clear directory layout and document the source, tests, and assets in `README.md`.

## Build, Test, and Development Commands

No package manager, build system, development server, or test runner is configured. Do not assume commands such as `npm test` or `npm run build` work. When adding tooling, include the required runtime version, dependency installation steps, and exact development, build, and test commands in `README.md`.

Useful checks available now:

- `git status --short`: review changed and untracked files.
- `git diff --check`: detect whitespace errors in changes to tracked files.
- `git diff`: inspect unstaged changes before committing.

## Coding Style & Naming Conventions

No language-specific style, indentation convention, formatter, or linter has been established. Match existing Markdown with hash-style headings and concise prose. Use descriptive file and directory names. When introducing a language, establish consistent indentation and formatting through checked-in configuration rather than relying on individual editor settings.

## Testing Guidelines

There is no testing framework or coverage requirement yet. For documentation changes, verify paths, commands, and Markdown rendering. When adding executable functionality, include appropriate automated tests and document their location, naming convention, and invocation alongside the implementation.

## Commit & Pull Request Guidelines

Git history contains only `Initial commit`, so no recurring commit convention is established. Use short, imperative subjects, such as `Add development setup instructions`, and keep commits focused.

Pull requests should describe the change, its purpose, and validation performed. Link related issues when applicable. Include screenshots for visible interface changes and note any new dependencies or setup requirements.

## Security & Configuration

Never commit or push personal information, passwords, credentials, tokens, or private configuration. Do not expose sensitive values in logs, command output, or error messages; redact them when needed. Add suitable ignore rules and sanitized configuration examples when introducing environment-specific settings. Preserve the MIT license notice.
