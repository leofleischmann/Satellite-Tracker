# GalaxyTrack - Satellite Tracker

Echtzeit-Satellitenverfolgung mit interaktiver Weltkarte.

## Features

- 🛰️ **Live-Tracking** - Aktuelle Positionen von konfigurierten Satelliten
- 🗺️ **Interaktive Karte** - Dark-Mode Weltkarte mit Satellitenbahnen
- ⏱️ **Zeitreise** - Simulation vergangener und zukünftiger Überflüge
- 📡 **Pass-Vorhersage** - Berechnung wann Satelliten empfangbar sind
- 🔍 **Satellitensuche** - Durchsuchen der Celestrak-Datenbank
- **SSH Commands bei Überflug** - Dende custom SSH Befehle an einen Raspberry Pi oder ähnliches wenn ein Satellit sichtbar ist

## Schnellstart (Docker)

```bash
docker compose up -d --build
```

Dann öffne http://localhost:5000

## API Endpoints

| Endpoint | Beschreibung |
|----------|-------------|
| `/api/status` | Server-Status & Standort |
| `/api/ephemeris` | Positionsdaten für Interpolation |
| `/api/passes` | Berechnete Überflüge |
| `/api/search?q=` | Satellitensuche |

## Konfiguration

Satelliten werden in `satellites.json` definiert mit NORAD-ID, Name und Frequenz.

## Disclaimer

Dieses Programm wurde zu großen Teilen von KI generiert. Es dient lediglich als Beispiel und ist nicht für Produktion geeignet. Es wird keine gewähr für einwandfreie Funktionalität oder korrekte Berechnungen übernommen.
