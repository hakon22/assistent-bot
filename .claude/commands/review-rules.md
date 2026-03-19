# Review Rules

Review the current file (or the file/code specified by the user) against ALL mandatory rules defined in CLAUDE.md.

Check every rule in order:

1. **No abbreviations** — variable names, function names, class names, parameters, constants. Flag any shortened names.
2. **Arrow functions only** — no `function` keyword, no classic class methods. All must be arrow functions.
3. **Class member ordering** — private constants → public properties → constructor → public methods → private methods.
4. **Destructuring** — flag any place where destructuring could be used but isn't (`.map(item => item.id)`, `const x = obj.x`, loop variables, function parameters).
5. **Strict equality** — no `==` or `!=` anywhere.
6. **No redundant comparisons** — no `=== true`, `=== false`, `!== 0`, `> 0` where truthiness check suffices.
7. **Lodash for nil/empty checks** — no manual `=== null`, `=== undefined`, `== null`, `!array.length`, `Object.keys(obj).length === 0`. Must use `isNil`, `isNull`, `isUndefined`, `isEmpty` from lodash.
8. **Logging** — significant actions (DB writes, external API calls, agent decisions, errors) must be logged via `LoggerService`.
9. **createQueryBuilder for complex queries** — no `find()` with deep nested relations for complex logic.
10. **Transactions** — multi-table writes in one operation must be wrapped in `dataSource.transaction()`.
11. **Scalability** — repeated logic extracted into methods, each method does one thing, no deep nesting.
12. **if-body formatting** — no single-line `if (...) { ... }`. Body always on a new line.

For each violation found:
- Quote the offending line(s)
- Name the rule it breaks
- Show the corrected version

If no violations found, confirm the code is compliant.
