# Weißer Gaming-PC – Preise, Kompatibilität, FPS

Statische Seite (HTML, CSS, Vanilla-JS) für GitHub Pages plus ein Python-Preischecker mit E-Mail-Alarm.

**Der Build:** Ryzen 7 9800X3D · Gigabyte B850 AORUS Elite WIFI7 ICE · RTX 5070 Ti (weiß, Auswahl) ·
Corsair Vengeance RGB White 32 GB (CMH32GX5M2B6000C30W) · Tryx Panorama ARGB 360 White (G1W) ·
be quiet! Light Base 600 DX White · Corsair RM1000e White · 10 × Asiahorse Matrix Pro White
(6 Intake Reverse-Blade, 4 Exhaust Standard-Blade, auch auf dem Radiator) · Umbra-Hub · Aurora-Learn-Covers · 1440p-OLED.

## Was die Seite kann
* **Preisliste** mit günstigstem lieferbaren Preis, Händler, Link, Zielpreis, Preisverlauf (kleines Diagramm, Details mit
  Tabelle) und Zeit der letzten Prüfung. Auswahlfelder für GPU, SSD (automatisch die günstigste), RAM, Paste, Monitor.
* **Gesamtpreis groß** mit Balken gegen das Budget (3.000 €), umschaltbar *PC allein* / *PC + Monitor*.
* **GPU-Karten:** alle weißen RTX 5070 Ti mit Bild, Preis, Länge und Dicke.
* **Lüfter-Plan** (6 Intake + 4 Exhaust) und **Kompatibilitäts-Check** (✓ / ! / ✗): Radiator, Lüfter, GPU-Länge, Netzteil,
  Formfaktor, RAM/EXPO, Stromstecker, Kabel-Covers, interne Header.
* **FPS-Übersicht (1440p)** mit Markierung, ob die Bildwiederholrate des Monitors (240 / 280 Hz) erreicht wird.
* Hinweisbalken, wenn Preisquellen blockieren oder die letzte Prüfung zu lange her ist.

## Aufbau

```
index.html, css/, js/          Webseite (ohne Build-Schritt)
data/parts.json                Teilekatalog: Specs, Quellen, Bilder – von Hand pflegbar
data/prices.json               aktuelle Preise + Verlauf (vom Checker, nur bei Änderungen committet)
data/fps.json                  FPS-Werte mit Quelle je Wert (gemessen / Schätzung)
data/status.json               Prüfstatus, entsteht beim Deploy (nicht im Repo)
config/config.json             Intervall, Quellen, Backoff, Alarm-Schwellen
config/targets.json            Zielpreise + Budget (die Seite zeigt sie nur an)
tracker/                       Preischecker (requests + BeautifulSoup)
tests/                         pytest (37) und Node-Tests der Seitenlogik (9)
.github/workflows/             Cron-Lauf (alle 30 Min.) und Pages-Deploy
```

## Lokal ausprobieren

```
pip install -r requirements-dev.txt
python -m pytest tests                      # Preischecker-Tests
node --test "tests/js/*.test.mjs"           # Tests der Seitenlogik (Node 20+)
python -m tracker --dry-run --force         # live prüfen, nichts speichern
python -m tracker --force                   # live prüfen und data/prices.json schreiben (ca. 3 Min.)
python -m http.server 8000                  # Seite unter http://localhost:8000
```

## Auf GitHub einrichten

1. Neues **öffentliches** Repo anlegen und alles pushen.
2. *Settings → Pages → Source:* **GitHub Actions**.
3. *Settings → Actions → General → Workflow permissions:* **Read and write**.
4. *Settings → Secrets and variables → Actions →* drei Secrets anlegen (nichts Persönliches gehört ins Repo):
   * `SMTP_USER` – deine Gmail-Adresse
   * `SMTP_PASSWORD` – ein **App-Passwort** (Google-Konto → Sicherheit → Bestätigung in zwei Schritten → App-Passwörter)
   * `MAIL_TO` – Empfängeradresse (kann dieselbe sein)
