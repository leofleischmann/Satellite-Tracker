#!/bin/bash
#
# SatTrack Pi Client - Setup Script
# Automatische Installation und Konfiguration
#

set -e

# Farben für Output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════╗"
echo "║     SatTrack Pi Client - Setup Script      ║"
echo "╚════════════════════════════════════════════╝"
echo -e "${NC}"

# Nach Server-IP fragen
echo -e "${YELLOW}Bitte gib die IP-Adresse oder URL deines SatTrack-Servers ein:${NC}"
echo -e "(z.B. 192.168.2.192 oder sattrack.local)"
read -p "Server IP/URL: " SERVER_IP

if [ -z "$SERVER_IP" ]; then
    echo -e "${RED}Fehler: Keine IP angegeben!${NC}"
    exit 1
fi

# Port abfragen (Standard: 5000)
read -p "Server Port [5000]: " SERVER_PORT
SERVER_PORT=${SERVER_PORT:-5000}

SERVER_URL="http://${SERVER_IP}:${SERVER_PORT}"

echo ""
echo -e "${BLUE}Konfiguration:${NC}"
echo "  Server URL: $SERVER_URL"
echo ""

# Bestätigung
read -p "Ist das korrekt? (j/n): " CONFIRM
if [ "$CONFIRM" != "j" ] && [ "$CONFIRM" != "J" ] && [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Abgebrochen."
    exit 0
fi

echo ""
echo -e "${BLUE}[1/5] Erstelle Installationsverzeichnis...${NC}"
INSTALL_DIR="$HOME/sattrack_client"
mkdir -p "$INSTALL_DIR"

# Kopiere Dateien (wenn wir im richtigen Verzeichnis sind)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/sattrack_client.py" ]; then
    cp "$SCRIPT_DIR/sattrack_client.py" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/requirements.txt" "$INSTALL_DIR/" 2>/dev/null || true
fi
echo -e "${GREEN}✓ Verzeichnis erstellt: $INSTALL_DIR${NC}"

echo ""
echo -e "${BLUE}[2/5] Erstelle Python Virtual Environment...${NC}"
cd "$INSTALL_DIR"

# Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

# Activate and install
source venv/bin/activate
pip install --upgrade pip >/dev/null 2>&1
pip install requests >/dev/null 2>&1
deactivate

echo -e "${GREEN}✓ Virtual Environment erstellt und Dependencies installiert${NC}"

echo ""
echo -e "${BLUE}[3/5] Erstelle systemd Service...${NC}"

# Service-Datei erstellen
SERVICE_FILE="/tmp/sattrack_client.service"
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=SatTrack Recording Client
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/venv/bin/python $INSTALL_DIR/sattrack_client.py --server $SERVER_URL --interval 15
Restart=always
RestartSec=10
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

sudo cp "$SERVICE_FILE" /etc/systemd/system/sattrack_client.service
echo -e "${GREEN}✓ Service-Datei erstellt${NC}"

echo ""
echo -e "${BLUE}[4/5] Aktiviere und starte Service...${NC}"
sudo systemctl daemon-reload
sudo systemctl enable sattrack_client
sudo systemctl start sattrack_client
echo -e "${GREEN}✓ Service gestartet${NC}"

echo ""
echo -e "${BLUE}[5/5] Teste Verbindung zum Server...${NC}"
sleep 2

# Verbindung testen
if curl -s --connect-timeout 5 "$SERVER_URL/api/pi/pending" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Server erreichbar!${NC}"
else
    echo -e "${YELLOW}⚠ Server nicht erreichbar - prüfe IP und ob der Server läuft${NC}"
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Installation abgeschlossen!${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo ""
echo "Nützliche Befehle:"
echo "  Status prüfen:     sudo systemctl status sattrack_client"
echo "  Logs ansehen:      journalctl -u sattrack_client -f"
echo "  Neu starten:       sudo systemctl restart sattrack_client"
echo "  Stoppen:           sudo systemctl stop sattrack_client"
echo ""
echo -e "${BLUE}Der Client pollt jetzt alle 15 Sekunden den Server.${NC}"
echo -e "${BLUE}Plane eine Aufnahme im Web-UI und beobachte die Logs!${NC}"
echo ""
