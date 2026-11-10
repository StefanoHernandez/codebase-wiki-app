# /wiki-init [wiki-root] [--adopt <folder>]

Bootstrap the wiki for this repository. Run once per repo.

1. **Folder** - adopt `<folder>` · new `wiki` · new `.wiki`
2. **Language** - for headings and prose (e.g. English, Italian)
3. **Project division** - phases/WP · releases · sprints/milestones · none
4. **Topics** - architecture, modules, testing, environment, operations
5. **Sensitive data** - no · yes (with `.private-terms`)
6. **Agent entry file** - CLAUDE.md · AGENTS.md · none
7. **Parallel work** - add `<wiki-root>/<log path> merge=union` to `.gitattributes` · no
