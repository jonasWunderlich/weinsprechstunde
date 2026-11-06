---
inclusion: fileMatch
fileMatchPattern: ["scripts/weinlib/config.py"]
---
# weinlib: config (Grundlage von pipeline und deploy-ftp)
`config.py` lädt Konfiguration und Secrets (`weinsprechstunde.config.json`, `weinsprechstunde.secrets.json`, `import_dir` mit Fallback `import/`) für pipeline und deploy-ftp. Deshalb nur diese Notiz laden, keine Domänen-Specs.
Das passende `domain-pipeline.md` bzw. `domain-deploy-ftp.md` nur laden, wenn die Aufgabe die jeweilige Domäne berührt. Änderungen an Schlüsseln oder Defaults mit `python -m pytest scripts/tests -q` prüfen.
