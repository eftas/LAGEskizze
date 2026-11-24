# Werkzeuge

- `extract_osm.py`: zieht aus einem OSM-Auszug (PBF) die Daten für die Offline-Karte.
- `build_offline.py`: baut aus `src/public/kritis-lage.html` die eigenständige Datei `kritis-lage-einzeldatei.html`.
- `lage-server.js`: Live-Freigabe. Ein Rechner bearbeitet die Karte, andere Geräte im selben Netz sehen den Stand live (nur lesend).

## Live-Freigabe

Voraussetzung: Node.js auf dem Rechner, der die Karte führt. Keine weiteren Pakete nötig. Das Skript und die Datei `kritis-lage-einzeldatei.html` können im selben Ordner liegen, das Repository ist nicht nötig.

    node lage-server.js

Der Server nennt die Adressen im Netz. Die Karte auf diesem Rechner über `http://localhost:8080/` öffnen (nicht als Datei), dann oben auf „Teilen“ klicken. Der QR-Code enthält den Link zur Ansicht. Weitere Möglichkeiten: `--port 9000`, `--file src/public/kritis-lage.html`.

Nur der Rechner selbst darf Stände einliefern, alle anderen Geräte dürfen nur lesen. Es gibt keine PIN: Jedes Gerät im selben Netz kann die Lage lesen. Der Verkehr läuft unverschlüsselt (HTTP) im lokalen Netz. Der zuletzt übergebene Stand liegt als `lage-live.json` neben dem Skript. Manche WLANs trennen die Geräte voneinander (Client-Isolation), dann erreichen Handys den Rechner nicht.
