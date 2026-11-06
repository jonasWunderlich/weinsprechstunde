---
inclusion: fileMatch
fileMatchPattern: ["scripts/weinlib/deploy.py", "scripts/weinlib/ftp_transport.py"]
---
# weinlib: deploy-ftp
Diese Dateien gehören zur Domäne deploy-ftp. Kontext, Verträge und Specs: #[[file:.kiro/steering/domain-deploy-ftp.md]]
Änderungen an `ftp_transport.py` erfordern zusätzlich `scripts/tests/pipeline/test_backup.py` (`backup.py` nutzt den Transport).
Tests: `scripts/tests/deploy_ftp` (`make test-deploy`).
