# Requirements: weinliste (öffentliche Weinlisten-App)

Domäne: `frontend/projects/weinliste` (Angular SPA, Light Mode, reines SCSS). Zielgruppe: Weinkenner (Toni, Simone, Olfi, Stephan) und Weinlaien (Johannes). Orientierung an `album-collection-frontend` (album-wall → wine-wall, album-tile → wine-tile, album-tile-overlay → wine-tile-overlay, album-tile-cover → wine-tile-cover, album-list-item → wine-list-item; controls-row, nav, sort-button, scroll-top-button unverändert benannt), ohne blindes Kopieren.

Verträge:
- #[[file:.kiro/specs/contracts/export-format.md]] (Daten: `wines.json`, `wine-schema.json`, Medien)
- #[[file:.kiro/specs/contracts/shared-api.md]] (FilterService, Models, UserPreferences, `applyFiltersAndSort`)

## Glossar (nur weinliste)

- **App**: SPA „Weinsprechstunde". Lädt `data/wines.json` und `data/wine-schema.json` zur Laufzeit per HTTP (kein gebündeltes Asset, keine Abhängigkeit zum ImportScript).
- **FilterService**: einzige Quelle der Wahrheit für Filter-, Such- und Sortierzustand (Def. in shared-api). Keine Filterlogik außerhalb.
- **UserPreferences**: Cookie `ws_prefs` ohne festes Ablaufdatum: sichtbare Zusatzfilter (nur Feldnamen), Sortierung, Ansicht.
- **ActiveFilters**: in der ControlsRow sichtbare Filter: feste Freitextsuche plus eingeblendete optionale Filter.
- **WineWall**: Hauptansicht (NavBar, ControlsRow, WineGrid bzw. WineList).
- **WineTile / WineTileOverlay / WineTileCover**: Kachel mit Bild, Info-Overlay (Jahr, Name, Weingut, Rebsorte(n), Rating-Kreis, Region) und Bildbereich mit PlaceholderIcon-Fallback.
- **WineListItem**: Zeile mit Thumbnail (WineTileCover), Name, Weingut, Jahr, Herkunftsland, Rating.
- **WineDetailDialog**: modaler Dialog mit allen Details, AudioPlayer (bei `audio`), VideoPlayer (bei `video`).
- **ControlsRow**: Freitextsuche, ActiveFilters, „Mehr Filter", Sortierung, InfoToggle, ListToggle.
- **NavBar**: App-Name „Weinsprechstunde" + Logo-Platzhalter; Klick setzt Filter zurück und navigiert zu `/`; keine Menüpunkte.
- **WineGrid / WineList**: Kachel- bzw. Listenansicht; rendern alle gefilterten Weine direkt (keine Paginierung, kein Nachladen).
- **RatingCircle**: Kreis mit Rating (1.0–10.0), oben rechts im Overlay und im Dialog.
- **InfoToggle / ListToggle**: Schalter für Dauer-Overlay bzw. Grid/Liste.
- **KeyboardShortcuts**: `i` (Overlay umschalten), `l` (Grid/Liste), `→`/`←` (nächster/vorheriger Wein im Dialog, Wrap am Rand; ohne offenen Dialog erster/letzter Wein), `Escape` (Dialog schließen).

## Requirements

### Requirement 7: Datenladen in der App

7.1 Beim Start lädt die App die `wines.json` per HTTP-GET.
7.2 Keine direkte Abhängigkeit zum ImportScript; einzige Datenquelle ist die exportierte `wines.json`.
7.3 Während des Ladens wird ein Ladezustand angezeigt.
7.4 Schlägt der GET fehl → lesbare Fehlermeldung im Hauptbereich.
7.5 Alle Weindaten werden einmalig beim Start vollständig geladen; keine Paginierung, kein Nachladen bei Routenwechseln.
7.6 Gesamte Filterlogik im zentralen FilterService, gemeinsam von allen Komponenten und Routen genutzt.

### Requirement 8: Navigation

8.1 Oben dauerhaft eine NavBar.
8.2 Zeigt den Namen „Weinsprechstunde".
8.3 Logo-Platzhalter links neben dem Namen.
8.4 Keine Navigationsmenüpunkte (insbesondere nicht „Regionen"/„Rebsorten"); Filtern nur über die ControlsRow.
8.5 Klick auf Logo/Namen → alle Filter zurücksetzen, URL `/`.

### Requirement 9: Controls Row

