---
type: Engineering
title: Troubleshooting
description: Problems solved in this fixture project
generated: { by: claude-code/claude-opus, at: 2026-11-08T09:00:00Z }
sources:
  - README.md
source_commit: 3f36e87
confidence: medium
---

# Troubleshooting

## Validator reports a missing source
- **Cause:** the source path is relative to the repository, not to the wiki.
- **Fix:** write the path from the repository root, for example `README.md`.
- **Workaround:** none needed.
- **Verification:** `python3 resources/validate-wiki.py wiki` → passed, 2026-11-08 @3f36e87
- **Limits:** none known
- **Related:** T3
