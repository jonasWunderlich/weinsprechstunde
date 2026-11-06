# Vertrag: build-output

- Version: 1.1.1
- Produzent (Eigentümer): editor und weinliste (je eigener Build)
- Konsumenten: deploy-ftp
- Changelog:
  - 1.1.1 (2026-11-07): Korrektur: Dev-Assets kopieren `public/video` nach `video` (vorher fälschlich `videos`).
  - 1.1.0 (2026-11-06): CI (`deploy.yml`) baut zusätzlich den Editor (`npm run build:editor`); Output-Pfade unverändert.
  - 1.0.0 (2026-11-06): Erstfassung aus Ist-Zustand.

## Builds

| Projekt | Befehl (in `frontend/`) | Output |
|---|---|---|
| weinliste | `npm run build` (`ng build weinliste`, Config `production`) | `frontend/dist/weinliste/browser/` |
| editor | `npm run build:editor` (`ng build editor`) | `frontend/dist/editor/browser/` |
| shared | `npm run build:shared` (`ng build shared`) | nicht Teil des Deploys |

- Builder: `@angular/build:application`; `outputPath` `dist/weinliste` bzw. `dist/editor`.
- Jeder Output enthält `index.html` im `browser/`-Ordner.
- Weinliste-Build enthält keine Weindaten, Bilder, Audio, Video (diese kommen aus `export/`, siehe [export-format](export-format.md)). Nur die Development-Konfiguration kopiert `public/{data,images,audio,video}` als Assets.
- Editor-Build ist statisch und enthält keine Weindaten.

## Ist-Zustand Build-Aufrufer (unverändert übernommen)

- `Makefile` `deploy`: baut beide (`npm run build` und `npm run build:editor`), danach Phase `deploy`.
- `.github/workflows/deploy.yml`: baut beide (`npm run build`, `npm run build:editor`); danach Phase `deploy`. Der Editor wird nur deployt, wenn `deploy.remote_editor_path` gesetzt ist (siehe [deploy-input](deploy-input.md)).

## Invarianten

- Output-Pfade und -Namen oben ändern sich nur mit Versionsanhebung dieses Vertrags (und Anpassung von `deploy-input`).
- Ein Build verändert den Output des jeweils anderen Projekts nicht.