9.1 Unter der NavBar dauerhaft eine ControlsRow.
9.2 Freitextsuche vergleicht case-insensitiv mit allen Feldern, deren `filter_type` im WineSchema `text-search` ist (aktuell nur `name`).
9.3 Einziger fest sichtbarer Filter ist die Freitextsuche; alle anderen optional über „Mehr Filter" zuschaltbar.
9.4 Freitextsuche: Label „Filter", Platzhalter benennt durchsuchbare Eigenschaften (z. B. „Name, Weingut, Rebsorte, Region …"); technisch nur `text-search`-Felder.
9.5 „Mehr Filter"-Button listet einzeln an-/abwählbar: Multiselect Rebsorte (`grape`), Region (`origin`); Einzelauswahl `country`, `type`, `producer`, `quality`; Bound-Filter „Bewertung ab/bis", „Verkostung ab/bis", „Jahrgang ab/bis".
9.6 Einblenden → Filter erscheint in der ControlsRow, Auswahl im Cookie gespeichert.
9.7 Ausblenden (Abwählen in der Liste oder Entfernen-Icon) → Filter entfernt, Filterwert zurückgesetzt, Cookie aktualisiert.
9.8 Jeder eingeblendete optionale Filter hat ein Entfernen-Icon (✕) neben dem Label.
9.9 Entfernen setzt auch den Filterwert zurück; kein unsichtbar wirkender Filter.
9.10 `multi-select` (Rebsorte, Region): kompaktes aufklappbares Dropdown; Trigger mit Zusammenfassung („Alle" / Einzelwert / „n gewählt"); scrollbares Checkbox-Panel mit „Zurücksetzen" und „Fertig"; Werte aus den Weindaten; keine dauerhaft sichtbare Liste.
9.11 `dropdown` (`country`, `type`, `producer`, `quality`): Einzelauswahl mit Vorschlägen aus den Weindaten.
9.12 Jede Range-Grenze ist ein eigener, unabhängig zuschaltbarer Bound-Filter: Bewertung (Zahl, Schritt 0.1, 1.0–10.0), Jahrgang (Zahl), Verkostung (Datum).
9.13 Mehrere Filter: AND zwischen Feldern; bei Multiselect OR innerhalb eines Feldes.
9.14 Sortierung: „Neueste Verkostung zuerst" (Standard), „Älteste Verkostung zuerst", „Beste Bewertung zuerst", „Teuerste zuerst", „Günstigste zuerst"; Auswahl im Cookie.
9.15 Sortieroption wirkt sofort auf die aktive Ansicht.
9.16 InfoToggle schaltet das Overlay auf allen WineTiles dauerhaft ein/aus.
9.17 InfoToggle aktiv → Overlay dauerhaft sichtbar, unabhängig von Hover/Klick.
9.18 InfoToggle inaktiv → Overlay nur per Hover (Desktop) bzw. Klick (mobil).
9.19 ListToggle wechselt zwischen WineGrid und WineList; Ansicht im Cookie.
9.20 Umschalten erhält aktive Filter und Sortierung.
9.21 InfoToggle/ListToggle tragen `title` „Tastenkürzel: i" bzw. „Tastenkürzel: l".

### Requirement 10: Tastaturkürzel

10.1 Globale Kürzel: `i` Overlay (wie InfoToggle), `l` Grid/Liste (wie ListToggle), `→` nächster, `←` vorheriger Wein im WineDetailDialog.
10.2 `i` schaltet den InfoToggle-Zustand um (ohne Ausnahmebedingung).
10.3 `l` schaltet zwischen WineGrid und WineList (ohne Ausnahmebedingung).
10.4 Fokus in `input`, `textarea`, `select` oder `contenteditable` → `i`, `l`, `←`, `→`, `Escape` lösen nicht aus.
10.5 Bei geöffnetem Dialog lösen `i` und `l` nicht aus.
10.6 Mit Modifier (Ctrl, Cmd/Meta, Alt) lösen `i`, `l`, `←`, `→`, `Escape` nicht aus.
10.7 Dialog offen, `→` → nächster Wein in der über den FilterService gefilterten und sortierten Reihenfolge (wie WineGrid/WineList).
10.8 Dialog offen, `←` → vorheriger Wein derselben Reihenfolge.
10.9 Letzter Wein, `→` → erster Wein.
10.10 Erster Wein, `←` → letzter Wein.
10.11 Kein Dialog, `→` → Dialog mit erstem Wein.
10.12 Kein Dialog, `←` → Dialog mit letztem Wein.
10.13 Dialog offen, `Escape` → Dialog schließen.

### Requirement 11: Kachelansicht (WineGrid)

11.1 Gefilterte, sortierte Weine in responsiver Kachelung.
11.2 Alle direkt gerendert, ohne Paginierung/Nachladen.
11.3 Keine Treffer → Hinweismeldung „keine Ergebnisse".
11.4 Bei aktivem ControlsRow-Filter (`hasActiveFilter`) als erstes Element ein Zurück-Button in Kachelgröße; Klick → alle Filter zurücksetzen, URL `/`.

