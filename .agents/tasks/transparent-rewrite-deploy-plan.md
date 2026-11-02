# Transparent-Rewrite + FTPES-Deploy — Recherche & Umsetzungsplan

Read-only Investigation. Keine Code-Änderungen vorgenommen. Baseline verifiziert:
`.venv/bin/python -m pytest scripts/tests/test_deploy.py scripts/tests/test_config.py -q` → **24 passed**.

---

## 1. Zusammenfassung (Summary Answer zuerst)

**Zielbild, das funktioniert:**

- **Physischer Ort der App:** Unterordner `wine_app/` im Web-Root (FTP-Login landet im Root `/`). Dort liegen `index.html`, gehashte JS/CSS, `assets/` (inkl. `wines.json`, `wine-schema.json`), plus `wine_app/images/` und `wine_app/data/`.
- **Sichtbare URL:** `https://weinsprechstunde.de/` bleibt `/`. Ein **internes** `.htaccess`-Rewrite im Web-Root schreibt alle Requests transparent nach `/wine_app/...` um, ohne die Adresszeile zu ändern (kein `R=`-Redirect).
- **mod_rewrite/.htaccess:** Laut offizieller Host-Europe-FAQ ist `mod_rewrite` auf WebHosting-Paketen ab „WebHosting Basic" verfügbar und wird per `RewriteEngine On` in `.htaccess` aktiviert ([Quelle](https://www.hosteurope.de/faq/webhosting/webpack/informationen-zu-mod-rewrite)). Das bestätigt Apache + ausgewertete `.htaccess`. **Sicherheit: hoch** (offizielle Doku), aber der konkrete Paket-Tarif dieses Accounts ist nicht aus dem Repo verifizierbar → ein minimal-invasiver Server-Test (Abschnitt 8) bestätigt es endgültig.
- **base-href:** Empfehlung **`<base href="/">`** (die App „denkt", sie liegt im Root). Das passt zur sichtbaren Root-URL; der Rewrite mappt alle `/<asset>`-Pfade nach `/wine_app/<asset>`. `<base href="/wine_app/">` (die „Variante 2" aus Nutzersicht) würde `/wine_app/`-Präfixe in Navigations-URLs sichtbar machen und widerspricht dem Wunsch „URL bleibt `/`".
  > **Hinweis zur Begriffs-Kollision:** Der Nutzer sagte „Variante 2". In seiner Formulierung (Nachricht 11/12) meint „Variante 2" = *interner Rewrite statt sichtbarer Weiterleitung*. In der base-href-Analyse dieses Berichts ist „Variante 2" = `<base href="/wine_app/">`. Das sind zwei verschiedene Nummerierungen. Der **Nutzerwille** (unsichtbarer Rewrite, URL bleibt `/`) wird technisch durch **`<base href="/">` + internes Rewrite** erfüllt — siehe Abschnitt 4.
- **Assets:** `wines.json`/`wine-schema.json` werden vom Frontend **relativ** als `assets/wines.json` geladen (kein führender Slash → base-href-sicher). Bilder werden über `IMAGE_BASE = '/images/'` (**absolut**) referenziert. Beides funktioniert hinter dem Rewrite korrekt, wenn der Rewrite `/images/...` und `/assets/...` nach `/wine_app/...` mappt. **Entscheidung:** `IMAGE_BASE` bleibt `/images/` (absolut), keine Code-Änderung am Frontend nötig; siehe Abschnitt 5 für die eine Design-Entscheidung zum Bild-Deploy-Ort.
- **Deploy-Umbau:** `scripts/weinimport.py` von paramiko-SFTP auf **`ftplib.FTP_TLS`** (FTPES) umstellen, mit `auth()`/`login()`/`prot_p()`, passivem Modus und **deaktivierter Zertifikatsprüfung** (`ssl._create_unverified_context()` wegen Hostname-Mismatch auf Shared Hosting). Der funktionierende Verbindungscode existiert bereits in `scripts/ftps_probe.py` und dient als Vorlage.
- **Pre-Deploy-Backup entfernen:** Der serverseitige `SITE CPFR/CPTO`-Backup-Mechanismus funktioniert auf diesem Pure-FTPd **nicht** (`SITE HELP` zeigt nur ALIAS/CHMOD/IDLE/UTIME). Er ist vollständig zu entfernen; `wine_app/` wird beim Deploy einfach überschrieben.
- **Prune-Scope:** Nur **innerhalb `wine_app/`** prunen, nie im Web-Root `/`. `images/` und `data/` (unter `wine_app/`) bleiben per bestehender `_protected_prefixes`-Logik geschützt. Die `.htaccess` liegt **außerhalb** `wine_app/` und wird vom Prune nie berührt.
- **Secrets:** `host`/`user`/`password` raus aus `weinsprechstunde.config.json`. Neue unversionierte `weinsprechstunde.secrets.json` (in `.gitignore`), Auflöse-Reihenfolge **Config → Secrets-Datei → Env-Var** `WEINSPRECHSTUNDE_DEPLOY_PASSWORD` (Env bleibt CI-Fallback). Versionierte `weinsprechstunde.secrets.example.json` als Vorlage.

---

## 2. Evidenz (mit Datei-/Symbol-Zitaten)

### 2.1 Frontend lädt Daten relativ, Bilder absolut

