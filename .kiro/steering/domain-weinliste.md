---
name: domain-weinliste
description: Öffentliche Weinliste-App (Angular, frontend/projects/weinliste), zeigt wines.json an. Laden bei Arbeit an Weinliste, Anzeige, Filter, export-format-Konsum oder Weinliste-Specs.
inclusion: auto
---
# Domäne weinliste

Scope: `frontend/projects/weinliste/**`. Nicht lesen: editor, pipeline, deploy-ftp. `shared` nur über den Vertrag shared-api.

Ändert sich shared nicht, nur das Projekt weinliste prüfen, bauen und testen.

## Verträge
- #[[file:.kiro/specs/contracts/export-format.md]]
- #[[file:.kiro/specs/contracts/shared-api.md]]

## Specs
- #[[file:.kiro/specs/weinliste/requirements.md]]
- #[[file:.kiro/specs/weinliste/design.md]]
- #[[file:.kiro/specs/weinliste/tasks.md]]
