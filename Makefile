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

.PHONY: prepare export image-export deploy all

## prepare: JSON-Quelldateien aufbereiten (Phase prepare)
prepare:
	$(PYTHON) scripts/weinimport.py prepare

## export: wines.json erzeugen (Phase export)
export:
	$(PYTHON) scripts/weinimport.py export

## image-export: Bilder skalieren (Phase image-export)
image-export:
	$(PYTHON) scripts/weinimport.py image-export

## all: prepare -> export -> image-export (ohne deploy)
all: prepare export image-export

## deploy: vollständige Pipeline inkl. Angular-Build und Server-Upload
deploy: prepare export image-export
	cd frontend && npm run build
	$(PYTHON) scripts/weinimport.py deploy