5. *Actions → „Preise prüfen & Seite veröffentlichen“ → Run workflow* und im Log prüfen, welche Quellen antworten.
   Test-Mail lokal: `SMTP_USER` und `SMTP_PASSWORD` setzen, dann `python -m tracker --test-mail`.

Ablauf pro Lauf: Preise holen → `data/prices.json` **nur bei Änderungen** committen → Seite mit frischem `status.json`
veröffentlichen. Ein Push auf `main` veröffentlicht nur die Seite.

## Preisquellen – bitte lesen

* **Primär:** Geizhals-Daten über `preisvergleich.heise.de` (gleiche Produkt-IDs und gleiches HTML). `geizhals.de` selbst
  blockt Python per Cloudflare-Challenge. Berücksichtigt werden Händler ohne Auslands-Firmensitz laut Geizhals,
  lieferbare Angebote zuerst.
* **Fallback:** billiger.de (JSON-LD), nur für Teile mit URL in `parts.json`.
* **idealo** ist nicht eingebaut: blockt jeden Skript-Abruf (HTTP 403).
* **Asiahorse** (Lüfter, Covers): Hersteller-Shop in USD, mit EZB-Kurs umgerechnet und 19 % MwSt. geschätzt – kein
  deutscher Händler im Preisvergleich. Der Umbra-Hub kommt von Geizhals.
* Blockiert eine Quelle (403/429/Challenge), wird sie geloggt und mit wachsender Pause (60 Min. bis 12 Std.) übersprungen;
  der Preis bleibt stehen und die Seite warnt. **Ob GitHub-Runner bei heise/billiger durchkommen, ließ sich nicht testen** –
  nach dem ersten Lauf das Log prüfen. Fallback: den Checker lokal laufen lassen und `data/prices.json` pushen.
* Intervall: Cron steht im Workflow (30 Min.); `check_interval_minutes` in der Config kann es nur verlängern.
* Alarme: Preissenkung, Zielpreis erreicht, ≥ 5 % unter dem 30-Tage-Durchschnitt. Der zuletzt gemeldete Preis wird
  gespeichert, derselbe Deal kommt nicht doppelt; fällt der Preis nach einem Anstieg erneut, wird wieder gemeldet.
* GitHub deaktiviert Cron-Workflows nach 60 Tagen ohne Aktivität im Repo – bei seltenen Preisänderungen ggf. neu starten.

## Daten pflegen
* **Teil hinzufügen/ändern:** `data/parts.json` (`sources.geizhals` = Teil der Geizhals-URL vor `.html`, z. B.
  `...-a3316851`; optional `sources.billiger` als URL). Neue Teile erscheinen automatisch beim nächsten Lauf.
* **Zielpreise:** `config/targets.json` – die Werte sind Platzhalter (ca. 8–10 % unter dem Preis vom 01.10.2026).
* **FPS:** `data/fps.json` – je Wert `fps`, `kind` (`measured` | `estimate`), `source`, `note`. Schätzfaktoren stehen oben im File.

## Bekannte Grenzen
* RAM: der gewählte C30W-Kit hat nur ein Intel-XMP-Profil (Check zeigt „Prüfen“); die EXPO-Variante (Z30W) ist im
  Auswahlfeld wählbar.
* Für den Deckel-Radiator nennt be quiet! keine maximale Dicke; Radiator 30 mm + Matrix Pro 26 mm = 56 mm.
* Netzteil-Länge: Datenblatt < 200 mm, Handbuch 180 mm – geprüft wird gegen 180 mm.
* Warzone ist nicht direkt gemessen (Näherung über Black Ops 7), Elden Ring ist ohne Mod auf 60 FPS begrenzt.
* Vorläufiger Verlauf: Ein Diagramm entsteht erst nach der ersten Preisänderung eines Teils.

## Hinweise
Private, nicht-kommerzielle Seite ohne Affiliate-Links. Produktbilder kommen vom Geizhals-CDN. Prüfe die Nutzungsbedingungen
der Preisportale, bevor du Preisdaten öffentlich weitergibst.