- `frontend/src/app/services/wine-data.service.ts` → `WineDataService.loadAll()`:
  `this.http.get<Wine[]>('assets/wines.json')` und `'assets/wine-schema.json'` — **relative** Pfade (kein führender `/`). Relative HTTP-Pfade werden gegen das `<base href>` aufgelöst; mit `<base href="/">` ergibt das `/assets/...`.
- `frontend/src/app/models/wine-util.ts`:
  ```ts
  export const IMAGE_BASE = '/images/';              // ABSOLUT (führender Slash)
  export function mediaSrc(file) { return isPresent(file) ? IMAGE_BASE + file : null; }
  ```
  Verwendet in `wine-tile-cover.ts` (`src = computed(() => mediaSrc(this.wine().image))`) und in `wine-detail-dialog.ts`. Bild-URLs sind also immer `/images/<datei>` — base-href-**un**abhängig, weil absolut.
- Test, der das `/images/`-Präfix festschreibt: `frontend/src/app/models/wine-util.spec.ts` → `describe('mediaSrc') … expect(mediaSrc('a.jpg')).toBe('/images/a.jpg')`.
- Test, der die relativen Datenpfade festschreibt: `frontend/src/app/services/wine-data.service.spec.ts` → `httpMock.expectOne('assets/wines.json')` / `'assets/wine-schema.json'`.

### 2.2 base-href & Routing

- `frontend/src/index.html`: `<base href="/">`.
- `frontend/src/app/app.config.ts`: `provideRouter(routes)`, `provideHttpClient()`, zoneless.
- `frontend/src/app/app.routes.ts`:
  ```ts
  export const routes = [
    { path: '', component: WineWallComponent },
    { path: '**', redirectTo: '' },
  ];
  ```
  → Client-Side-Routing ist aktiv. Deep-Links/Reload müssen serverseitig auf die App-`index.html` fallen (SPA-Fallback), sonst 404 auf dem Apache.

### 2.3 Build-Output (verifiziert)

- `frontend/angular.json`: Builder `@angular/build:application`, `assets` = `public/**` (nach Root) + `src/assets/**` (nach `assets/`). Projekt `ng-weinsprechstunde`.
- Tatsächliches Layout (`frontend/dist/ng-weinsprechstunde/browser/`):
  `index.html`, `main-*.js`, `styles-*.css`, `assets/`, `favicon.ico`, **`images/`**.
  → `images/` landet aktuell **im Build**, weil der Symlink `frontend/public/images -> ../../export/images` (bestätigt per `ls -la frontend/public`) als Asset mitkopiert wird.
- `frontend/package.json`: `"build": "ng build"`, `@angular/build ^22.0.9`.
- `scripts/weinimport.py` → `_resolve_dist_dir()` löst `frontend/dist/<projekt>/browser/` korrekt als Deploy-Wurzel auf (Test `test_resolve_dist_dir_flat_and_nested`).

### 2.4 Deploy-Code (IST-Zustand)

- `weinimport.py`, `DeployConfig` Felder: `protocol, host, user, password, remote_path, remote_images_path, remote_import_path`.
- `phase_deploy()` verzweigt auf `_deploy_sftp` (protocol `sftp`) oder `_deploy_ftp` (sonst). Beide: Upload dist → **`_predeploy_server_backup_*` (SITE CPFR/CPTO bzw. SSH-`cp -a`)** → `_*_prune` → `wines.json` → Bilder.
- Prune-Schutz: `_protected_prefixes(config)` schützt `Path(export_path).name` (= `wines.json`) exakt und — wenn `remote_images_path` unter `remote_path` liegt — den Bilder-Prefix. `_is_protected()` wendet das an. **Wichtig:** aktuell ist in der Config `remote_images_path = "/images"` (NICHT unter `/wine_app`), daher greift der Prefix-Schutz derzeit nicht — muss korrigiert werden (Abschnitt 5).
- FTP-Verbindung aktuell: `ftplib.FTP(host)` **ohne TLS** (`_deploy_ftp`, `_download_ftp`, `_remote_backup`). Kein `FTP_TLS`, kein `prot_p()`.
- `resolve_password(config)`: liest `config.deploy.password`, Fallback Env `WEINSPRECHSTUNDE_DEPLOY_PASSWORD`, sonst `sys.exit(1)`.
- `load_config()`: parst `raw["deploy"]`, `raw["editor"]`, optional `raw["backup"]` zu Dataclasses. **Keine** Secrets-Datei-Logik.

### 2.5 Config / CI / Probe

- `weinsprechstunde.config.json`: `protocol "sftp"`, `host "wp13170803.server-he.de"`, `user "datentransfer@weinsprechstunde.de"`, `password ""`, `remote_path "/wine_app"`, `remote_images_path "/images"`, `remote_import_path "/data"`, `backup.remote_backup_dir "/backup"`.
- `.github/workflows/deploy.yml`: setzt `WEINSPRECHSTUNDE_DEPLOY_PASSWORD` aus GitHub Secrets; Schritte: prepare → export → image-export → `npm run build` (in `frontend`) → `deploy`.
- `scripts/ftps_probe.py`: **funktionierende FTPES-Referenz** — `ftplib.FTP_TLS(context=ssl._create_unverified_context())`, `connect(host,21)`, `auth()`, `login()`, `prot_p()`. Nutzer-Log bestätigt: Login OK, Root `/` enthält `index.html, cgi-bin, .well-known, wine_app`; `wine_app/` enthält `images`, `data`; `SITE HELP` = nur ALIAS/CHMOD/IDLE/UTIME → **CPFR/CPTO nicht verfügbar**.
- `scripts/requirements.txt`: `paramiko==5.1.0` (wird nach FTPES-Umbau für Deploy nicht mehr gebraucht — siehe Abschnitt 6 für Entscheidung).

