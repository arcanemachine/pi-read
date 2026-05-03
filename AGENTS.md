# Agent Instructions

## Workflow

Commit when a task is completed.

When changing tool behavior, update README examples and config docs in the same task.

## Sanity checks (recommended)

```bash
npm run typecheck
npm run test
npm run build
npm run format
```

## Commit Style

Match existing commits:
- `Add initial extension implementation`
- `Update README with configuration examples`
- `Format code with Prettier`

## Dependencies and packaging

Keep test/tooling dependencies in `devDependencies` unless runtime is truly required.

Keep the published package minimal via the `files` allowlist in `package.json`.

## Documentation

Use proper formatting when writing documentation, but do not go overboard with the formatting. The content should speak for itself.
