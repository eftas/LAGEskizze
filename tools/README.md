# Werkzeuge

- `build_offline.py`: baut aus `src/public/kritis-lage.html` die eigenständige Einzeldatei `kritis-lage-einzeldatei.html` (Bibliotheken, Schriften und Zeichen eingebettet).
- `build_symbols.py`: erzeugt die zusätzlichen Taktischen Zeichen aus dem Repository jonas-koeritz/Taktische-Zeichen (CC BY 4.0).
- `lage-server.js`: Live-Freigabe. Ein Rechner bearbeitet die Karte, andere Geräte im selben Netz sehen den Stand live (nur lesend).

## Live-Freigabe

Voraussetzung: Node.js auf dem Rechner, der die Karte führt. Keine weiteren Pakete nötig. Das Skript und die Datei `kritis-lage-einzeldatei.html` können im selben Ordner liegen, das Repository ist nicht nötig.

    node lage-server.js

Der Server nennt die Adressen im Netz. Die Karte auf diesem Rechner über `http://localhost:8080/` öffnen (nicht als Datei), dann oben auf „Teilen“ klicken. Der QR-Code enthält den Link zur Ansicht. Weitere Möglichkeiten: `--port 9000`, `--file src/public/kritis-lage.html`.

Nur der Rechner selbst darf Stände einliefern, alle anderen Geräte dürfen nur lesen. Es gibt keine PIN: Jedes Gerät im selben Netz kann die Lage lesen. Der Verkehr läuft unverschlüsselt (HTTP) im lokalen Netz. Der zuletzt übergebene Stand liegt als `lage-live.json` neben dem Skript. Manche WLANs trennen die Geräte voneinander (Client-Isolation), dann erreichen Handys den Rechner nicht.

## Bevölkerungspakete (Zensus 2022)

`build_zensus.py` erzeugt aus den Gitterdaten des Zensus 2022 (Destatis, 100-m-Raster) je Bundesland ein Paket
`src/public/zensus/zensus-<Kürzel>.js` plus `zensus-index.js`. Die Karte rechnet daraus Einwohner, Durchschnittsalter, Anteil unter 18 und ab 65
für Gebiete, Abschnitte und den Umkreis um Objekte (Zellen nach überdeckter Fläche gewichtet).

Eingabe (Download von destatis.de, Datenlizenz Deutschland – Namensnennung 2.0):

- `Durchschnittsalter_in_Gitterzellen.zip`
- `Alter_in_infrastrukturellen_Altersgruppen.zip`
- `Alter_5er-Jahresgruppen_100mGitter.zip`
- Ländergrenzen: `isellsoap/deutschlandGeoJSON`, Datei `2_bundeslaender/2_hoch.geo.json` (nur zum Aufteilen der Zellen)

```
python3 tools/build_zensus.py --dir <Ordner mit den CSV-Dateien> --geojson 2_hoch.geo.json
python3 tools/build_offline.py        # bettet alle Pakete in die Einzeldatei ein (--zensus NW,BY für eine Auswahl, --zensus none ohne)
```

Hinweise zu den Werten: Ab 65 ist exakt (5-Jahres-Gruppen). Unter 18 ist geschätzt, weil die Altersklasse 16 bis 18 zu zwei Dritteln gezählt wird.
Die Daten sind durch das Geheimhaltungsverfahren leicht verändert, Summen können abweichen. Zellen am Landesrand sind über vereinfachte Grenzen
einem Land zugeordnet. Das ist für die Summen unerheblich, solange die Pakete der Nachbarländer geladen sind.
