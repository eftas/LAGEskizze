# LAGEskizze

LAGEskizze is the adaption of an incident sketch which is used as a central draft of an accident, a fire, or a disaster in the Incident Management System of the federal state of North Rhine-Westphalia, Germany, ([Lagedarstellungssystem NRW](http://www.idf.nrw.de/service/downloads/downloads_lagedarstellungssystem_nrw.php)) delivered by the Institute of Fire Services NRW.

It is a javascript based position visualisation system that aims to support a consistent and structured management within fire brigade operations. It implements service regulations of the fire brigades in Germany conform to the Fire Service Regulation 100 (Feuerwehr-Dienstvorschrift 100).

The application is written using node.js and AngularJS. For desktop use in command support units, it is encapsulated in an easy to use Electron container. Most recent builds for Windows operation systems can be downloaded from the [EFTAS homepage](http://www.eftas.de/upload/LAGEskizze-win32-x64_10_11_2016.zip).

As base maps the recent version is using the open data WMS of the NRW-Atlas of the federal state NRW (ATKIS, ALKIS) - the relevant copyrights for the service are hold by the federal state. The tactical signs are conform to the German recommendation "Empfehlung für Taktische Zeichen im Bevölkerungsschutz" (Ständige Konferenz für Katastrophenvorsorge im Bevölkerungsschutz) of 2010.

**Credits**:
Base work was done by Saphir El-Kaiy (functional requirements and specification) and Sebastian Niklasch (first software implementation) in their bachelor thesis. The tactical signs where mostly drawn by Sebastian Ramrath, Fire Brigade Much.

## LAGEkarte für Stäbe

Im Ordner `src/public` liegt `kritis-lage.html`, eine eigenständige Lagekarte für einen operativ-taktischen Stab (Gebiete, KRITIS-Objekte, Kräfte, Abschnitte, Meldungen, Tagebuch, Lagestände, Wind und Keule). `python3 tools/build_offline.py` baut daraus die Einzeldatei `kritis-lage-einzeldatei.html`, die ohne weitere Dateien läuft. Kartenkacheln, Ortssuche und die Abfrage der KRITIS-Objekte brauchen Internet. Hinweise zur Live-Freigabe und zu den Lizenzen der Zeichen: `tools/README.md`, `src/public/images/LICENSES-symbole.md`.

### Funktionen (Rollen)

Beim ersten Start fragt die LAGEkarte, wer Sie sind (EL, S1 bis S6). Danach sehen Sie nur Ihre Aufgaben, der S2 sieht und bearbeitet alles.
Jede Funktion speichert über „Meine Daten (JSON)“ nur ihren Bereich. Der S2 liest alle Dateien ein (Reiter Daten oder Start), seine Karte wird aktualisiert.
Mit `?rolle=S3` im Link wird eine Funktion fest vorgewählt, mit `?rolle=fragen` wird die Auswahl erzwungen.
