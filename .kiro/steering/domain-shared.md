---
name: domain-shared
description: Gemeinsamer Angular-Code (frontend/projects/shared, Vertrag shared-api) für editor und weinliste, plus frontend/package.json, angular.json, tsconfig und globale Styles. Laden bei Änderungen an geteiltem Code.
inclusion: auto
---
# Domäne shared

Scope: `frontend/projects/shared/**`. Ebenfalls Shared-Änderung: `frontend/package.json`, `frontend/angular.json`, `frontend/tsconfig*.json`, globale Styles.

Eine Shared-Änderung kann editor und weinliste betreffen: beide Apps prüfen, bauen und testen. Bleibt die öffentliche API (Vertrag) gleich, genügt das Prüfen der Konsumenten gegen den Vertrag.

## Verträge
- #[[file:.kiro/specs/contracts/shared-api.md]]

## Specs
Keine eigene Domänen-Spec. Der Vertrag shared-api ist maßgeblich.
