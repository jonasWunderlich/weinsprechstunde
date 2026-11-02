# Design-Review: Angular-Frontend „Weinsprechstunde" (frontend-design.md)

Review-Runde 3 (frisch, ohne Kontext der Erzeugung). Geprüft gegen:
`.kiro/specs/weinliste/design.md` (Abschnitt „2. Angular Frontend", Pseudocode maßgeblich),
`requirements.md` (Req 7–14, 17, 18), `tasks.md` (Tasks 15–22, Properties 10–16, 19),
sowie die realen Artefakte `wine-schema.json` und `frontend/src/assets/wines.json` (559 Weine).

Das Dokument ist in zwei Vorrunden bereits stark gereift (15 + 8 Findings behoben). Die Prüfung
konzentriert sich daher auf verbliebene Ambiguitäten, nicht-verifizierte Annahmen und Restlücken.

---

## Verifizierte Annahmen (gegen echte Artefakte geprüft)

- **Schema-Realität korrekt beschrieben.** `wine-schema.json` führt `rating` als `type:"number"`,
  `decimals:1`; `price` als `type:"number"`, `decimals:2`, `filter_type:null`; `year` als
  `type:"number"`, `decimals:0`. Die `type`-Union `text | number | date | multi-value` im Modell
  entspricht exakt dem realen Schema. Die Korrektur gegenüber dem älteren `design.md`-Pseudocode
  (`type:'rating'`, `price:'text'`) ist berechtigt. ✔
- **`filter_type`-Verteilung.** `name` ist das einzige `text-search`-Feld → die schema-abgeleitete
  `searchFields`-Menge enthält real nur `name`, wie das Design beschreibt. Fünf `dropdown`-Felder
  (country, origin, type, producer, quality), `grape` = `multi-select`, `year` = `range`,
  `rating` = `rating-range`, `tasting_date` = `date-range`. ✔
- **Wertetypen in `wines.json`.** `rating` durchgängig `float`, `price` `float`, `year` `int`,
  `grape`/`quality` real immer `str`. Das Modell (`price?: number`, `rating?: number`) ist korrekt;
  die gestrichene String-Sonderbehandlung für `price` ist berechtigt. ✔
- **Medien-Dateinamen sind bloße Dateinamen ohne Verzeichnis** (z. B.
  `2021-02-03-chateau-tour-perey-2011.jpg`). Die `mediaSrc()`/`IMAGE_BASE`-Festlegung adressiert
  genau diese Realität. ✔
- **Asset-Auslieferung.** `frontend-setup.md` bestätigt: `src/assets/` → `assets/` im Build-Output;
  beide Dateien liegen nach `ng build` unter `dist/.../browser/assets/`. Der relative Pfad
  `assets/...` im `WineDataService` ist damit korrekt. ✔
- **Datenlage dünn.** `price` ~117/559, `rating` 4, `grape`/`country`/`producer`/`origin`/`year` je 2,
  `tasting_date` 557, `image` 479, `name` 559. Extra-Felder: `taste_nose` 120, `taste_mouth` 120,
  `taste_eye` 119, `percentage` 14, `conclusion_*` 7–13, `development` 6, `spontansprechstunde` 1.
  Die `EXTRA_LABELS`-Keys decken alle real vorkommenden Extra-Felder ab. ✔
- **`audio` 2, `video` 0.** PlayButton/AudioPlayer/VideoPlayer-Logik (`isPresent`-gated) ist
  gegenüber dieser Lage robust (rendern nichts, wenn Feld fehlt). ✔
- **Angular 22, zoneless/Signals, reines SCSS, keine UI-Frameworks** laut `frontend-setup.md`
  bestätigt; der Technologie-Stack des Designs ist konsistent mit dem bestehenden Gerüst. ✔

## Nicht verifizierte / falsche Annahmen

- **FALSCH: `description` „praktisch durchgängig gesetzt".** Der Realitätscheck des Designs listet
  `description` neben `name`/`image`/`tasting_date` als nahezu immer gesetzt. Tatsächlich ist
  `description` nur in **2/559** Weinen present (siehe Finding 1). `name` 559, `tasting_date` 557,
  `image` 479 stimmen; `description` ist die Ausnahme.
- **Nicht verifizierbar in diesem Scope:** das Verhalten der lokalen `public/images`-Symlink-Lösung
  bei `ng serve` (kein Dev-Server gestartet, Setup-Doc bestätigt das ausdrücklich). Die Aussage
  „Angular liefert `public/` unter Web-Root aus" ist für Angular 22 korrekt, der Symlink selbst
  existiert noch nicht — reine Implementierungsvorgabe, kein Blocker.

---

## Findings

### Finding 1 — Realitätscheck behauptet `description` als durchgängig gesetzt (faktisch falsch)
**Severity: MEDIUM**
**Ort:** Abschnitt „Realitätscheck der Datenlage", Aufzählung: „`tasting_date`, `image`, `name`,
`description` sind praktisch durchgängig gesetzt."

Gemessen in `frontend/src/assets/wines.json`: `description` ist nur in **2 von 559** Objekten
present (nicht-null, nicht-leer). `name` (559), `tasting_date` (557) und `image` (479) sind
tatsächlich dicht; `description` nicht. Das ist keine reine Kosmetik: Der Realitätscheck ist die
erklärte Prämisse, aus der das Design UI-Entscheidungen ableitet (u. a. „Overlay/Listenzeile wirken
oft fast leer"; die WineDetailDialog-Gruppe „Verkostung" = `tasting_date` + `description`). Mit
`description` faktisch leer besteht die „Verkostung"-Gruppe im Dialog bei praktisch allen Weinen nur
aus dem Datum — der eigentliche Verkostungsinhalt steckt ausschließlich in den Extra-Feldern
(`taste_*`, `conclusion_*`). Das verstärkt die ohnehin getroffene Festlegung „`extraEntries` ist der
eigentliche Informationsträger", widerspricht aber der falschen Aussage im selben Abschnitt.

**Konkreter Fix:** Die Zeile korrigieren zu:
> „`name` (559/559), `tasting_date` (557/559) und `image` (479/559) sind praktisch durchgängig
> gesetzt; `description` dagegen nur ~2/559 — der Verkostungsinhalt liegt fast vollständig in den
> Extra-Feldern (`taste_eye/_nose/_mouth`, `conclusion_*`)."

Damit bleibt die abgeleitete Design-Konsequenz (extraEntries erstklassig gestalten) korrekt
begründet, statt auf einer falschen Prämisse zu stehen.

---

### Finding 2 — Dropdown-Match bricht für potentielle Array-Werte (`quality`) — Options-Quelle und Match-Logik divergieren
**Severity: MEDIUM**
**Ort:** `applyFiltersAndSort`, Dropdown-Zweig
`if (sel != null && String(wine[field] ?? '') !== sel) return false;`
in Verbindung mit `FilterFieldComponent.options = distinctValuesForField(...)` und dem Modell
`quality?: string | string[]`.

Von den fünf Dropdown-Feldern (`country, origin, type, producer, quality`) ist `quality` im Modell
explizit als `string | string[]` typisiert (gleiche Multi-Value-Fähigkeit wie `grape`). Die
Options-Erzeugung `distinctValuesForField` rollt Array-Werte über `valueList` **flach** aus — eine
Dropdown-Option ist also ein **einzelner** Qualitätswert. Der Match im Filter stringifiziert dagegen
den **gesamten** Feldwert: `String(wine['quality'] ?? '')`. Für ein Array `["a","b"]` ergibt das
`"a,b"`, das nie gegen die Einzeloption `"a"` matcht. Options-Quelle (flach) und Match (ganzer Wert)
sind damit inkonsistent; ein Dropdown-Filter auf ein Array-wertiges Feld selektiert nichts.

In der aktuellen Realdatenlage ist `quality` immer ein String (1/559 present, Typ `str`), also tritt
der Bug heute nicht auf. Er ist aber latent und widerspricht der ausdrücklichen Design-Begründung für
die generische Dropdown-Lösung („robust gegen künftige Schema-dropdowns … ein neues dropdown-Feld
braucht keine Filter-Änderung"). Ein multi-value Dropdown-Feld bräuchte sehr wohl eine Änderung.

**Konkreter Fix (eine Variante wählen und festschreiben):**
- (a) Match über `valueList` statt `String(...)`, symmetrisch zur Options-Erzeugung:
  ```typescript
  for (const [field, sel] of Object.entries(filter.dropdowns)) {
    if (sel != null && !valueList(wine, field).includes(sel)) return false;
  }
  ```
  Deckt string- und array-wertige Dropdown-Felder korrekt ab, nutzt denselben Helfer wie die
  Optionen (eine Quelle, kein Drift).
- oder (b) explizit festhalten, dass Dropdown-Felder laut Design immer Einzelwerte sind, und `quality`
  im Modell auf `string` (statt `string | string[]`) reduzieren — dann sind Options und Match wieder
  konsistent. Das widerspricht aber dem Glossar (quality „String oder Array").

Variante (a) ist vorzuziehen, weil sie die im Design beanspruchte Zukunftssicherheit tatsächlich
herstellt und mit `grape`/`valueList` konsistent ist.

---

### Finding 3 — Freitextsuche-Property (Property 10) vs. Req-9.2-Datenlage: Suche trifft real nur `name`, aber Overlay/Nav setzen auf mehr Kontext (keine Lücke, nur Dokuschärfung)
**Severity: NIT**
**Ort:** `applyFiltersAndSort` Freitextsuche + Abschnitt Entscheidung „Freitextsuche (Req 9.2) —
schema-getreu".

Die Festlegung „Suche ausschließlich über `filter_type === 'text-search'`-Felder" ist korrekt und
Req-9.2-konform; im realen Schema ist das nur `name`. Das Design dokumentiert das sauber. Anmerkung
zur Nutzbarkeit (kein Spec-Verstoß): Da `producer`, `grape`, `origin`, `year` real fast nie gesetzt
und nicht `text-search` sind, ist die Freitextsuche praktisch eine reine Namenssuche. Das ist
beabsichtigt und spec-konform, sollte aber als bewusste Produktentscheidung einen Halbsatz bekommen,
damit niemand die Suche später „aus Versehen" um Kontextfelder erweitert und dabei Req 9.2 bricht.

**Konkreter Fix:** Im Entscheidungsabsatz ergänzen: „Folge für die Realdatenlage: Die Freitextsuche
ist faktisch eine Namenssuche (`name` ist das einzige `text-search`-Feld). Eine Erweiterung erfordert
sowohl Schema- als auch Req-9.2-Fortschreibung — bewusst außerhalb dieses Scopes." (Teilweise bereits
vorhanden; nur den Realdaten-Bezug explizit machen.)

---

### Finding 4 — EndlessScroll-Sentinel-Bindung nicht eindeutig spezifiziert (Observer-Aufsetzpunkt in zoneless)
**Severity: NIT**
**Ort:** WineGridComponent / WineListComponent, „EndlessScroll-Mechanik".

Der Text nennt alternativ `afterNextRender`/`ngAfterViewInit` auf einem `viewChild`-ElementRef und
getrennt „Observer wird in `DestroyRef`/`ngOnDestroy` getrennt". Beide Alternativen sind in Ordnung,
aber die Mischung aus Signal-`viewChild`, Lifecycle-Hook und `DestroyRef` lässt offen, welches Muster
verbindlich ist. In einer zoneless/OnPush-Komponente mit Signal-`viewChild` ist `afterNextRender`
(bzw. ein `effect`, der den `viewChild()` liest) das idiomatische Aufsetzmuster; `ngAfterViewInit`
sieht ein Signal-`viewChild` erst nach dem ersten CD-Durchlauf.

**Konkreter Fix:** Ein Muster festschreiben, z. B.: „`sentinel = viewChild<ElementRef>('sentinel')`;
Observer in `afterNextRender()` aufsetzen (liest `this.sentinel()`), Cleanup über `DestroyRef`." Damit
entfällt die `ngAfterViewInit`-Alternative und das Aufsetzen ist eindeutig.

---

### Finding 5 — WineTile: Doppelzweck-Klick (Overlay-Toggle vs. Dialog öffnen) auf Mobil bleibt unterspezifiziert
**Severity: NIT**
**Ort:** WineTileComponent, Absatz „Die Unterscheidung Hover vs. Tap …" und „Ein Doppelzweck-Klick …".

Der Text beschreibt die Auflösung prosaisch („Erstkontakt zeigt Overlay, ein Klick auf den
Overlay-Inhalt/Play öffnet den Dialog"), aber der Code zeigt `onTap()` (toggelt Overlay) und
`onOpen()`/`onPlay()` (öffnen Dialog) ohne festzulegen, welche DOM-Elemente welchen Handler tragen.
Für Req 11.7/11.8 (Mobil: erster Tap zeigt Overlay, zweiter Tap blendet aus) vs. Req 13.1 (Klick
öffnet Dialog) ist die Zuordnung der Klickziele entscheidend, sonst öffnet derselbe Tap gleichzeitig
Overlay und Dialog. Dies ist Darstellungslogik, aber ohne Festlegung der Trigger-Elemente mehrdeutig
für den Implementierer.

**Konkreter Fix:** Im Template-Vertrag festlegen, z. B.: „Cover-Bereich → `onTap()` (Overlay-Toggle);
ein dedizierter Detail-Trigger (Overlay-Fläche bzw. expliziter Button) und der Play-Button →
`onOpen()`/`onPlay()`. Auf Desktop öffnet Klick auf die Tile den Dialog (`onOpen`), Hover steuert das
Overlay." So ist jeder Handler eindeutig einem Element zugeordnet.

---

## Verdikt

Zählung blockierender Findings: **2 MEDIUM** (Finding 1, Finding 2), 0 HIGH, 3 NIT.

Da HIGH + MEDIUM > 0 → **CHANGES_REQUESTED**.

Beide MEDIUM-Findings sind eng umrissen und schnell behebbar (eine Zeile im Realitätscheck
korrigieren; eine Zeile in der Dropdown-Match-Logik auf `valueList` umstellen bzw. `quality`-Typ
entscheiden). Die NITs sind Dokuschärfungen und blockieren nicht, sollten aber im selben Durchlauf
mitgenommen werden. Nach diesen Korrekturen ist das Design implementierungsreif.
