---
inclusion: fileMatch
fileMatchPattern: ["scripts/weinlib/deploy.py", "scripts/weinlib/ftp_transport.py"]
---
# weinlib: deploy-ftp
Diese Dateien gehören zur Domäne deploy-ftp. Kontext, Verträge und Specs: #[[file:.kiro/steering/domain-deploy-ftp.md]]
Änderungen an `ftp_transport.py` erfordern zusätzlich die Backup-Tests (`backup.py` nutzt den Transport).
