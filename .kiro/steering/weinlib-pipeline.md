---
inclusion: fileMatch
fileMatchPattern: ["scripts/weinlib/pipeline.py", "scripts/weinlib/backup.py"]
---
# weinlib: pipeline
Diese Dateien gehören zur Domäne pipeline. Kontext, Verträge und Specs: #[[file:.kiro/steering/domain-pipeline.md]]
`backup.py` nutzt den Transport aus `ftp_transport.py`, ohne deploy-ftp zu laden.
Tests: `scripts/tests/pipeline` (`make test-pipeline`).
