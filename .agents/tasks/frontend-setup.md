# Frontend-Setup: Weinsprechstunde (Angular)

Status: abgeschlossen (nur Gerüst / Setup, keine Feature-Implementierung).

## Angular-Version

- Angular **22** (Standalone-Architektur, zoneless/Signals, SCSS als Stylesheet-Format).
- `package.json` nutzt `^22.0.0`-Ranges; `npm install` löst auf die aktuelle stabile Version auf.
- Lokal installierte Angular CLI: **22.2.5** (laufzeitstabil, über devDependency gepinnt auf `^22.0.9`).
- Toolchain: Node.js 24.18.1, npm 11.16.0.

## CLI-Aufruf: global vs. npx lokal

- Eine **globale** Angular CLI (22.0.9) ist auf diesem Rechner vorhanden, es wurde aber bewusst KEINE globale Installation vorgenommen/verändert.
- Die CLI ist zusätzlich als **lokale devDependency** (`@angular/cli`) im Projekt verankert.
- Aufruf im Projekt daher über `npx ng ...` aus dem Ordner `frontend/` (z. B. `npx ng build`). Das nutzt die projektlokale CLI 22.2.5 und ist unabhängig von der global installierten Version.

## Konfigurierte Assets (`angular.json`)

Im Build-Target sind zwei Asset-Quellen konfiguriert:

1. `public/` (Standard, inkl. `favicon.ico`).
2. `src/assets/` → wird nach `assets/` im Build-Output ausgeliefert. Enthält:
   - `wines.json` — **unverändert übernommen** (559 echte Weine, Live-Datenquelle). NICHT überschrieben.
   - `wine-schema.json` — aus dem Projekt-Root `wine-schema.json` nach `frontend/src/assets/wine-schema.json` kopiert.

Beide Dateien sind nach `npx ng build` unter `dist/ng-weinsprechstunde/browser/assets/` nachweisbar.

## package.json: prebuild erhalten

- Die bestehende minimale `frontend/package.json` wurde **nicht blind überschrieben**, sondern gemerged.
- Das `prebuild`-Script (`python ../scripts/weinimport.py prepare && ... export && ... image-export`) sowie `build` (`ng build`) und `start` (`ng serve`) bleiben **unverändert erhalten**.
- Ergänzt wurden lediglich die Angular-Dependencies/devDependencies sowie die Scripts `ng`, `watch` und `test`.

## Keine UI-Frameworks

- Gemäß Requirement 14.3: KEIN Material / Tailwind / Bootstrap installiert. Reines SCSS, Light Mode.

## Verifikation

- `npm install` lief fehlerfrei durch (0 Vulnerabilities).
- `npx ng build` baut das leere Gerüst fehlerfrei (Initial bundle ~217 kB, Assets korrekt emittiert).
- Es wurde KEIN Dev-Server gestartet und NICHTS committed.
