# SatTrack Pi Client

Dieses Script läuft auf dem Raspberry Pi und holt Aufnahme-Befehle vom Server.

---

## 🚀 Schnellstart (Ein Befehl!)

Kopiere diesen Befehl auf dem Pi und führe ihn aus:

```bash
curl -sSL https://raw.githubusercontent.com/DEIN-REPO/Satellite-Tracker/main/pi_client/setup_client.sh | bash
```

**Oder manuell:**

```bash
# Auf deinem PC - Ordner zum Pi kopieren:
scp -r pi_client/ pi@raspberrypi.local:~/

# Auf dem Pi:
cd ~/pi_client && chmod +x setup_client.sh && ./setup_client.sh
```

Das Setup fragt nach der Server-IP und konfiguriert alles automatisch!

---

## 📋 Was das Setup macht

1. ✅ Installiert Python-Dependencies (`requests`)
2. ✅ Kopiert Client-Script nach `~/sattrack_client/`
3. ✅ Erstellt systemd Service mit korrekter Server-URL
4. ✅ Aktiviert und startet den Service
5. ✅ Testet die Verbindung zum Server

---

## 🔧 Nützliche Befehle

| Befehl | Beschreibung |
|--------|--------------|
| `sudo systemctl status sattrack_client` | Status prüfen |
| `journalctl -u sattrack_client -f` | Live-Logs ansehen |
| `sudo systemctl restart sattrack_client` | Neu starten |
| `sudo systemctl stop sattrack_client` | Stoppen |

---

## ⚙️ Wie es funktioniert

```
┌──────────────────────────────────────────────────────┐
│ Pi Client pollt Server alle 15 Sekunden:             │
│                                                      │
│   GET /api/pi/pending  →  Gibt es Aufnahmen?         │
│                                                      │
│   Falls ja:                                          │
│     1. Führe rtl_sdr/sox Befehl lokal aus           │
│     2. Melde Status zurück: POST /api/pi/status     │
└──────────────────────────────────────────────────────┘
```
