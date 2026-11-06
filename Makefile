# Weinsprechstunde Build-Targets
#
# Einzelne Import-Phasen und die vollständige Deploy-Pipeline.
# Der Python-Interpreter kann über PYTHON überschrieben werden, z. B.:
#   make prepare PYTHON=.venv/bin/python
#
# Default-Auflösung des Interpreters (portabel):
#   1. lokales venv .venv/bin/python, falls vorhanden (z. B. dieser Mac)
#   2. sonst python3 (vorhanden in GitHub Actions und auf den meisten Systemen)
#   3. Fallback python
PYTHON ?= $(shell [ -x .venv/bin/python ] && echo .venv/bin/python || command -v python3 || echo python)

# FORCE_IMAGES=1 reicht --force-images an die deploy-Phase durch und lädt ALLE
# Bilder neu hoch (unabhängig vom Timestamp-Vergleich), z. B.:
#   make deploy FORCE_IMAGES=1
FORCE_IMAGES ?=
DEPLOY_FLAGS := $(if $(FORCE_IMAGES),--force-images,)

.PHONY: backup optimize-images prepare export image-export deploy all test test-pipeline test-deploy test-config

## backup: Backup der exportierten wines.json (Req 20); ohne Datei nur Warnung
backup:
	$(PYTHON) scripts/weinimport.py backup
## optimize-images: Originalbilder im Import-Ordner auf max. Höhe skalieren (in-place)
optimize-images:
	$(PYTHON) scripts/weinimport.py optimize-images

## prepare: JSON-Quelldateien aufbereiten (Phase prepare)
prepare:
	$(PYTHON) scripts/weinimport.py prepare

## export: wines.json erzeugen (Phase export)
export:
	$(PYTHON) scripts/weinimport.py export

## image-export: Bilder skalieren (Phase image-export)
image-export:
	$(PYTHON) scripts/weinimport.py image-export

## all: optimize-images -> prepare -> export -> image-export (ohne deploy)
all: optimize-images prepare export image-export

## deploy: vollständige Pipeline inkl. Angular-Build und Server-Upload
## (FORCE_IMAGES=1 lädt ALLE Bilder neu hoch). Gebaut werden die öffentliche
## Weinliste (frontend/dist/weinliste/browser/) UND die statische Editor-App
## (frontend/dist/editor/browser/); die Deploy-Phase lädt beide hoch – den
## Editor in seinen eigenen Remote-Unterordner (deploy.remote_editor_path).
## Das Backup (backup) ist der allererste Schritt und unabhängig von den übrigen:
## existiert export/data/wines.json, wird sie vor allem anderen gesichert.
deploy: backup optimize-images prepare export image-export
	cd frontend && npm run build
	cd frontend && npm run build:editor
	$(PYTHON) scripts/weinimport.py deploy $(DEPLOY_FLAGS)
## test: alle Python-Tests (scripts/tests)
test:
	$(PYTHON) -m pytest scripts/tests -q
## test-pipeline: Tests der Pipeline inkl. Backup (scripts/tests/pipeline)
test-pipeline:
	$(PYTHON) -m pytest scripts/tests/pipeline -q
## test-deploy: Tests des FTPS/SFTP-Deployments (scripts/tests/deploy_ftp)
test-deploy:
	$(PYTHON) -m pytest scripts/tests/deploy_ftp -q
## test-config: Tests der Konfiguration (scripts/tests/config)
test-config:
	$(PYTHON) -m pytest scripts/tests/config -q
