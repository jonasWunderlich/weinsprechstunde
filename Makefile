# Weinsprechstunde Build-Targets
#
# Einzelne Import-Phasen und die vollständige Deploy-Pipeline.
# Der Python-Interpreter kann über PYTHON überschrieben werden, z. B.:
#   make prepare PYTHON=.venv/bin/python

PYTHON ?= python

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
	cd frontend && ng build
	$(PYTHON) scripts/weinimport.py deploy