---

## 3. Frage 1 — mod_rewrite/.htaccess auf Host Europe?

**Antwort: Ja, mit hoher Sicherheit.** Die offizielle Host-Europe-FAQ bestätigt: `mod_rewrite` ist ein Apache-Modul, verfügbar „auf unseren WebHosting Paketen ab WebHosting Basic" und WebServern, und wird per `RewriteEngine On` in einer `.htaccess` aktiviert. Regeln vor dieser Zeile werden nicht ausgeführt. *(Inhalt zur Lizenz-Compliance paraphrasiert.)*
Quelle: https://www.hosteurope.de/faq/webhosting/webpack/informationen-zu-mod-rewrite

Das impliziert zugleich, dass der Webserver Apache ist und `.htaccess` ausgewertet wird (AllowOverride ist auf Shared Hosting für Kundenverzeichnisse üblich freigeschaltet, sonst wäre die FAQ sinnlos). Der Probe-Log zeigt Pure-FTPd nur als **FTP-Daemon** — das sagt nichts über den HTTP-Server; FTP und HTTP sind getrennte Dienste. Die FAQ ist die maßgebliche Aussage zum Webserver.

**Unsicherheit:** Der konkrete Tarif dieses Accounts (≥ „WebHosting Basic"?) ist aus dem Repo nicht verifizierbar. Falls der Server wider Erwarten nginx/LiteSpeed wäre: LiteSpeed liest `.htaccess` kompatibel zu Apache (mod_rewrite-Syntax wird unterstützt); nginx dagegen ignoriert `.htaccess` komplett. → Der Server-Test in Abschnitt 8 entscheidet das endgültig und minimal-invasiv.

Weitere, nicht-Host-Europe-Belege zur mod_rewrite/`.htaccess`-Mechanik (Hintergrund, kein Produktbeleg): SELFHTML-Wiki `Webserver/htaccess` (https://wiki.selfhtml.org/wiki/Webserver/htaccess); Apache-Beispiele für SPA-Rewrites (https://github.com/azureossd/react-apache-webserver-htaccess).

---

## 4. Frage 2 — konkrete `.htaccess` für transparenten Rewrite

Ziel: Alle Requests auf `/` (Assets, `wines.json`, Client-Routen) werden intern aus `/wine_app/` bedient; die Adresszeile bleibt `/`; statische Dateien bleiben Dateien; SPA-Deep-Links fallen auf `/wine_app/index.html`; `.well-known` (Let's Encrypt) wird **nicht** umgeschrieben.

Die Datei liegt im **Web-Root** (`/.htaccess`), nicht in `wine_app/`.

```apache
# /.htaccess  (Web-Root) — transparenter interner Rewrite nach /wine_app/
# Die sichtbare URL bleibt "/", es findet KEINE externe Weiterleitung (R=) statt.

RewriteEngine On
# Basis des Rewrites ist der Web-Root. (Kein RewriteBase nötig, da wir
# absolute interne Ziele mit führendem /wine_app/ verwenden.)

# 1) ACME / Let's Encrypt NIE umschreiben — muss im Root bedienbar bleiben.
RewriteRule ^\.well-known/ - [L]

# 2) Endlosschleife verhindern: bereits nach /wine_app/ aufgelöste
#    Requests nicht erneut umschreiben.
RewriteRule ^wine_app/ - [L]

# 3) Existiert die angefragte Datei/der Ordner BEREITS im Root
#    (z.B. index.html im Root, cgi-bin), NICHT nach wine_app umschreiben.
#    (Optional/defensiv — kann entfallen, wenn der Root außer Infra leer sein soll.)
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]

# 4) Existiert die Ressource als DATEI unter wine_app/ (JS, CSS, Bilder,
#    assets/wines.json, favicon.ico ...), liefere sie direkt von dort aus —
#    OHNE sichtbare URL-Änderung (interner Rewrite, kein Redirect).
RewriteCond %{DOCUMENT_ROOT}/wine_app/%{REQUEST_URI} -f
RewriteRule ^(.*)$ /wine_app/$1 [L]

# 5) SPA-Fallback: alles Übrige (Angular-Client-Routen, Reload auf Deep-Link)
#    intern auf die App-index.html im Unterordner.
RewriteRule ^ /wine_app/index.html [L]
```

**Erläuterung der Logik (zu den Anforderungen a/b):**
- (b) Regel 4 nutzt `RewriteCond … -f` gegen `%{DOCUMENT_ROOT}/wine_app/%{REQUEST_URI}`: nur **existierende Dateien** werden als Datei ausgeliefert → JS/CSS/Bilder/`wines.json` bleiben statische Dateien, werden nicht auf `index.html` umgeschrieben.
- (a) Regel 5 fängt alles ab, was keine Datei ist (Angular-Routen, Reload auf Route) → interner Rewrite auf `/wine_app/index.html`. Da kein `R=`-Flag gesetzt ist, bleibt die Adresszeile unverändert `/`.
- `.well-known` (Regel 1) und ein bereits vorhandenes Root-`index.html` (Regel 3) werden geschützt. Hinweis: Steht im Root noch ein altes `index.html` (laut Probe-Log vorhanden), würde Regel 3 es ausliefern statt der App. **Empfehlung:** altes Root-`index.html` einmalig entfernen/umbenennen, oder Regel 3 weglassen, damit `/` immer auf die App fällt. Diese Entscheidung ist im Umsetzungsplan (Abschnitt 9) als expliziter Schritt vermerkt.

**base-href-Kopplung:** Diese `.htaccess` funktioniert zusammen mit `<base href="/">` (Abschnitt 4-Empfehlung), weil die App ihre Assets als `/assets/...`, `/main-*.js`, `/images/...` anfragt und Regel 4 diese 1:1 auf `/wine_app/...` mappt.

---

## 5. Frage 3 — base-href-Strategie

**Empfehlung: `<base href="/">`.**

| | `<base href="/">` (empfohlen) | `<base href="/wine_app/">` |
|---|---|---|
| Asset-Requests | `/main-*.js`, `/assets/wines.json`, `/images/x.jpg` → Rewrite-Regel 4 mappt sauber nach `/wine_app/...` | `/wine_app/main-*.js` etc. — würde die Assets direkt treffen, aber… |
| Sichtbare URL bei Navigation | bleibt `/` ✅ (Router nutzt base `/`) | Router baut URLs mit `/wine_app/`-Präfix → **sichtbar** in der Adresszeile ❌ |
| Passt zu „URL bleibt `/`" (Nutzerwunsch) | **Ja** | Nein |
| Aufwand im Code | **keiner** (index.html hat bereits `<base href="/">`) | `index.html` ändern + Build-Flag |

Begründung: Der Nutzer will ausdrücklich, dass die App unter der blanken Domain `https://weinsprechstunde.de/` erscheint und die URL **nicht** sichtbar auf `/wine_app/` wechselt (Nachricht 9, 11, 12). `<base href="/">` lässt die App so tun, als läge sie im Root; der physische Unterordner wird komplett durch das Root-`.htaccess` versteckt. Mit `<base href="/wine_app/">` würde der Angular-Router bei jeder Navigation `/wine_app/...` in die Adresszeile schreiben — genau das, was der Nutzer ablehnt.

Da `index.html` bereits `<base href="/">` hat, ist **keine Änderung** nötig. Der Vollständigkeit halber das explizite Build-Kommando (das aktuelle `ng build` ohne Flag liefert bereits `/`):

```bash
# in frontend/
ng build --base-href=/           # entspricht dem aktuellen Default
# bzw. unverändert:
npm run build
```

**Routing-Konfiguration geprüft:** `app.routes.ts` hat `path:''` + Wildcard-Redirect, `app.config.ts` nutzt `provideRouter`. Deep-Link/Reload erfordert daher den SPA-Fallback (Regel 5 der `.htaccess`). Kein `useHash` konfiguriert → PathLocationStrategy, konsistent mit `<base href="/">`.

---

## 6. Frage 4 — Asset-Orte & Frontend-Verlinkung

**Vorgabe:** Bilder → `wine_app/images`, `wines.json` → `wine_app/data`.

### IST-Zustand (verifiziert)
- `wines.json` wird **in den Build gebündelt**: `export_path = ./frontend/src/assets/wines.json` → `ng build` kopiert es nach `browser/assets/wines.json`; das Frontend lädt es relativ als `assets/wines.json`. Es wird also **mit dem dist-Upload** ausgeliefert, nicht separat nach `data/`.
- Bilder werden **ebenfalls in den Build gebündelt**: Symlink `frontend/public/images -> ../../export/images` → `ng build` kopiert nach `browser/images/`. Das Frontend referenziert sie absolut als `/images/<datei>` (`IMAGE_BASE`).

Es gibt also eine **Spannung** zwischen der Vorgabe (Bilder/JSON separat nach `wine_app/images` bzw. `wine_app/data` deployen) und dem aktuellen Build, der beides selbst ausliefert. Zwei kohärente Design-Optionen:

**Option A (empfohlen) — Alles aus dem Build, Bilder relativ belassen, `data/` als zweite Quelle.**
- Bilder bleiben im Build (`browser/images/`) und werden über `/images/` geladen. Der Deploy lädt zusätzlich die skalierten Bilder nach `wine_app/images/` — was ohnehin identisch ist (gleiche Quelle `export/images`). `IMAGE_BASE='/images/'` + Rewrite-Regel 4 → `/wine_app/images/...` funktioniert **lokal** (`ng serve` liefert `public/images` unter `/images/`) **und live**. Keine Frontend-Code-Änderung.
- `wines.json`: bleibt unter `assets/` (gebündelt, relativ geladen). Der separate `data/`-Upload wäre dann redundant.
- **Vorteil:** minimale Änderung, kein Frontend-Risiko, alle Frontend-Tests bleiben grün (`wine-util.spec` erwartet `/images/`, `wine-data.service.spec` erwartet `assets/wines.json`).
- **Konsequenz für die Vorgabe:** „Bilder in images, wines.json in data" wird teilweise anders umgesetzt (JSON bleibt in `assets/`). Das sollte mit dem Nutzer bestätigt werden — siehe Risiko R-5.

**Option B — Strikt nach Vorgabe: JSON nach `wine_app/data`, Bilder nach `wine_app/images`, NICHT gebündelt.**
- Frontend-Änderungen nötig: Datenservice lädt `data/wines.json` + `data/wine-schema.json` statt `assets/...`; Build bündelt diese nicht mehr (export-Ziel aus `src/assets` herausnehmen, Symlink `public/images` entfernen, damit Bilder nicht doppelt deployt werden). Tests `wine-data.service.spec.ts` müssten auf `data/...` angepasst werden. `IMAGE_BASE` bliebe `/images/` (Rewrite mappt nach `/wine_app/images/`).
- Für `ng serve` (lokal) müssten `data/` und `images/` dann über `public/data`/`public/images`-Symlinks verfügbar gemacht werden, sonst scheitert die lokale Entwicklung.
- **Nachteil:** mehr bewegliche Teile, mehr Test-/Build-Anpassung, höheres Bruchrisiko.

**Empfehlung:** **Option A.** Sie erfüllt Nutzerintention (Bilder in `images/`, App live lauffähig, lokal lauffähig) mit minimalem Risiko. Die physische `wine_app/data/`-Ablage existiert serverseitig bereits (laut Probe), kann aber ungenutzt bleiben oder optional zusätzlich befüllt werden. Der Punkt „wines.json nach data" wird als bewusste Abweichung dokumentiert und ist mit dem Nutzer zu bestätigen (R-5).

> Der bestehende Symlink `frontend/public/images -> ../../export/images` ist zentral: Er macht die skalierten Bilder (`export/images`, erzeugt von `phase_image_export`) sowohl `ng serve` als auch `ng build` unter `/images/` verfügbar. Bei Option A bleibt er unverändert.

---

## 7. Frage 5 — Deploy-Skript-Umbau (`scripts/weinimport.py`)

### 7.1 FTPES statt SFTP / plain FTP
Vorlage ist `scripts/ftps_probe.py`. Benötigt wird eine zentrale Verbindungsfunktion, z.B. neu `_ftps_connect(host, user, password) -> FTP_TLS`:

```python
import ssl, ftplib
def _ftps_connect(host, user, password):
    verify = os.environ.get("FTPS_VERIFY", "1") != "0"
    ctx = ssl.create_default_context() if verify else ssl._create_unverified_context()
    ftp = ftplib.FTP_TLS(context=ctx)
    ftp.connect(host, 21, timeout=20)
    ftp.auth()            # explizites TLS auf Kontrollkanal (FTPES)
    ftp.login(user, password)
    ftp.prot_p()          # Datenkanal verschlüsseln
    ftp.set_pasv(True)    # passiver Modus (Shared Hosting / NAT)
    return ftp
```
Da das Zertifikat einen Hostname-Mismatch hat (CN/SAN leer — Nutzer-Log), muss `FTPS_VERIFY=0` der Default-Pfad für diesen Account sein bzw. `ssl._create_unverified_context()` verwendet werden. Verbindung bleibt verschlüsselt, nur die Zertifikatsprüfung entfällt.

### 7.2 Betroffene Funktionen
- **`DeployConfig.protocol`**: `sftp`-Zweig entfällt faktisch. Entweder `protocol` auf `"ftps"` normieren oder `_deploy_ftp` zum einzigen Pfad machen. Empfehlung: `protocol`-Semantik auf FTPES festlegen; SFTP-/paramiko-Pfad entfernen.
- **`_deploy_ftp(config, password)`**: `ftplib.FTP(host)` + `login()` → `_ftps_connect(...)`. Upload-/Prune-Schleifen bleiben inhaltlich, aber: **`_predeploy_server_backup_ftp(...)`-Aufruf entfernen** (Abschnitt 7.4).
- **`_download_ftp(...)`** (für `import_source="remote"`): ebenfalls auf `_ftps_connect` umstellen.
- **`_remote_backup(...)`** (Import-Backup über FTP): auf `_ftps_connect` umstellen ODER mit entfernen, falls Remote-Import-Backup nicht mehr gewünscht (prüfen; Import-Backup ist unabhängig vom Pre-Deploy-Backup).
- **`_upload_ftp`, `_ftp_makedirs`, `_ftp_prune`, `_ftp_is_dir`, `_ftp_up_to_date`, `_ftp_download_dir`**: unverändert verwendbar (arbeiten auf einem übergebenen FTP-Objekt — `FTP_TLS` ist Subklasse von `FTP`).
- **Entfernen (SFTP):** `_deploy_sftp`, `_sftp_connect`, `_upload_sftp`, `_download_sftp`, `_sftp_download_dir`, `_sftp_makedirs`, `_upload_dir_sftp`, `_sftp_up_to_date`, `_sftp_prune`, `_sftp_makedirs` — sowie der `sftp`-Branch in `phase_deploy`, `download_remote_import`, `_remote_backup`.
- **requirements.txt:** `paramiko==5.1.0` kann entfernt werden, wenn kein SFTP-Pfad mehr existiert. (Entscheidung: entfernen, da nicht mehr genutzt.)

### 7.3 remote_path / Upload- & Prune-Ziele
Der FTP-Login landet in `/` (= Web-Root). Zielwerte:
- `remote_path = "wine_app"` (bzw. `/wine_app` — der Login-Root ist `/`, beide funktionieren; die bestehende Config hat `/wine_app`).
- `remote_images_path = "/wine_app/images"` (bisher fälschlich `/images`).
- `remote_import_path = "/wine_app/data"` (bisher fälschlich `/data`).

Damit liegen `images` und `data` **unter** `remote_path`. Jetzt greift die bestehende Schutzlogik automatisch:
- `_protected_prefixes(config)` berechnet `base = "/wine_app"`, `images = "/wine_app/images"`; da `images.startswith(base + "/")`, wird der Prefix `"images/"` geschützt. `wines.json` ist über `Path(export_path).name` exakt geschützt.
- `_ftp_prune(...)` läuft nur ab `remote_base = /wine_app` → es wird **nie** im Web-Root `/` geprunt. `.htaccess`, `cgi-bin`, `.well-known`, altes `index.html` im Root bleiben unberührt.
- **`data/` schützen:** `_protected_prefixes` schützt aktuell nur den Bilder-Prefix. Da `data/` (bei Option A) nicht aus dem dist-Build stammt, würde der Prune es als „nicht in keep" löschen. → `_protected_prefixes` erweitern, sodass auch `remote_import_path` (relativ zu `base`) als geschützter Prefix zurückgegeben wird. (Konkreter Plan-Schritt in Abschnitt 9.)

### 7.4 Pre-Deploy-Backup (SITE CPFR/CPTO) entfernen
`SITE HELP` auf diesem Pure-FTPd zeigt nur `ALIAS/CHMOD/IDLE/UTIME` → `CPFR/CPTO` fehlt, das serverseitige Backup kann nicht funktionieren. Der Nutzer will **kein** automatisches Pre-Deploy-Backup mehr; `wine_app/` wird überschrieben.

Zu entfernen / betroffen:
- Klasse `PreDeployBackupError`.
- Funktionen `_predeploy_remote_backup_dir`, `_max_predeploy_backups`, `_predeploy_server_backup_sftp`, `_predeploy_server_backup_ftp`, `_ftp_server_copy_dir`, `_prune_predeploy_backups_server`, `_prune_predeploy_backups_server_ftp`, `_ssh_exec`, `_shq`, Konstante `MAX_PREDEPLOY_BACKUPS`, Helfer `_ftp_rmtree` (sofern nur vom Predeploy genutzt — prüfen).
- In `_deploy_ftp`/`_deploy_sftp`: den `_predeploy_server_backup_*`-Aufruf vor dem Prune streichen. Die Reihenfolge wird: Upload dist → Prune (direkt) → wines.json → Bilder.
- In `phase_deploy`: den `except PreDeployBackupError`-Zweig entfernen; die „ohne Backup nicht prunen"-Logik entfällt.
- `BackupConfig.max_predeploy_backups` wird obsolet (Feld kann bleiben, wird ignoriert; sauberer: entfernen).
- **Tests:** In `scripts/tests/test_deploy.py` sind viele Tests an das Pre-Deploy-Backup gebunden und müssen entfernt/umgeschrieben werden: `test_predeploy_backup_*`, `test_deploy_does_not_prune_when_backup_fails`, `test_backup_failure_message_is_distinct_from_connection_error`, `test_deploy_aborts_without_remote_backup_dir`, `test_ftp_deploy_copies_remote_path_server_side_before_prune`, `test_ftp_deploy_does_not_prune_when_backup_fails`. Die `FakeFTP`/`FakeTransport`/`FakeChannel`-Attrappen für SSH-Exec und SITE-Copy entfallen. Neue Tests: Deploy lädt nach `/wine_app` hoch, prunt NUR dort, schützt `images/`+`data/`+`wines.json`, nutzt `FTP_TLS` (gemockt).

---

## 8. Frage 6 — `.htaccess` beim Deploy verwalten?

Die Rewrite-`.htaccess` liegt im **Web-Root `/`**, also **außerhalb `wine_app/`**. Der Deploy lädt nach `/wine_app` hoch und prunt nur dort → die Root-`.htaccess` wird vom Deploy **nie berührt oder gelöscht**. Das ist genau gewünscht (Infrastruktur im Root bleibt stabil).

**Empfehlung: versioniert im Repo, manueller Einmal-Upload — NICHT vom Deploy-Skript verwaltet.**
- Ablage im Repo z.B. `deploy/htaccess-webroot.txt` (oder `server/.htaccess`), dokumentiert und reviewbar.
- Einmaliger manueller Upload in den Web-Root `/.htaccess` (per FTPES-Client oder einem kleinen, separaten, explizit aufgerufenen Hilfsskript/Make-Target wie `make upload-htaccess`).
- **Gründe gegen automatische Verwaltung durch den Deploy:** (1) Das Deploy-Skript soll bewusst nur `wine_app/` anfassen (Blast-Radius klein halten, Root-Infra nie gefährden). (2) Die `.htaccess` ändert sich praktisch nie, ein Upload bei jedem Deploy ist unnötiges Risiko. (3) Ein versehentlicher Fehler in der Root-`.htaccess` legt die ganze Domain lahm — ein bewusster, seltener manueller Schritt ist sicherer als Automatik.
- Falls später doch Automatik gewünscht: separates, eigenständiges Target, das ausschließlich `/.htaccess` hochlädt und **keinen** Prune im Root ausführt.

---

## 9. Frage 7 — Secrets-Handling

**Ziel:** `host`/`user`/`password` nicht im Git. Auflöse-Reihenfolge **Config → Secrets-Datei → Env-Var** (Env = CI-Fallback).

### Änderungen
1. **`weinsprechstunde.config.json`**: `deploy.host`, `deploy.user`, `deploy.password` leeren bzw. entfernen (host/user ebenfalls, da nicht ins Git gewünscht — Nutzer-Nachricht 1). Die nicht-sensiblen Felder (`protocol`, `remote_path`, `remote_images_path`, `remote_import_path`) bleiben in der Config.
2. **Neue `weinsprechstunde.secrets.json`** (unversioniert), z.B.:
   ```json
   { "host": "wp13170803.server-he.de",
     "user": "datentransfer@weinsprechstunde.de",
     "password": "…" }
   ```
3. **`.gitignore`** ergänzen: `weinsprechstunde.secrets.json`.
4. **Versionierte Vorlage** `weinsprechstunde.secrets.example.json` mit Platzhaltern (committen).
5. **`load_config()`** erweitern: nach dem Parsen der Config eine optionale `weinsprechstunde.secrets.json` laden (fester Pfad neben der Config oder via `--secrets`-Arg) und `host`/`user`/`password` in `DeployConfig` überschreiben, **sofern in der Config leer**. Reihenfolge: Config-Wert (wenn gesetzt) > Secrets-Datei-Wert. Fehlt die Secrets-Datei, ist das kein Fehler (CI nutzt Env).
6. **`resolve_password(config)`** anpassen auf die 3-stufige Kette:
   - `config.deploy.password` (falls nach load_config gesetzt, inkl. Secrets) →
   - ansonsten Secrets-Datei (falls `load_config` sie nicht schon eingespielt hat — bei zentraler Einspeisung in `load_config` reduziert sich `resolve_password` auf „Config-Wert oder Env") →
   - ansonsten Env `WEINSPRECHSTUNDE_DEPLOY_PASSWORD` →
   - sonst `sys.exit(1)` mit der bestehenden, getesteten Meldung.
   **Hinweis:** Die bestehenden Tests `test_password_from_config`, `test_password_from_env_fallback`, `test_missing_password_exits_with_req_6_11_message` müssen grün bleiben — die Env-Fallback-Meldung und der Config-Vorrang dürfen sich nicht ändern. Neue Tests: host/user/password aus Secrets-Datei; Config-Vorrang vor Secrets; Secrets vor Env.
7. **CI (`deploy.yml`)**: bleibt unverändert — setzt weiterhin nur `WEINSPRECHSTUNDE_DEPLOY_PASSWORD` aus GitHub Secrets. **ABER:** host/user stehen dann nicht mehr in der Config und es gibt keine Secrets-Datei in CI. → host/user müssen in CI ebenfalls aus Env kommen. **Plan:** zusätzliche Env-Vars `WEINSPRECHSTUNDE_DEPLOY_HOST`/`_USER` als weitere Fallback-Stufe in `load_config`/resolve einführen und in `deploy.yml` aus GitHub Secrets setzen. (Sonst scheitert der CI-Deploy, weil host/user fehlen.) Dies ist eine notwendige Ergänzung zur reinen Passwort-Kette — als Risiko R-4 vermerkt.

---

## 10. Umsetzungsplan (schrittweise, nummeriert)

1. **Secrets entkoppeln.** `weinsprechstunde.secrets.example.json` anlegen (committen); `.gitignore` um `weinsprechstunde.secrets.json` ergänzen; `host`/`user`/`password` aus `weinsprechstunde.config.json` entfernen. Lokale (unversionierte) `weinsprechstunde.secrets.json` mit echten Werten anlegen.
2. **`load_config` + `resolve_password`** erweitern: Secrets-Datei laden (host/user/password), Env-Fallback für password (und host/user für CI). Bestehende Passwort-Tests grün halten; neue Tests für Secrets-Kette.
3. **FTPES-Transport** einführen: `_ftps_connect()` (aus `ftps_probe.py` übernehmen), passiver Modus, `FTPS_VERIFY=0`-Default/unverified context. `_deploy_ftp`/`_download_ftp`/ggf. `_remote_backup` darauf umstellen.
4. **SFTP/paramiko entfernen**: `_deploy_sftp` & alle `_sftp_*`, paramiko-Imports, `sftp`-Branches in `phase_deploy`/`download_remote_import`/`_remote_backup`; `paramiko` aus `requirements.txt`.
5. **Pre-Deploy-Backup entfernen** (Abschnitt 7.4): alle `_predeploy_*`/`_ssh_exec`/`_shq`/`SITE CP`-Funktionen, `PreDeployBackupError`, `MAX_PREDEPLOY_BACKUPS`, zugehörige Aufrufe und den `except PreDeployBackupError`-Zweig in `phase_deploy`. Deploy-Reihenfolge: Upload → Prune → wines.json → Bilder.
6. **Ziele korrigieren**: in Config `remote_images_path = "/wine_app/images"`, `remote_import_path = "/wine_app/data"` (remote_path bleibt `/wine_app`). `_protected_prefixes` erweitern, sodass zusätzlich `remote_import_path` (relativ zu base) als geschützter Prefix zurückkommt → `data/` wird beim Prune nie gelöscht.
7. **Deploy-Tests anpassen** (`scripts/tests/test_deploy.py`): Predeploy-/SFTP-Tests entfernen; `FakeFTP` auf `FTP_TLS`-Mock umstellen; neue Tests: Upload nach `/wine_app`, Prune nur dort, `images/`+`data/`+`wines.json` geschützt.
8. **Frontend (Option A):** keine Code-Änderung an `IMAGE_BASE`/Datenservice; `<base href="/">` belassen. (Nur falls Nutzer Option B wählt: Datenservice auf `data/...`, Symlink/Build anpassen, Tests ändern.)
9. **Root-`.htaccess`** erstellen und im Repo ablegen (`deploy/htaccess-webroot.txt`), Inhalt aus Abschnitt 4. Altes Root-`index.html` einmalig entfernen/umbenennen (sonst verdeckt es die App) — oder Regel 3 weglassen.
10. **Server-Verifikation** (Abschnitt 11): Test-`.htaccess` + Probe-Datei hochladen, Browser-Check; danach echte `.htaccess` + ersten App-Deploy.
11. **CI prüfen:** `deploy.yml` um `WEINSPRECHSTUNDE_DEPLOY_HOST`/`_USER`-Env (aus GitHub Secrets) ergänzen, falls host/user nicht mehr in Config liegen.
12. **Gesamt-Verifikation:** `pytest scripts/tests`, `npm run build` (frontend), manueller FTPES-Deploy auf Testbasis, Browser-Check `https://weinsprechstunde.de/` + Deep-Link-Reload + Bild-Load.

---

## 11. Risiken & Unsicherheiten + minimal-invasive Server-Tests

- **R-1 (mittel): Ist mod_rewrite/.htaccess wirklich aktiv auf diesem Account?** Offizielle FAQ sagt ja ab „WebHosting Basic", aber Tarif nicht aus Repo verifizierbar.
  *Test:* Datei `/.htaccess` mit nur `RewriteEngine On` + einer Testregel hochladen, z.B. `RewriteRule ^rwtest$ /wine_app/index.html [L]`, dann `https://weinsprechstunde.de/rwtest` im Browser aufrufen. Zeigt es die App ohne URL-Änderung → mod_rewrite aktiv. 500-Fehler → `.htaccess` wird gelesen, aber Direktive abgelehnt (AllowOverride). Keine Wirkung/404 → `.htaccess` wird ignoriert (ggf. nginx/falscher Tarif).
- **R-2 (mittel): SPA-Fallback vs. statische Dateien.** Fehlkonfiguration der `-f`-Condition kann dazu führen, dass Assets fälschlich auf `index.html` fallen (JS lädt dann HTML → App bricht).
  *Test:* nach `.htaccess`-Upload gezielt eine Asset-URL prüfen (`/assets/wines.json` muss JSON liefern, `/main-*.js` JS) und eine Deep-Link-URL (Reload darf nicht 404).
- **R-3 (niedrig): base-href-Fallstrick.** Bei versehentlichem `<base href="/wine_app/">` erscheinen `/wine_app/`-URLs sichtbar. Gegenmaßnahme: `<base href="/">` festnageln, im Build-Schritt nicht überschreiben.
- **R-4 (mittel): host/user in CI.** Nach Entfernen aus der Config fehlen host/user im CI-Lauf (keine Secrets-Datei). → zusätzliche Env-Vars in `deploy.yml` nötig (Plan-Schritt 11), sonst schlägt der automatische Deploy fehl.
- **R-5 (mittel): Vorgabe „wines.json nach data" vs. aktueller Build.** Option A lässt `wines.json` in `assets/` (gebündelt), weicht also von der wörtlichen Vorgabe ab. Mit dem Nutzer bestätigen, ob Option A (minimal, empfohlen) oder Option B (strikt nach Vorgabe, mehr Umbau) gewünscht ist.
- **R-6 (niedrig): altes Root-`index.html`.** Laut Probe liegt im Root noch ein `index.html`; mit Rewrite-Regel 3 (-f-Schutz) würde es `/` belegen statt der App. Einmalig entfernen/umbenennen oder Regel 3 weglassen.
- **R-7 (niedrig): Zertifikats-Mismatch dauerhaft.** `FTPS_VERIFY=0` bleibt nötig (CN/SAN leer). Verbindung bleibt verschlüsselt, aber ohne Hostname-Verifikation — auf diesem Shared Hosting unvermeidbar und akzeptiert (Nutzer-Entscheidung).
- **R-8 (niedrig): Pure-FTPd Eigenheiten beim Prune.** `nlst`/`cwd`-basierte Verzeichniserkennung (`_ftp_is_dir`) ist auf manchen Servern langsam/fehleranfällig; vor dem ersten echten Prune mit kleinem Testbestand prüfen.

---

## 12. Quellen

- Host Europe FAQ, „Informationen zu mod_rewrite": https://www.hosteurope.de/faq/webhosting/webpack/informationen-zu-mod-rewrite (maßgeblich für Frage 1; Inhalt zur Lizenz-Compliance paraphrasiert)
- Host Europe Webhosting FAQ (Übersicht): https://www.hosteurope.de/faq/webhosting/webpack
- SELFHTML-Wiki, „Webserver/htaccess" (Hintergrund): https://wiki.selfhtml.org/wiki/Webserver/htaccess
- Apache-SPA-Rewrite-Beispiele (Hintergrund): https://github.com/azureossd/react-apache-webserver-htaccess

*Hinweis: Externe Inhalte wurden für die Lizenz-Compliance zusammengefasst/umformuliert.*
