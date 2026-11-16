---
type: Engineering
title: Problemi noti
description: Problemi non ovvi già risolti e come riconoscerli.
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - .github/workflows/build.yml
  - package.json
  - crates/wiki-mcp/src/serve.rs
source_commit: 206cc3c
confidence: high
---

# Problemi noti

## La build del frontend fallisce su un import non risolto (es. `@fontsource/...`)
- **Cause:** `node_modules` installato prima che cambiassero le dipendenze.
- **Fix:** `npm ci`.
- **Workaround:** none
- **Verification:** `npm ci && npm run build` → `✓ built`, 2026-11-11 @4272c84
- **Limits:** none known
- **Related:** [sviluppo](engineering/development.md)

## Il job `test` della CI fallisce su `apt-get` con `Temporary failure resolving 'azure.archive.ubuntu.com'`
- **Cause:** rete DNS del runner GitHub, non il codice.
- **Fix:** none yet
- **Workaround:** `gh run rerun <id>`
- **Verification:** run 43042151396 (tag v0.2.0) rilanciato → tutti i job success, 2026-11-11
- **Limits:** none known
- **Related:** [CI e release](engineering/operations.md)

## Gli agenti usano ancora il vecchio server MCP dopo un aggiornamento
- **Cause:** ogni agente avvia il suo processo `codebase-wiki-mcp serve` e lo tiene finché la sessione è aperta.
- **Fix:** chiudere e riaprire gli agenti collegati (l'app lo segnala in Ricerca).
- **Workaround:** none
- **Verification:** ⚠️ NOT VERIFIED - osservato con `ps` il 2026-11-11, nessun comando di prova dedicato
- **Limits:** none known
- **Related:** [rag-core e wiki-mcp](modules/rag-mcp.md)

## macOS dice che l'app "è danneggiata e non può essere aperta"
- **Cause:** fino alla 0.3.0 il pacchetto aveva solo la firma del linker sul binario, senza risorse sigillate; con l'attributo di quarantena del download Gatekeeper lo rifiuta come danneggiato.
- **Fix:** dalla 0.3.1 `bundle.macOS.signingIdentity: "-"` in `src-tauri/tauri.conf.json` firma ad-hoc tutto il pacchetto; Gatekeeper mostra "sviluppatore non verificato" e si apre da Impostazioni → Privacy e sicurezza → Apri comunque.
- **Workaround:** per la 0.3.0: `xattr -dr com.apple.quarantine "/Applications/Codebase Wiki.app"` e `codesign --force --deep -s - "/Applications/Codebase Wiki.app"`.
- **Verification:** `codesign -dv` → `Signature=adhoc`, `Sealed Resources version=2`; `codesign --verify --deep --strict` → ok, build locale 2026-11-11
- **Limits:** senza Developer ID e notarizzazione l'avviso di Gatekeeper resta.
- **Related:** [CI e release](engineering/operations.md)

## Su Windows Ricerca e Impostazioni dicono "Comando sidecar fallito"
- **Cause:** `codebase-wiki-mcp.exe` non parte (exit `-1073741515`, DLL non trovata): ONNX Runtime al suo interno richiede il runtime Visual C++ (`msvcp140.dll`, `vcruntime140_1.dll`), assente su un Windows appena installato.
- **Fix:** dalla 0.7.5 `scripts/build-sidecar.mjs` copia le tre DLL da `System32` in `src-tauri/binaries/`, `src-tauri/tauri.windows.conf.json` le installa accanto agli exe e l'app le copia anche in `<data>/bin` per gli agenti.
- **Workaround:** `winget install --id Microsoft.VCRedist.2015+.x64 -e`
- **Verification:** VM Windows 11 pulita senza redist: `codebase-wiki-mcp.exe` exit `-1073741515`; con la build CI @74c0024 il sidecar parte e l'indicizzazione riesce, 2026-11-16 (prova di Stefano)
- **Limits:** none known
- **Related:** [CI e release](engineering/operations.md)
