# Werkzeuge

- `extract_osm.py`: zieht aus einem OSM-Auszug (PBF) die Daten für die Offline-Karte.
- `build_offline.py`: baut aus `src/public/kritis-lage.html` die eigenständige Datei `kritis-lage-offline.html`.
- `lage-server.js`: Live-Freigabe. Ein Rechner bearbeitet die Karte, andere Geräte im selben Netz sehen den Stand live (nur lesend).

## Live-Freigabe

Voraussetzung: Node.js auf dem Rechner, der die Karte führt. Keine weiteren Pakete nötig. Das Skript und die Datei `kritis-lage-offline.html` können im selben Ordner liegen, das Repository ist nicht nötig.

    node lage-server.js

Der Server nennt eine PIN und die Adressen im Netz. Die Karte auf diesem Rechner über `http://localhost:8080/` öffnen (nicht als Datei), dann oben auf „Teilen“ klicken. Der QR-Code enthält den Link mit PIN. Weitere Möglichkeiten: `--port 9000`, `--pin 4711`, `--no-pin`, `--file src/public/kritis-lage.html`.

Nur der Rechner selbst darf Stände einliefern, alle anderen Geräte brauchen die PIN und dürfen nur lesen. Der Verkehr läuft unverschlüsselt (HTTP) im lokalen Netz. Der zuletzt übergebene Stand liegt als `lage-live.json` neben dem Skript. Manche WLANs trennen die Geräte voneinander (Client-Isolation), dann erreichen Handys den Rechner nicht.