### Requirement 12: WineTile

12.1 Weinbild (WineTileCover) oder PlaceholderIcon.
12.2 Ohne Bild → PlaceholderIcon.
12.3 RatingCircle oben rechts im Overlay, wenn `rating` vorhanden.
12.4 Overlay zeigt in festem Template: Jahr, Name, Weingut, Rebsorte(n), Rating-Kreis, Region. Felder ohne Wert entfallen; keine dynamische Generierung aus dem WineSchema.
12.5 Desktop, Maus über Kachel, InfoToggle inaktiv → Overlay ein.
12.6 Desktop, Maus weg, InfoToggle inaktiv → Overlay aus.
12.7 Mobil, Tippen, InfoToggle inaktiv → Overlay ein.
12.8 Mobil, erneutes Tippen bei sichtbarem Overlay, InfoToggle inaktiv → Overlay aus.
12.9 Wein mit `audio` oder `video` → kleiner Play-Button auf der Kachel, öffnet die Detailansicht.

### Requirement 13: Listenansicht (WineList)

13.1 Gefilterte, sortierte Weine als vertikale Liste von WineListItems, wenn die Listenansicht aktiv ist.
13.2 Zeile: Thumbnail (WineTileCover mit PlaceholderIcon-Fallback), Name, Weingut, Jahr, Herkunftsland, Rating; Felder ohne Wert entfallen.
13.3 Alle direkt gerendert, ohne Paginierung/Nachladen.
13.4 Keine Treffer → Hinweismeldung.
13.5 Bei `hasActiveFilter` am Listenanfang ein Zurück-Button; Klick → Filter zurücksetzen, URL `/`.

### Requirement 14: WineDetailDialog

14.1 Klick auf WineTile/WineListItem öffnet den Dialog.
14.2 Festes, gestaltetes Template (keine Tabelle, keine Schema-Generierung). Gruppen: Kopf (Name, Weingut, Jahr, Rating-Kreis), Herkunft (Land, Region), Weinprofil (Rebsorte(n), Typ, Qualität), Verkostung (Datum, Beschreibung), Kaufinfo (Preis), Medien (großes Bild, Audio-Player bei `audio`, Video-Player bei `video`). Felder ohne Wert entfallen; unbekannte Zusatzfelder am Ende als Schlüssel-Wert-Paare.
14.3 RatingCircle, wenn `rating` vorhanden.
14.4 AudioPlayer, wenn `audio` vorhanden.
14.5 Schließen-Button.
14.6 Klick auf Schließen-Button schließt.
14.7 Klick außerhalb schließt.
14.8 Hintergrund-Scrollen bei offenem Dialog verhindert.

### Requirement 15: Technik und Architektur (ohne 15.6)

15.1 Angular SPA mit TypeScript.
15.2 Angular Signals für reaktiven State.
15.3 Ausschließlich reines SCSS, keine UI-/CSS-Frameworks.
15.4 Responsives Layout (Desktop und mobil).
15.5 Light Mode.
15.7 Weindatenstruktur erlaubt unbekannte Zusatzfelder typsicher (`Record<string, unknown>` / Index-Signatur).
15.8 Komponenten: wine-wall, wine-tile, wine-tile-overlay, wine-tile-cover, wine-list-item, controls-row, nav, sort-button, scroll-top-button.
15.9 Angular Router für URL-Routing; Routenwechsel lösen keine Weindaten-Requests aus.
15.10 FilterService ist einzige Quelle der Wahrheit für Filterkriterien; keine Komponente hält lokalen Filter-State, der die Weinliste beeinflusst.
15.11 Struktur des Musikalben-Frontends nur als Orientierung, gezielt zugeschnitten, saubere Implementierung.

### Requirement 19: Benutzereinstellungen (UserPreferences)

19.1 Einstellungen im Cookie `ws_prefs` ohne festes Ablaufdatum.
19.2 Inhalt: eingeblendete Zusatzfilter (nur Feldnamen), Sortieroption, Ansicht (Grid/Liste).
19.3 Keine aktiven Filterwerte im Cookie.
19.4 Beim Start Cookie lesen; ControlsRow und Ansicht entsprechend initialisieren.
19.5 Jede Änderung (Filter ein-/ausblenden, Sortierung, Ansicht) aktualisiert den Cookie sofort.
19.6 Ohne Cookie: keine optionalen Filter, nur Freitextsuche; Standard Sortierung „Neueste Verkostung zuerst", Ansicht Grid.
