# Claude Code Preferences

## Code Style
- **No comments in code**: Use self-documenting method names instead of inline comments
- **Follow project lint/biome**: Obey existing Biome formatting (double quotes, 2-space indent per biome.json)
- **Minimal changes**: Keep patches targeted and scoped to request
- **Follow existing patterns**: Don't introduce new patterns without discussion
- **No imperative loops**: Replace `for`/`while` constructs with declarative array operations (`map`, `reduce`, `filter`, etc.)
- **Prefer const over let**: Always use `const` for variable declarations. Only use `let` when reassignment is genuinely unavoidable. Never use `var`.
- **Method naming**: Never prefix methods with "get" - type system conveys that
- **Use null instead of undefined**: Always use `null` for absence of value, never `undefined`

## Git Commits
- **No pull requests**: Commits directly to `main`
- **Ask before committing**: Propose message and wait for explicit approval
- **Semantic commit messages** with issue references
- **No AI attribution** in commit messages
