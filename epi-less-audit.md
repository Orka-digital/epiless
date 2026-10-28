---
title: epi-less Audit — Product- en technische specificatie
version: 1.9.0
status: Productspecificatie / lokale P0; scanner 0.4 ontwikkelpreview; gehoste vrijgave uitgesteld
datum: 2026-10-27
taal: nl-BE
platform: Google Chrome — Manifest V3 + online index en deelplatform
beheerder: Orka Digital
distributie: Open source via GitHub; officiële index gehost door de projectbeheerder
---

# epi-less Audit

> **Implementatie-update — 27 oktober 2026:** de lokale P0-aanvullingen omvatten uitgebreide scans, HTML-/historiekexport, lokaal sitebeheer, hervatbare accountgebonden uploads, redactie, indexfilters en accountbeheer. De gebruiker heeft hosting en externe publicatie expliciet uitgesteld: **eerst alles lokaal**. Zie de [P0-acceptatiematrix](docs/P0-ACCEPTANCE.md), [geverifieerde voortgang](docs/IMPLEMENTATION.md), [README](README.md) en [publicatierunbook](docs/DELIVERY.md). De onderstaande acceptatiecriteria blijven het volledige ontwerpcontract; de vakjes zijn geen automatisch bijgewerkte testuitslag. Lokale tests bewijzen geen productiehosting. De officiële index is nog niet gedeployd.

> **Scannerupdate 0.4 — ontwikkelpreview:** native pixels binnen een begrensd budget, exacte gelijktijdige maskers, temporele DOM-/animatie-/videoaanwijzingen, lokale elementinspectie, hercontroles en reviews zijn ontwikkeld. Enginebron `c216fbe2…` behoudt nu één volledige ruimtelijke framegetuige en begrenst bronaanwijzingen tot het oorspronkelijke gebeurtenisvenster. De exacte Float64-WASM-kernel blijft ABI 2; bronaanwijzingen blijven correlatie met onbekende capturelatentie.
>
> **Actuele lokale controle:** scannerbron `6770f52087d2cfeb0b8206677e4076056385f64d1bac660063d79f7164ce4f61` is gebouwd; 423 unit-/integratietests in 45 bestanden slagen. De nieuwe presentatieguard is ook door echte Chrome-content- en background/IndexedDB-hercontroleproeven gegaan; hun gesimuleerde capturegrens bewijst geen native cadans. De drie-enginevergelijking omvat 144 gevallen, telkens 23.058 toestandcontroles tegen de bevroren en huidige JS-route, 1.626 bevindingen/callbacks en 4.698 onafhankelijk gereconstrueerde maskers. Zes ruimtelijke wijzigingen worden verklaard, niet weggefilterd; de drie externe gates behouden alle bekende afwijkingen. De lokale clang/wasm-ld 23.1.4-herbouw reproduceert alle 2.239 kernelbytes. Hosted CI controleert bron/bytes/ABI en regressies, niet die compilerherbouw. `pnpm check` en alle zeven scripts van de volledige extensiebrowserketen slagen eveneens. De actuele native loop-, dense-, gecodeerde-video- en gerichte mediahercontroleproeven zijn hieronder afzonderlijk afgebakend. Zes gerichte fixture-/verifiergrensgevallen zijn in het testtotaal inbegrepen.
>
> **Media en reproduceerbaarheid:** seekbare bestandsvideo's bewaren lokaal bronlocatorhash, beginpositie, snelheid, loopstand en werkelijke compositor-presentatietijdstempels. Een negatieve hercontrole vereist dezelfde oorspronkelijke presentatiereeks; ontbrekende frames, stagnerende presentatie, onbekende media of onvolledige ontdekking zijn geen bewijs van afwezigheid. De hash identificeert het bronadres, niet de inhoudsbytes. De runner kan binnen zijn bestaande budget een bestaande ondersteunde videoloop nabij de overgang meten; alleen werkelijk waargenomen currentTime- én rVFC-overgangen tellen. Een vertraagd natuurlijk seeking-event moet door één unieke timer- én rVFC-overgang worden verklaard; een tweede seek mag die overgang niet hergebruiken. Media boven 24 uur wordt expliciet onondersteund, niet stilzwijgend tot 24 uur gekalibreerd. Een korte loopproef is geen volledige video- of fullscreencontrole.
>
> **Actueel native loopbewijs, gecontroleerde fixture:** build `6770f520…` behoudt 310 native frames van 1800 × 1126 bij 59,99534 fps, maximaal 17,8 ms tussen frames en geen overgeslagen frames of terugschaling. De onafhankelijke paginatrace bevat 129 werkelijke compositorpresentaties en twee loopovergangen; 104 presentaties gekoppeld aan de samples hebben exact overeenkomstige PTS. Deze fixture gebruikt bewust een laagcontrastmarker van 4 × 4 CSS-pixels die 180 pixels per 2 seconden beweegt; dit is kunstmatig ondersteunde capturecadans. De volledige job blijft `PARTIAL`/`INCONCLUSIVE` door onbereikte toestanden. De eerste loopproef met 35,5 fps op de andere build `8a8f9e06…` blijft als mislukking bewaard: dit is geen zuivere één-variabeleproef en bewijst niet waardoor de eerdere cadans lager was.
>
> **Actuele native dense- en VP9-capture:** dezelfde build `6770f520…` slaagt op de strikte desktop-/compactcriteria. Dense capture behoudt 306/307 frames bij 59,99685/59,79132 fps, maximale gaps 18,1/33,4 ms en 301/300 echte WASM-aanroepen zonder extra invoerkopiebytes. De aparte gecodeerde VP9-proef behoudt 306/307 frames bij 59,99567/59,99765 fps, nul gemeten grijswaardefout en 20 onafhankelijk overeenkomstige compacte presentaties; dit schaarse signaal gebruikt gedeelde JS-histories zonder dense-aanroep. Beide bereiken de tiny-video-kandidaat en adequate capture zonder onderbreking of terugschaling, maar houden `MEDIA_REPLAY_NOT_REPRODUCIBLE`: dit bewijst geen native video-fix/hercontrole. De totale jobs blijven `PARTIAL`. De dichte workload bevat tijdelijke numerieke probe-instrumentatie; alleen deze Mac en deze begrensde fixtures zijn onderzocht.
>
> **Actuele native videohercontrole:** een afzonderlijke opt-infixture op ongewijzigde scanner `6770f520…` en artifact `d0ac12bb…` slaagt voor signaal → gecorrigeerde video → terugkerend signaal via dezelfde bron-URL. Drie echte toolbarcaptures behouden 307/306/307 frames bij 59,994118/59,990952/59,987062 fps, elk 1800 × 1126 zonder terugschaling of onderbreking. Alle 53 werkelijk gepresenteerde PTS van 0 tot 2080 ms en het volledige clipinterval 0–2120 ms komen overeen; de productvergelijking geeft `NOT_OBSERVED` en daarna `REOBSERVED` zonder onvergelijkbaarheidsredenen. De gewone 20s-marker blijft behouden. De jobs zijn respectievelijk `PARTIAL`, `COMPLETED` en `PARTIAL`; de laatste beperking betreft een afzonderlijk onvoldoende navigatiesegment. De [verificatie](tests/extension/evidence/scanner-v04-native-media-recheck-verification.json) en [provenance](tests/extension/evidence/scanner-v04-native-media-recheck-provenance.json) bewaren bronbytes en identiteiten. Een eerste verifierfout telde herstelzoeken ná zowel meting als observatie-einde onterecht mee; die versie en mislukte uitslag blijven bewaard, en zes gerichte tests bewaken de beperkte correctie. Dit bewijst één gecontroleerde seekbare videoketen, geen algemene videocorrectheid, automatische defectoplossing of causaliteit.
>
> **Historische native acceptatie, geen nieuwe buildclaim:** bron `af5d4da0…` met engine `f6611f36…` behoudt 306/307 desktop-/compactframes bij 59,9957/60,0035 fps, 301 echte kernelaanroepen per profiel, nul extra invoerkopiebytes en geen gerapporteerde onderbreking of terugschaling. De aparte gecodeerde VP9-keten op dezelfde build behoudt 307/306 frames rond 60 fps, nul kleurkanaalfout en 20 overeenkomstige compacte videopresentaties; dit schaarse signaal gebruikt de gedeelde JS-route. Beide resultaten blijven aan die oude build gekoppeld. De volledige jobs zijn gedeeltelijk door ongeteste toestanden. Geavanceerde annulering geeft capture/debugger/workspace/opslag vrij, maar het exacte CSS-hoogteherstel faalt nog (450 in plaats van 507 pixels); afgewezen herstelproeven blijven bewaard. Eerdere ABI 1-capture en prototypebenchmarks blijven eveneens historisch, inclusief hun tegenvallende cadans. Alleen deze Mac is onderzocht; geen algemene 60fps- of state-of-the-artclaim.
>
> **Bewijsgrenzen:** eerdere native tiny-detail-, fix/recurrence-, fysieke-workspace- en VP9-proeven blijven behouden bij hun eigen builds. Het CSS-referentieveld vereist bewezen mapping en standaardzoom; fysieke kijkafstand wordt niet gemeten. `MOD-07` en `DET-05` blijven gedeeltelijk. Zie [implementatievoortgang](docs/IMPLEMENTATION.md), [scannerkwaliteit](docs/SCANNER-QUALITY.md), [capturevalidatie](docs/CAPTURE_VALIDATION.md) en [behouden normatieve afwijkingen](docs/DETECTION-DISAGREEMENTS.md).


**Een Chrome-extensie die zelfstandig websites onderzoekt op flitsende webcontent, met een eenvoudige bediening voor iedereen, een uitgebreid DevTools-paneel voor ontwikkelaars en een permanente online website-index om resultaten terug te vinden en te delen.**

**Productbesluit v1.1:** de online index en deelbare rapporten behoren tot de eerste productversie (P0). De analyse gebeurt lokaal in Chrome; geselecteerde resultaten worden via een backend online bewaard. De lokale index ondersteunt offline werken en het voorbereiden van publicaties. Dit document beschrijft de beoogde werking; de actuele implementatiestatus staat in de voortgangslijst bovenaan.

**Productbesluit v1.2:** ook niet-ontwikkelaars kunnen via de extensie **Scan deze website** kiezen, zonder DevTools te openen. Na de start en noodzakelijke browsertoestemming voert epi-less zelf routeverkenning, navigatie, scrollen, ondersteunde interacties, mediatests, analyse en rapportage uit. **Autonoom een website scannen is P0.** Handmatig pagina's openen of scenario's uitvoeren is geen vereiste voor de standaardflow. De eerste technische keuze is één installeerbare extensie met een gewone gebruikersinterface én DevTools-interface op dezelfde scanengine.

**Productbesluit v1.3:** epi-less wordt een publiek open-sourceproject op GitHub, zodat de community kan bijdragen. De beheerder beheert de officiële releases en host de officiële index. Een lage operationele kost is een ontwerpvereiste: lokale scans, compacte online rapporten en als voorkeursstartpunt **Cloudflare Workers + Static Assets + D1**. De eerdere PostgreSQL-voorkeur vervalt voor de eerste gehoste versie. README, communitydocumentatie, mergebeleid en GitHub Actions behoren tot de eerste release; het concrete ontwerp staat in §16–19. De lokale repository en workflowbestanden bestaan inmiddels. Externe GitHub-configuratie en hosting volgen de afzonderlijke vrijgavechecklist.

**Productbesluit v1.4:** de publieke regelindex wordt als **ondertekende, versieerbare JSON-bestanden via CDN** verspreid. De latere blocker bewaart een geverifieerde versie lokaal en past bestaande regels toe **zonder API-call, accountcheck of serverantwoord bij het bezoeken van een website**. Een ingebouwde basisversie dient als terugval. Uitval van de project-API, database of CDN verhindert updates, maar schakelt reeds bruikbare lokale regels niet uit. Het distributiefundament hoort bij P0; de blocker en zijn offline toepassing blijven P2. De precieze scheiding met intrekbare auditrapporten staat in §20.

**Productbesluit v1.5:** de website wordt gebouwd met **Astro + TypeScript en gerichte React-islands**. Informatieve pagina's zijn vooraf gebouwde HTML; actuele index- en rapportpagina's worden op aanvraag gerenderd. React wordt alleen geladen voor interacties die het nodig hebben. Kleine downloads, weinig serverwerk en meetbare prestatiebudgetten zijn P0-eisen. De aanvankelijke keuze om de eerdere huisstijl te volgen is vervangen door productbesluit v1.7. Uitwerking in §21, inclusief de bestaande scheiding tussen intrekbare rapporten en de offline JSON-feed.

**Productbesluit v1.6:** **Cloudflare Turnstile**, server-side verificatie en gerichte requestlimieten behoren tot P0 om spam en geautomatiseerd misbruik van de gehoste dienst te beperken. Gebruik het gratis Turnstile-plan als startpunt. Scannen, gewone rapportweergave en het downloaden/toepassen van de JSON-regelfeed vereisen geen challenge. Uitwerking, kosten en uitvalgedrag staan in §9.5; tests in §11.11.

**Productbesluit v1.7 — 27 oktober 2026:** de website krijgt op verzoek een **eigen epi-less-identiteit en utilitaire applicatielay-out, met weinig tot geen marketing**. Vaste navigatie, een compacte bovenbalk, witte panelen, blauwe accenten en systeemfonts voor alle tekst vormen de basis. Zoeken, rapporttabellen, meetgegevens en accountacties krijgen voorrang boven merkpresentatie. epi-less gebruikt een kleine statische observatiemarkering; de projectbeheerder blijft vermeld als maker en beheerder via een bescheiden credit. Dit vervangt de eerder verplichte huisstijl en de tussentijdse redactionele richting; stack, functionaliteit en prestatiebudgetten blijven behouden.

**Productbesluit v1.8 — 28 oktober 2026:** epi-less staat centraal als communityproject. De makercredit blijft klein op de projectpagina en onderaan de README. Navigatie, extensienaam, rapportsnapshots en deelafbeeldingen bevatten geen herhaalde organisatienaam. Dit vervangt eerdere aanwijzingen om de maker op iedere pagina te vermelden; eigenaarschap, licentie en beheerrechten blijven behouden.

> **Belangrijk onderscheid:** dit product analyseert *waargenomen visuele content* op mogelijke fotosensitieve risico's en relevante WCAG-criteria. Een geslaagde, beperkte audit is **geen garantie dat een website medisch veilig is**. Een toekomstige blocker biedt risicobeperking, geen gegarandeerde bescherming tegen epileptische aanvallen.

## Inhoudsopgave

1. [Productvisie en uitgangspunten](#1-productvisie-en-uitgangspunten)
2. [Functionele scope](#2-functionele-scope)
3. [Gebruikerservaring en schermen](#3-gebruikerservaring-en-schermen)
4. [Audit-engine en WCAG-controles](#4-audit-engine-en-wcag-controles)
5. [Permanente website-index](#5-permanente-website-index)
6. [Datamodel en opslag](#6-datamodel-en-opslag)
7. [Architectuur en technologie](#7-architectuur-en-technologie)
8. [Toekomstige blocker](#8-toekomstige-blocker)
9. [Privacy, beveiliging en betrouwbaarheid](#9-privacy-beveiliging-en-betrouwbaarheid)
10. [Rapportage en statistieken](#10-rapportage-en-statistieken)
11. [Teststrategie en acceptatiecriteria](#11-teststrategie-en-acceptatiecriteria)
12. [Roadmap en prioriteiten](#12-roadmap-en-prioriteiten)
13. [Projectstructuur en ontwikkelafspraken](#13-projectstructuur-en-ontwikkelafspraken)
14. [Open technische beslissingen](#14-open-technische-beslissingen)
15. [Bronnen en normatieve referenties](#15-bronnen-en-normatieve-referenties)
16. [Open source en community](#16-open-source-en-community)
17. [Goedkope hosting en kostenbeheersing](#17-goedkope-hosting-en-kostenbeheersing)
18. [README en ontwikkelervaring](#18-readme-en-ontwikkelervaring)
19. [Mergebeleid, GitHub Actions en releases](#19-mergebeleid-github-actions-en-releases)
20. [JSON-index via CDN en offline blocker](#20-json-index-via-cdn-en-offline-blocker)
21. [Astro, React en epi-less-vormgeving](#21-astro-react-en-epi-less-vormgeving)

---

## 1. Productvisie en uitgangspunten

### 1.1 Doel

epi-less Audit laat iedereen een website controleren vanuit een gewone extensieknop. De gebruiker start een websitescan; een autonome scanrunner ontdekt routes, bezoekt pagina's, verkent scrollposities en ondersteunde interactieve toestanden en levert één begrijpelijk rapport op. Ontwikkelaars en accessibility-auditors krijgen daarnaast een Lighthouse-achtig DevTools-paneel voor technische details en gerichte aanvullende metingen.

Het verschil met een typische statische scan is dat epi-less ook **tijdgebonden, visuele veranderingen** moet meten: video, animaties, GIF's, interactieve elementen, canvas en WebGL. De runner moet die content zelf in beeld brengen en activeren waar dat zonder gegevenswijzigingen of aanvullende browserautorisatie kan.

Tegelijk bouwt epi-less een **online, doorzoekbare index van geteste websites** op. Gebruikers kunnen geselecteerde audits online bewaren, via een link delen en publiek vindbaar maken. Ontvangers kunnen gedeelde rapporten bekijken zonder de extensie te installeren. De index onthoudt auditresultaten, wijzigingen doorheen de tijd en eerdere probleemgebieden.

De extensie bewaart elke audit eerst lokaal en vereist voor meten geen epi-less-account of verbinding met de epi-less-backend. Online pagina's laden vereist uiteraard netwerktoegang. Uploaden en publiceren zijn bewuste acties met een gegevenspreview. De online index is een kernonderdeel van het product; automatische synchronisatie van alle lokale browserhistoriek is dat niet.

### 1.2 Hoofddoelen

- **G1 — Meten:** feitelijk waarneembare flitssequenties vinden, met tijdstip, regio, frequentie, kleur- en luminantiekenmerken.
- **G2 — Beoordelen:** bevindingen koppelen aan concrete WCAG 2.2-succescriteria; onderscheid maken tussen gedetecteerd, vermoedelijk en bevestigd.
- **G3 — Lokaliseren:** waar mogelijk het vermoedelijke HTML-, CSS-, media- of canvas-element achter een probleem aanwijzen.
- **G4 — Registreren:** resultaten **per website, route, audit en element** lokaal bewaren en geselecteerde audits duurzaam in de online index opnemen.
- **G5 — Vergelijken:** regressies, opgeloste problemen en auditdekking in een historiek tonen.
- **G6 — Delen en publiceren:** online rapporten via vaste links delen en publieke resultaten doorzoekbaar maken; daarnaast JSON- en HTML-export aanbieden.
- **G7 — Voorbereiden op bescherming:** bevestigde problematische elementen later gericht kunnen pauzeren, verbergen of anders mitigeren.
- **G8 — Privacy:** frames lokaal verwerken; alleen gekozen rapportgegevens uploaden. Lokaal auditen en openbare rapporten lezen kan zonder account; online bewaren en publicaties beheren vereist een account.
- **G9 — Zelfstandig scannen:** vanaf één start-URL zelf pagina's ontdekken en onderzoeken, scenario's uitvoeren en resultaten samenvoegen zonder dat de gebruiker de website doorloopt.
- **G10 — Bruikbaar voor iedereen:** een eenvoudige extensiebediening met begrijpelijke voortgang en uitkomst; technische configuratie en DevTools zijn optioneel.
- **G11 — Communitybijdragen:** publiek leesbare code, reproduceerbare ontwikkeling, duidelijke bijdragerichtlijnen en geteste pull requests via de projectrepository.
- **G12 — Betaalbare officiële index:** de beheerder host de webindex tegen een zo laag mogelijke aantoonbare kost; server-side browserwerk, video-opslag en onnodige vaste diensten ontbreken in de basisarchitectuur.
- **G13 — Werken bij serveruitval:** publieke regeldata via CDN distribueren en de blocker volledig lokaal laten beslissen met eerder gecontroleerde regels; netwerktoegang is alleen nodig voor vernieuwing.
- **G14 — Snelle epi-less-website:** Astro-pagina's met selectieve React-interactie, een zelfstandige epi-less-vormgeving en aantoonbaar begrensd browser-, server- en dataverbruik.

### 1.3 Gebruikersgroepen

| Gebruiker | Verwachting |
|---|---|
| Gewone websitebezoeker | Op **Scan deze website** klikken en een begrijpelijk resultaat krijgen zonder technische kennis of handmatige rondgang. |
| Frontendontwikkelaar | Snel weten welke animatie of component problematisch is en waarom. |
| Accessibility-auditor | Reproduceerbare meetgegevens, normen, handmatige beoordeling en export. |
| QA-/testteam | Historiek, regressies en vergelijkbare audits per release. |
| Ontvanger / websitebeheerder | Een gedeeld rapport via een link openen, bevindingen begrijpen en een hertest kunnen vergelijken. |
| Bezoeker van de online index | Publiek gedeelde audits per website vinden, met datum, herkomst en beperkte testdekking. |
| Gebruiker van bescherming (P2) | Eerder ontdekte risicovolle elementen optioneel laten pauzeren of verbergen. |
| Communitybijdrager | Lokaal bouwen, tests draaien en verbeteringen voorstellen zonder toegang tot productieaccounts of productiedata. |

### 1.4 Productprincipes

1. **Lighthouse-ervaring, andere meetmethode:** een herkenbaar DevTools-paneel, maar geen schijnzekerheid op basis van één snapshot.
2. **Eerst meten, dan mitigeren:** audithistoriek en actieve blokkeeracties blijven strikt gescheiden.
3. **Onzekerheid is een volwaardige uitkomst:** onvoldoende geanalyseerde content wordt niet als `PASS` weggeschreven.
4. **Geen gevaarlijke previews:** de UI speelt gedetecteerde flitssequenties nooit automatisch opnieuw af.
5. **Alleen waargenomen scope telt:** niet-bezochte routes, niet-geactiveerde interacties en niet-bekeken tijdssegmenten blijven buiten de audit.
6. **Minimale permissies en data:** gebruikers bepalen welke site geanalyseerd wordt en welke resultaten online komen; geen automatische upload van alle audits.
7. **Versiebeheer op resultaten:** elke audit verwijst naar de exacte engine- en regelversie waarmee gemeten is.
8. **Online delen vanaf v1:** de webindex en rapportlinks horen bij P0; lokale opslag ondersteunt de audit- en publicatieflow.
9. **Zichtbaarheid expliciet kiezen:** privé, alleen via link of publiek vindbaar. Een geslaagde upload zegt niets over de inhoudelijke geldigheid van de meting.
10. **Autonomie als standaard:** de runner kiest routes en voert ondersteunde scenario's uit. De gebruiker hoeft geen pagina's, video's of menu's aan te wijzen; uitzonderingen komen in het rapport.
11. **Afgebakende verkenning:** autonomie beschrijft wie het werk uitvoert. Het rapport vermeldt ontdekte, geteste en overgeslagen routes en de stopreden; het beweert niet alle mogelijke toestanden van een website te hebben gezien.
12. **Open code, beheerde dienst:** de community kan bijdragen en een eigen instantie draaien; de beheerder beheert de officiële omgeving, secrets en releases. Open-sourcecode maakt gebruikersrapporten niet automatisch publiek of vrij herbruikbaar.
13. **Kosten meetbaar houden:** opslag, requests, CPU en databasegebruik worden begrensd en gevolgd. Een gratis startplan is geen belofte van onbeperkte gratis hosting.
14. **Lokale regels vóór netwerk:** een update mag bestaande werking niet blokkeren. Een mislukte download, kapotte release of onbereikbare API wist nooit de laatste bruikbare regelset.

### 1.5 Niet-doelen van v1

- Geen medische diagnose of persoonlijke risicovoorspelling.
- Geen claim dat `PASS` volledige veiligheid voor alle mensen met epilepsie garandeert.
- Geen automatische audit van het volledige publieke internet.
- Geen internetbrede cloudcrawler in v1. Wel een autonome, lokaal uitgevoerde crawler voor de door de gebruiker gekozen website en een centrale backend voor index en rapporten.
- Geen autonome aankopen, formulierverzendingen, accountwijzigingen of andere transacties op de onderzochte website.
- Geen automatische toegang tot alle tabbladen bij installatie.
- Geen agressieve, globale contentblokkering in de eerste release.
- Geen volledige WCAG-conformiteitsaudit: de tool focust op relevante visuele en animatiecriteria.

---

## 2. Functionele scope

### 2.1 Hoofdmodules

| ID | Module | Prioriteit | Kernfunctie |
|---|---|---|---|
| MOD-01 | DevTools Audit Panel | P0 | Audit configureren, starten, volgen en rapporteren. |
| MOD-02 | Capture Manager | P0 | Gerenderde frames van de scancontext ontvangen en kwaliteit over navigaties bewaken. |
| MOD-03 | Frame Analysis Engine | P0 | Tijd-, kleur-, luminantie- en regiometingen. |
| MOD-04 | Result & Finding Engine | P0 | Bevindingen genereren, dedupliceren en classificeren. |
| MOD-05 | Local Audit Store | P0 | Audits, lokale historiek en nog te uploaden rapporten persistent bewaren. |
| MOD-06 | Reporting | P0 | Detailrapport, HTML- en JSON-export. |
| MOD-07 | DOM Attribution | P1 | Verdachte beeldregio verbinden met bron-element; basis-DOM-inventaris voor route- en actieherkenning is al P0 in de runner. |
| MOD-08 | Historical Analytics | P1 | Trends, regressies en opgeloste bevindingen. |
| MOD-09 | WCAG Validation | P1 | Strengere, gevalideerde normconforme beoordeling. |
| MOD-10 | Block Rule Management | P2 | Regels per site/element beheren en terugdraaien. |
| MOD-11 | Optional Blocker | P2 | Gerichte mitigatie op bezochte websites toepassen. |
| MOD-12 | Autonomous Site Runner | P0 | Routes ontdekken, navigeren, scrollen, scenario's uitvoeren, hervatten en dekking bijhouden. |
| MOD-13 | Online Site Index | P0 | Webportaal met doorzoekbare publieke sites, routes en auditrapporten. |
| MOD-14 | Publishing & Sharing | P0 | Gegevenspreview, privéopslag, deelbare links, publicatieversies en intrekken. |
| MOD-15 | Accounts & Backend | P0 | Eigenaarschap, toegangscontrole, API, centrale database en basisbeheer van meldingen. |
| MOD-16 | Standard Extension UI | P0 | Toolbar-popup en blijvend voortgangsscherm voor niet-ontwikkelaars; geen DevTools nodig. |
| MOD-17 | Action Policy & Coverage | P0 | Toegestane acties, scanlimieten, overgeslagen toestanden en stopredenen bewaken. |
| MOD-18 | Open Source & Delivery | P0 | README, bijdragen, beschermde merges, CI, releases en herhaalbare installatie. |
| MOD-19 | Hosted Index Operations | P0 | Goedkope hosting, quota, backups, herstel en kostenbewaking. |
| MOD-20 | Public JSON Feed | P0 | Gecontroleerde publieke regels exporteren, ondertekenen, versiebeheer en statische CDN-distributie. |
| MOD-21 | Offline Rule Updater | P2 | Ingebouwde basisset, lokale geverifieerde regelset, achtergrondupdates en herstel zonder serverafhankelijkheid. |

`P0` = eerste werkende versie; `P1` = kwaliteits- en analyse-uitbreiding; `P2` = blocker; `P3` = optioneel.

### 2.2 Auditmodi

#### F-AUD-00 — Autonome websitescan (P0, standaard)

- **Start:** huidige website via de toolbar; knop **Scan deze website** met bruikbare standaardinstellingen. DevTools biedt dezelfde modus.
- De gebruiker geeft zo nodig één keer de benodigde browser-/sitetoestemming aan het begin. Daarna voert de runner de scan uit zonder instructies per route of interactie.
- De runner ontdekt interne routes, bouwt een wachtrij op en onderzoekt routes en scenario's achtereenvolgens binnen de vastgelegde scope en limieten (§2.5).
- Automatisch scrollen, lazy-loaded inhoud laten laden, herkenbare menu's/accordions/tabs openen en ondersteunde media starten. Per stap vastleggen of de bedoelde toestand werkelijk bereikt en gemeten werd.
- Resultaten, dekking, onbereikbare routes en beperkingen worden automatisch samengevoegd en lokaal opgeslagen. Daarna kan de gebruiker het rapport online bewaren of delen volgens de bestaande publicatieflow.
- Een eindstatus, fout of bereikte limiet levert zelfstandig een rapport op; niet voortdurend wachten op gebruikersinstructies om verder te gaan.
- Browserautorisatie die tijdens de scan onverwacht wegvalt onderbreekt de job; een door de gebruiker gekozen hervatting kan nieuwe toestemming vereisen. Dat is herstel na onderbreking, geen stap per pagina.

#### F-AUD-01 — Snelle viewportmeting (P0, geavanceerd)

- Voorinstelling: **15 seconden**.
- Analyseert de **zichtbare en gerenderde** huidige tab.
- Registreert start- en eindtijd, effectieve frames per seconde en gedropte frames.
- Geeft na afloop resultaten voor de werkelijk geobserveerde periode.
- Mag de site-index bijwerken, ook wanneer geen problemen gevonden zijn.
- Scant niet automatisch de volledige pagina onder de huidige scrollpositie.

#### F-AUD-02 — Uitgebreide viewportmeting (P0, geavanceerd)

- Voorinstelling: **30 seconden**, instelbaar binnen een configureerbare grens.
- Zelfde detectie als snelle audit, maar meer tijd om video's en loops te observeren.
- Gebruiker kan video of interactie zelf activeren tijdens de audit.
- Beperkte scope expliciet vermelden in rapport en index.

#### F-AUD-03 — Handmatige aanvullende audit (P1, optioneel voor experts)

- Gebruiker navigeert, klikt, scrollt, opent menu's en start video's.
- Analyse blijft doorlopen zolang de opname actief is en technisch beschikbaar blijft.
- SPA-routewisselingen worden als afzonderlijke **observaties binnen dezelfde sessie** opgeslagen.
- Bij volledige documentnavigatie opnieuw DOM-instrumentatie koppelen en capturecontinuïteit controleren. Alleen bij werkelijk weggevallen autorisatie of stream is herstel nodig; geen standaard bevestiging na iedere navigatie.
- Registreert, zonder persoonlijke formulierwaarden op te slaan, welke algemene actiescenario's werden uitgevoerd: bijvoorbeeld `initial-load`, `scroll`, `menu-open`, `video-play`, `full-screen`.

#### F-AUD-04 — Aanvullende scopes (P1/P3)

- Geselecteerd DOM-element of gebied meten.
- Video in normale weergave én fullscreen testen.
- Een aangeleverde routelijst als aanvullende seedset voor de bestaande autonome P0-runner (P1).
- CLI/CI en meerdere afzonderlijke websites per opdracht (P3). De gewone websitescan vereist geen handmatig samengestelde routelijst.

### 2.3 Capture en controle

- [ ] Start-, pauze- en stopbediening in zowel de gewone extensie-interface als DevTools.
- [ ] Browseractie/toolbar-startflow voor de expliciete gebruikersactie die de capture nodig heeft; geen DevTools-afhankelijkheid.
- [ ] Aanduiding van de tab die geanalyseerd wordt.
- [ ] Statussen `READY`, `REQUESTING_PERMISSION`, `CAPTURING`, `ANALYZING`, `FINALIZING`, `DONE`, `INTERRUPTED`, `ERROR`.
- [ ] Pauzeren en hervatten van de *audit* (met aparte meetsegmenten; geen fictieve continue tijdslijn).
- [ ] Capture wordt beëindigd wanneer gebruiker stopt of de toestemming/stream wegvalt.
- [ ] Eén actieve opname per relevante capturecontext om conflicten te voorkomen.
- [ ] De gebruiker moet altijd kunnen zien dat een opname loopt.
- [ ] Geen ruwe audio opnemen; videometingen vereisen geen geluidsopslag.
- [ ] Toon expliciet wanneer frames ontbreken of een venster niet betrouwbaar te beoordelen is.
- [ ] Sluiten van de popup of DevTools stopt de scan niet; voortgang en stopknop zijn opnieuw bereikbaar via de toolbar.
- [ ] Stoppen annuleert de navigatie-/actiewachtrij en capture, bewaart deelresultaten en laat geen nieuwe achtergrondacties starten.

### 2.4 Bronnen die worden geanalyseerd

| Contenttype | Benadering | Opmerking |
|---|---|---|
| HTML/CSS-animatie | Gerenderde frameanalyse | DOM-inspectie ondersteunt lokalisatie. |
| GIF / APNG / WebP-animatie | Gerenderde frameanalyse | Ook overgang tussen loop-einde en -begin testen. |
| `<video>` | Gerenderde frameanalyse | Zowel inline als fullscreen waar mogelijk. |
| Canvas 2D | Gerenderde frameanalyse | Broncode niet noodzakelijk beschikbaar. |
| WebGL | Gerenderde frameanalyse | Bronlokalisatie mogelijk minder betrouwbaar. |
| CSS `transition` / `animation` | Frameanalyse + Web Animations API | Metadata helpt bij elementherkenning. |
| SVG/SMIL-animatie | Frameanalyse + eventuele DOM-informatie | Niet uitsluitend op DOM vertrouwen. |
| Iframes | Wat zichtbaar mee gerenderd wordt | DOM-toegang kan afhangen van hostpermissies en origins. |
| CSS achtergronden | Frameanalyse + computed styles | Selector bij voldoende zekerheid. |
| Fullscreenmedia | Nieuwe captureconfiguratie/scenario | Afhankelijk van browservaardigheden en zichtbaarheidsgrenzen. |

**Grens:** de engine analyseert wat de capture daadwerkelijk registreert. Content buiten het zichtbare gebied, achter tabs, in niet-geopende UI of in niet-bereikte toestanden wordt niet stilzwijgend als getest gemarkeerd.

### 2.5 Autonome route- en scenarioverkenning (P0)

**Ontdekken en plannen**

- Begin op de gekozen URL en bezoek interne navigatielinks op dezelfde exacte origin. Ontdek extra routes uit gerenderde links, bereikbare SPA-navigatie en, waar beschikbaar en toegestaan, een sitemap; een sitemap is een bron van kandidaten, geen bewijs van auditdekking.
- Normaliseer en dedupliceer routes vóór opname in de wachtrij. Volg redirects alleen binnen de toegestane scope; andere origins en subdomeinen zijn standaard buiten scope.
- Houd relevante, toegestane routeparameters bij; begrens paginering, kalenderpaden, zoekfilters, herhaalde routepatronen en oneindige scroll. Sla links met geheime parameters of aanwijzingen voor transacties over.
- Stel automatisch een scanplan op. Voorlopige standaardbudgetten: maximaal **50 routes**, **4 linkniveaus** en **20 minuten** per job; de PoC moet deze waarden onderbouwen. Geen belofte dat alle 50 routes binnen 20 minuten voltooid zijn.
- Meet standaard 15 seconden in de initiële toestand van een pagina; observeer daarna bereikte relevante toestanden afzonderlijk, met een begrensd mediavenster van maximaal 30 seconden per medium. Registreer de werkelijk gemeten duur per toestand; kortere/gedegradeerde observaties beperken de conclusie.
- Eén actieve route tegelijk, begrensde laadtijd, vertraging tussen navigaties en maximaal één retry voor een tijdelijke lees-/laadfout. Bij overbelasting of rate limiting vertragen of afronden met beperkte dekking.

**Zelf uitvoeren**

- Leg de initiële toestand vast, scroll vervolgens met overlap door zichtbare delen en wacht begrensd op lazy loading. Beperk stappen en totale paginahoogte; oneindige inhoud eindigt met een zichtbare limietreden.
- Open herkenbare navigatiemenu's, accordions, lokale tabs en carrouselbediening via ondersteunde controlpatronen. Test bereikbare hover-/focusreacties waar de gebruikte uitvoeringsmethode dit aantoonbaar kan.
- Start ondersteunde video of animatie zonder geluid weer te geven, registreer de bereikte afspeeltoestand en herstel lokale mediastatus waar mogelijk. Een geweigerde playback of fullscreenactie krijgt een beperkingsreden; een uitgestuurde click is geen bewijs van uitvoering.
- De startpolicy bepaalt hoe herkenbare consentdialogen behandeld worden: standaard alleen een bekende optie om niet-noodzakelijke toestemming te weigeren. Onbekende dialoog of login/CAPTCHA: vastleggen als blokkade en doorgaan met andere bereikbare routes.
- De runner classificeert acties volgens een expliciete allowlist van inspectiehandelingen. Geen willekeurig klikken op alle knoppen, geen formulieren invullen/verzenden, geen aankopen, downloads, berichten, verwijderen, uitloggen of account-/cookievoorkeuren wijzigen buiten de vastgelegde consentpolicy. Bij twijfel overslaan met reden.
- Inspecteer ook navigatiebestemmingen vóór uitvoering; een `<a>` of GET-bestemming is niet automatisch vrij van bijwerkingen. In het gewone browserprofiel kunnen bestaande sessies aanwezig zijn: dat maakt extra controles nodig, geen automatische toestemming voor accountacties.

**Zelf afronden**

- Per route/scenario registreren: ontdekt, ingepland, bereikt, gemeten, gedeeltelijk gemeten, overgeslagen of mislukt, plus reden en tijdsbereik.
- Stop bij lege wachtrij, budgetgrens, gebruikersstop, ingetrokken toegang of onherstelbare capturefout. Eén geblokkeerde route mag andere toegestane routes niet blokkeren.
- `COMPLETED` betekent dat alle ingeplande taken binnen de gedefinieerde scope zijn afgehandeld. Overgeslagen of onvoldoende gemeten taken en resterende wachtrij betekenen `PARTIAL`; onbekende routes buiten het ontdekte deel blijven expliciet onbekend.
- De uitvoeringsstatus van de job en de meetuitkomst zijn gescheiden: een volledig uitgevoerde scan kan problemen vinden of een onbeslisbare beoordeling geven, bijvoorbeeld omdat normvalidatie ontbreekt. Ontbrekende scenario's of onbruikbare capture betekenen wel beperkte uitvoering. Een scan die geen problemen vond is niet automatisch volledig.
- De gebruiker krijgt één eindrapport met aantallen, meetkwaliteit, bevindingen en de concrete stopreden. Handmatige expertbeoordeling kan later een bevinding verduidelijken, maar is geen voorwaarde om de autonome scan af te ronden.

---

## 3. Gebruikerservaring en schermen

### 3.1 Twee interfaces, dezelfde autonome scan

De extensie biedt vanaf P0 twee interfaces op dezelfde job, metingen en resultaten:

- **Gewone extensie:** toolbar-popup om de huidige site te scannen en een blijvend voortgangsscherm, bijvoorbeeld een side panel. Werkt volledig met DevTools gesloten. De gebruiker hoeft geen technische scaninstellingen te kiezen.
- **DevTools:** een eigen tab **epi-less**, bijvoorbeeld naast Lighthouse, met dezelfde autonome websitescan plus viewportmetingen, technische details en later handmatige expertmodi.

Voortgang en rapporten horen bij de scanjob, niet bij een open venster. Beide interfaces kunnen een bestaande job weergeven en pauzeren/stoppen zonder een tweede scan te starten.

Het startscherm bevat:

- Pagina-URL (privégegevens in queryparameters niet als indexsleutel tonen).
- Vorige auditstatus voor de huidige route.
- Laatste scan, laatste openstaande bevindingen en bekend aantal eerdere analyses.
- Primaire actie **Scan deze website**, met automatisch gekozen scope en scanbudget.
- Een samenvatting van de scope, bijvoorbeeld `Deze website · maximaal 50 pagina's · maximaal 20 minuten`; technische instellingen staan onder geavanceerd.
- In DevTools aanvullende `Snelle viewportmeting`, `Uitgebreide viewportmeting` en later `Handmatige audit`.
- Toegang tot **Lokale audits**, **Online index**, **Historiek**, **Rapporten** en **Instellingen**.
- Account- en uploadstatus; een verbindingsprobleem mag lokaal auditen niet blokkeren.

### 3.2 Scherm A — Gewone extensie

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ epi-less Audit                                                         │
│ https://voorbeeld.be/artikel                                             │
│                                                                           │
│ Vorige analyse: NEEDS_REVIEW   2 kandidaten   24-10-2026                  │
│                                                                           │
│ Website automatisch onderzoeken                                         │
│ Pagina's bezoeken, scrollen en ondersteunde interacties testen            │
│ Maximaal 50 pagina's · maximaal 20 minuten                               │
│                                                                           │
│ [ Scan deze website ]                                                    │
│                                                                           │
│ [Mijn rapporten] [Online index] [Geavanceerd]                             │
└───────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Scherm B — Tijdens de audit

De gewone interface toont voortgang in gewone taal, zonder knipperende indicatoren:

- Bijvoorbeeld `12 pagina's onderzocht · 19 ontdekt · 2 niet bereikbaar` met de aantallen als momentopname, niet als percentage van de volledige onbekende website.
- Huidige stap: `Pagina's zoeken`, `Pagina onderzoeken`, `Menu testen`, `Video onderzoeken` of `Rapport maken`.
- Verstreken tijd, resterend scanbudget en pauze-/stopbediening.
- De gebruiker hoeft niet te kijken naar de gescande media of aanwijzingen te geven. Capture zonder actieve weergave moet in de PoC worden bewezen (§7.3); geen automatisch getoonde livepreview in de extensie.

DevTools kan aanvullende technische informatie tonen:

- Verstreken tijd en vastgelegde meetsegmenten.
- Huidig aantal ontvangen frames en effectieve framerate.
- Meetkwaliteit: volledig / gedegradeerd / onbeslisbaar.
- Aantal voorlopige kandidaten en hun tijdstip.
- Huidige route en scenario.
- Automatisch scenario-/actielog; later een optionele knop **Markeer interactie** voor de handmatige expertmodus.
- Stop- en pauzeknoppen.

**Geen autoplay van risicovolle beelden, geen knipperende badges en geen flitsende grafieken in de extensie zelf.**

### 3.4 Scherm C — Auditrapport

Het resultaat krijgt vier hoofdsecties:

1. **Samenvatting** — begrijpelijke uitkomst, jobstatus en stopreden, ontdekte/geteste/overgeslagen routes, criteria, meetkwaliteit, duur en aantal unieke bevindingen.
2. **Bevindingen** — per probleemtype en ernst, met metingen en mogelijke bron.
3. **Tijdslijn** — waar en wanneer risicovolle transities gedetecteerd werden; statische visualisatie.
4. **Technische details** — engineversie, regelsversie, resolutie, schaal, timestamps, dropped frames, beperkingen.

Voorbeeld van een bevinding:

```text
FG-000123  |  Verdachte rode flitsen              | NEEDS_REVIEW
Route      |  /campagne
Tijd       |  12,4 s tot 13,2 s
Gemeten    |  5 flitsen in een voortschrijdend venster van 1 seconde
Gebied     |  x=320 y=180 w=460 h=240 (capturecoördinaten)
Bron       |  video.hero-background  (confidence: 0,88)
Norm       |  WCAG 2.3.1 (A), mogelijke niet-conformiteit
Bewijs     |  temporele metingen + regio + broncorrelatie
Acties     |  [Inspecteer element] [Markeer false positive] [Delen] [Export]
```

Deze getallen zijn **uitsluitend fictieve UI-voorbeelden**, geen resultaten van een echte website.

Voor de gewone gebruiker staan de betekenis en volgende stap voorop: `Mogelijke flitsproblemen gevonden`, `Geen problemen waargenomen in de geteste delen` of `Scan gedeeltelijk uitgevoerd`. Technische metingen blijven uitklapbaar. Een label als `Scan afgerond` zegt alleen iets over de uitvoering; de meetuitkomst en dekking worden er altijd naast getoond.

### 3.5 Scherm D — Website-index

De **online index** is een website die ook buiten Chrome DevTools en zonder extensie te openen is. Ze biedt zoeken op domein en filters op auditdatum, status en criterium. Een ingelogde gebruiker heeft daarnaast een overzicht van eigen privérapporten en rapporten die alleen via een link gedeeld worden. In de extensie blijft een lokaal overzicht beschikbaar voor offline gebruik.

Voorbeeld van zichtbare resultaten (fictief; een normatief bevestigde uitkomst is pas mogelijk na de validatie uit fase 2):

| Site | Geobserveerde pagina's | Laatste status | Open kandidaten | Laatste audit |
|---|---:|---|---:|---|
| `voorbeeld.be` | 5 | `NEEDS_REVIEW` | 2 | 24/10/2026 |
| `webshop.be` | 12 | `NON_CONFORMANT` | 4 | 23/10/2026 |
| `portfolio.be` | 3 | `NO_ISSUES_OBSERVED` | 0 | 20/10/2026 |

Klik op een site voor:

- Alle geobserveerde routes en hun laatste auditstatus.
- Auditgeschiedenis per route.
- Gemeten risico's en unieke element-fingerprints.
- Nieuwe, terugkerende, opgeloste en geaccepteerde bevindingen.
- Dekking: hoeveel bekende routes getest werden; welke scenario's niet getest zijn.
- Trend over tijd en verschil tussen twee audits.
- Herkomst, auditdatum, publicatiedatum en link naar de betreffende rapportversie.
- (P2, eigen lokale overzicht) Actieve en voorgestelde blokkeerregels; die worden niet automatisch publiek gedeeld.

Publieke lijsten, tellingen en zoekresultaten gebruiken uitsluitend publieke rapporten. Privérapporten en rapporten die alleen via link beschikbaar zijn, mogen ook niet via aantallen of recente-activiteitsoverzichten uitlekken.

### 3.6 Scherm E — Elementdetail

Toon bij elke bevinding:

- Type (`general-flash`, `red-flash`, `animation-control`, enzovoort).
- Impact/severity en beoordeling (`candidate`, `confirmed`, `false_positive`, `resolved`).
- Exact tijdsinterval en timestampbron.
- Region of interest in capture- en bij voorkeur CSS-pixelcoördinaten.
- Frequentie, maximumtransitie, relatieve luminantie, indicatie van rood en gebiedsdekking.
- Selector, elementtype, mediabron en framepad, **alleen indien vastgesteld**.
- Confidence-score voor DOM-koppeling; niet verwarren met medische of WCAG-zekerheid.
- Welke audits hetzelfde probleem opnieuw zagen.
- Handmatige notities en beoordelaar (vrij tekstveld, standaard leeg).
- Vervolgacties: inspecteren, onderbouwen, markeren als opgelost, later een blokkeerregel voorstellen.

### 3.7 Scherm F — Online bewaren en delen (P0)

1. De runner maakt en bewaart zelfstandig een eindrapport, ook bij gedeeltelijke dekking. Gebruiker kan daarna **Delen / online bewaren** kiezen; publicatie is geen voorwaarde voor het voltooien van de scan.
2. Indien nodig aanmelden; de lokale audit blijft behouden als aanmelden of uploaden mislukt.
3. Preview van de **exacte te versturen gegevens**: site, routes, metingen, bevindingen, dekking en beperkingen. Gevoelige paden, selectors en notities kunnen worden verwijderd of geredigeerd.
4. Zichtbaarheid kiezen: **Privé** (standaard), **Iedereen met de link** of **Publiek in de index**. Voor de twee deelopties is een bewuste keuze vereist.
5. Opslaan verstuurt uitsluitend de gecontroleerde rapportsnapshot. Pas na bevestiging door de server verschijnt **Online bewaard** of **Link kopiëren**.
6. Het beheerscherm toont zichtbaarheid, rapportversie, publicatiedatum en acties om toegang te beperken, een link in te trekken of een rapport te verwijderen.

De ontvanger ziet een leesbaar rapport met auditdatum, scenario's, meetkwaliteit, engineversie en herkomst. Publieke en via-link-rapporten zijn zonder account leesbaar. Een hertest krijgt een eigen rapportlink; eerdere gedeelde meetresultaten worden niet stilzwijgend overschreven.

Een deelpreview in chat of sociale media gebruikt een statische epi-less-afbeelding en een neutrale titel. De preview speelt geen gemeten content af en verklaart een hele website niet veilig. Alleen publieke rapporten krijgen inhoudelijke externe previews; privé- en via-link-rapporten gebruiken generieke metadata.

---

## 4. Audit-engine en WCAG-controles

### 4.1 Relevante criteria

| WCAG 2.2 | Niveau | Betekenis voor epi-less | Type controle |
|---|---|---|---|
| **2.3.1 — Three Flashes or Below Threshold** | A | Meer dan drie flitsen in één seconde, tenzij onder zowel de algemene als rode flitsdrempels. | Temporele + ruimtelijke frameanalyse. |
| **2.3.2 — Three Flashes** | AAA | Geen content die meer dan drie keer in één seconde flitst, onafhankelijk van de uitzondering voor kleine oppervlakken. | Temporele frameanalyse. |
| **2.2.2 — Pause, Stop, Hide** | A | Bepaalde automatisch bewegende/knipperende/scrollende content moet pauzeerbaar, stopbaar of verbergbaar zijn; specifieke voorwaarden en uitzonderingen gelden. | DOM-analyse + handmatige verificatie. |
| **2.3.3 — Animation from Interactions** | AAA | Interactiegestuurde bewegingsanimaties moeten, behoudens essentiële animaties, uitschakelbaar zijn. | Inspectie + handmatige verificatie. |

**Let op:** niet elke bewegende animatie is een epilepsieflits. Een waarschuwing op 2.2.2 of 2.3.3 is niet automatisch een overtreding van 2.3.1.

### 4.2 Definities van de flitsanalyse

Volgens WCAG 2.2:

- Een **flits** is een *paar tegengestelde transities* (bijvoorbeeld licht → donker → licht) in een relevant beeldgebied; één afzonderlijke overgang telt niet automatisch als volledige flits.
- Een **algemene flits** omvat tegengestelde veranderingen in relatieve luminantie van minstens `0,10` (op schaal 0–1) waarbij de donkerdere toestand een relatieve luminantie heeft onder `0,80`.
- Een **rode flits** wordt afzonderlijk beoordeeld; de WCAG-toelichting hanteert onder andere verzadigd rood met `R / (R + G + B) >= 0,8` en een kleurverschil van meer dan `0,2` in het CIE 1976 UCS-chromaticiteitsdiagram.
- Het aantal flitsen wordt geteld in **elk voortschrijdend venster van één seconde**, niet in alleen kalenderseconden of niet-overlappende blokken.
- Voor WCAG 2.3.1 is de uitzondering voor het *gecombineerde gelijktijdig flitsende gebied* relevant: maximaal `0,006` steradiaal, equivalent aan 25% binnen een visueel veld van 10 graden op normale kijkafstand. De W3C-uitleg gebruikt een referentiegebied van `341 × 256` CSS-pixels als praktische benadering.
- De kleine-patroonuitzondering en de daadwerkelijke ruimtelijke/contigue criteria mogen niet door een simplistisch percentage van de hele viewport worden vervangen.
- Bij SDR/HDR en verschillende kleurruimten zijn aanvullende beoordelingsregels van toepassing. **Niet correct gemeten HDR wordt als beperkt/onbeslisbaar gerapporteerd.**

De precieze implementatie moet tegen de W3C-definities gevalideerd worden; de bovenstaande samenvatting is niet op zichzelf een volledige conformiteitstest.

### 4.3 Verwerkingspipeline

De autonome runner levert de pagina-/scenariocontext: **route ontdekken → navigeren → begintoestand meten → toegestane interactie uitvoeren → bereikte toestand meten → volgende taak**. De detector hieronder verwerkt de daadwerkelijke frames; routeontdekking of een geslaagde navigatie alleen is geen flitsanalyse.

```text
Gecapteerde tabframes + echte timestamps
                 │
                 ▼
     Kwaliteits- en formaatcontrole
   (fps, tijdgaten, resolutie, kleurprofiel)
                 │
                 ▼
       Per-pixel / per-regio analyse
      (lineaire RGB, luminantie, rood)
                 │
                 ▼
           Temporele detectie
       (pieken/dalen en omkeringen)
                 │
                 ▼
           Ruimtelijke clustering
       (actieve regio's en oppervlak)
                 │
                 ▼
      Voortschrijdende 1s-vensters
                 │
                 ▼
    WCAG-regels + onzekerheidscontrole
                 │
                 ▼
      Bevindingen + eventuele DOM-link
                 │
                 ▼
     Auditrapport + lokale site-index
                 │
                 ▼
     Gebruiker controleert deelgegevens
                 │ expliciet online bewaren / publiceren
                 ▼
        API → online index + rapportlink
```

### 4.4 Frame Capture Requirements

- **ENG-01:** werk met werkelijke presentatietimestamps of capturetijdstippen, nooit met alleen `frameIndex / 60`.
- **ENG-02:** vraag waar mogelijk een framerate richting 60 fps, maar **meet de effectief ontvangen rate**; een verzoek van 60 fps is geen garantie.
- **ENG-03:** registreer dropped frames, lange tijdgaten, onverwachte schaalwisselingen en streamonderbrekingen.
- **ENG-04:** maak kwaliteitsniveaus (`HIGH`, `PARTIAL`, `INSUFFICIENT`) en bewaak de uitkomst op basis van deze kwaliteit.
- **ENG-05:** verwerk framebuffers in geheugen; sla geen volledige videostream standaard op.
- **ENG-06:** voorkom onbeperkte wachtrijen; kies bij overload voor gedocumenteerde sampling en **degradeer de conclusie**.
- **ENG-07:** onderscheid het bronformaat en analyseformaat; onduidelijke kleurconversie mag niet onzichtbaar leiden tot een `PASS`.
- **ENG-08:** test loop-overgangen en video op de grootst beschikbare relevantie weergaveschaal, inclusief fullscreen wanneer toepasselijk.
- **ENG-09:** track navigatie en viewportveranderingen als aparte meetsegmenten.
- **ENG-10:** koppel ieder meetsegment aan de autonome job, routetaak en daadwerkelijk bereikte scenario-/actiestap; tel verkenning zonder geldige frames niet als meting.

### 4.5 Detectoren

#### DET-01 — Algemene flitsdetectie

- Bereken relatieve luminantie volgens de correcte sRGB-linearisatie wanneer de input sRGB is.
- Detecteer voldoende sterke *tegengestelde* luminantietransities binnen consistente ruimtelijke gebieden.
- Onderscheid temporele omkeringen van blijvende wijzigingen zoals navigeren van een lichte naar een donkere pagina.
- Tel flitsen per voortschrijdend venster van één seconde.
- Bereken gelijktijdig actieve regio's en relevante oppervlakte binnen de normatieve referentie.
- Bewaar piekwaarden, tijdsinterval en interpretatie.

#### DET-02 — Rode flitsdetectie

- Afzonderlijke analyse van verzadigd rood en tegengestelde kleurtransities.
- Correcte implementatie en tests voor CIE 1976 UCS; **geen simpele `red > 200`-heuristiek als conformiteitstest**.
- Combineer met tijd- en oppervlaktecriteria waar toepasselijk.
- Geef expliciet aan wanneer kleurprofiel of HDR-informatie onvoldoende betrouwbaar is.

#### DET-03 — Flitsoppervlakte

- Bepaal welke pixels/regio's op hetzelfde moment bijdragen aan een relevante flits.
- Cluster de betrokken ruimtelijke gebieden; voorkom optelling van totaal verschillende tijdstippen alsof ze gelijktijdig waren.
- Bereken de normatieve 10-graden/steradiaal-benadering zorgvuldig; gebruik geen globaal `> 25% van de viewport` als vervanging.
- Rapporteer de berekeningsmethode en onzekerheid bij viewport- of schaalafwijkingen.

#### DET-04 — Animatie- en bewegingsinventaris (P1)

- Lees waar toegelaten `document.getAnimations()` en relevante computed styles.
- Inventariseer animaties die automatisch starten, lang blijven bewegen of interactiegestuurd zijn.
- Controleer of `prefers-reduced-motion` gerespecteerd wordt waar relevant.
- Inventariseer aanwezige pauze-, stop- of verbergmechanismen.
- Label resultaten als **onderzoeksbevinding** totdat essentiële content, duurvoorwaarden en gebruikerscontrole correct geëvalueerd zijn.

#### DET-05 — Bronattributie (P1)

**Implementatiestatus 0.4:** tijdens observatie bewaart een begrensde sampler DOM-geometrie, scrollposities, mutatietellingen, toegelaten animatiegegevens en videotijd. Een finding krijgt kandidaten uit het geschatte capturevenster, met expliciete ontbrekende samples, veroudering en onbekende kloklatentie. Lokale DevTools-inspectie valideert het oorspronkelijke node-object; een vervangen element op hetzelfde pad wordt geweigerd. DOM-samples en videoframes zijn niet atomair gemeten. Dit ondersteunt onderzoek en herstel, maar voltooit onderstaande vereisten voor bewezen bronattributie niet. Achteraf verzamelde hints blijven herkenbaar als achteraf verzameld; lokale inspectietokens komen niet in exports of publicaties.

- Koppel een gedetecteerde capture-regio op het juiste tijdstip aan de layout van het document.
- Gebruik DOM-geometrie, `elementsFromPoint`, video/canvas/SVG-elementen, animatiemetadata en framecontext.
- Bewaar meerdere kandidaten bij overlap in plaats van één selector te verzinnen.
- Ondersteun SPA-mutaties, scroll-offset en `devicePixelRatio`.
- Bewaar expliciete `confidence` en `attributionMethod`.
- Geen DOM-toegang in cross-origin frames? Rapporteer **frame zichtbaar, bron niet inspecteerbaar**.

### 4.6 Auditbeslissingen

Een audit heeft een van de volgende statuswaarden:

| Status | Betekenis |
|---|---|
| `NOT_TESTED` | Geen geldige meting voor deze route of scenario. |
| `IN_PROGRESS` | Meting is bezig; nog geen definitief resultaat. |
| `NO_ISSUES_OBSERVED` | Binnen de geregistreerde meetsegmenten geen problemen gedetecteerd; dit is een beperkte observatie. |
| `NEEDS_REVIEW` | Eén of meer kandidaten die niet voldoende zeker als overtreding beoordeeld zijn. |
| `NON_CONFORMANT` | Overtreding bevestigd volgens een gevalideerde beoordeling van een specifiek criterium binnen de gemeten scope. |
| `INCONCLUSIVE` | Te weinig betrouwbare frames, onvoldoende dekking of technisch relevante onzekerheid. |
| `ERROR` | Audit niet correct uitgevoerd of niet opgeslagen. |

**Geen `PASS` bij:** alleen DOM-heuristiek; onvoldoende framerate; niet-ondersteunde of ongevalideerde kleurconversie; niet-geobserveerde relevante scenario's; scan van een pagina waarvan eerder gevonden risico's door een actieve blocker werden onderdrukt zonder referentiemeting.

Voor compatibele exports kan `passed: true | false | null` worden aangeboden:

- `true`: voor het **uitdrukkelijk gespecificeerde, daadwerkelijk geteste criterium en meetbereik** aan alle daarvoor vereiste controlevoorwaarden voldaan.
- `false`: conformiteitsprobleem bevestigd voor dat criterium en bereik.
- `null`: niet getest, indicatief, onvoldoende bewijs of onbeslisbaar.

Tijdens de eerste, nog niet gevalideerde MVP is de standaardwaarde van `passed` **`null`**, ook als er geen problemen werden gevonden. De UI mag wel `Geen problemen waargenomen` tonen.

### 4.7 Severity en detectievertrouwen gescheiden houden

`severity` beschrijft prioriteit/impact van de *bevinding*, `confidence` de zekerheid van een technische gevolgtrekking en `reviewStatus` de staat van menselijke of gevalideerde beoordeling. Niet alles met een hoge confidence is automatisch een definitieve WCAG-overtreding.

---

## 5. Permanente website-index

### 5.1 Waarom de index essentieel is

epi-less mag niet bij iedere scan opnieuw beginnen alsof er geen historiek bestaat. De online index bewaart gedeelde resultaten; de lokale index bewaart ook nog niet geüploade audits. Een index per website moet antwoord geven op:

1. Is deze website al eerder onderzocht?
2. Welke specifieke routes zijn getest?
3. Wat was de laatste status per route en per WCAG-criterium?
4. Welke scenario's en welk tijdsbereik werden autonoom onderzocht, en welke stappen konden niet uitgevoerd worden?
5. Welke problemen werden herhaaldelijk gedetecteerd?
6. Welke problemen zijn nieuw, teruggekomen of opgelost?
7. Welke elementen hebben een stabiele fingerprint en kunnen later gericht geblokkeerd worden?
8. Staan er al blokkeerregels actief, en waren die actief tijdens de meting?
9. Hoe evolueert de website over dagen/weken/revisies?
10. Welke rapporten kan ik via een link delen, en welke staan publiek in de index?
11. Wie heeft een resultaat aangeleverd, wanneer is er gemeten en hoe is het beoordeeld?
12. Waar is de verkenning gestopt: alle geplande taken afgehandeld, budget bereikt, toegang geblokkeerd of technisch onderbroken?

Elk overzicht past deze vragen toe op de gegevens waartoe de bezoeker toegang heeft. De publieke index bevat geen verborgen samenvatting van alle lokaal uitgevoerde of privé opgeslagen audits.

### 5.2 Drie indexniveaus

**Niveau A — Site**

- Exacte `origin` als technische primaire scope, bijvoorbeeld `https://www.voorbeeld.be`.
- Optioneel een visuele groepering per registreerbaar domein, bijvoorbeeld `voorbeeld.be` met subdomeinen; afzonderlijke origins nooit stilzwijgend samensmelten.
- Eerste waarneming, laatste audit, aantal routes, aantal sessies, aantallen open en opgeloste problemen.
- Laatste **samengestelde site-indicatie**, altijd met dekkingsgraad.

**Niveau B — Pagina / route**

- Genormaliseerd pad zoals `/producten/123`.
- Apart overzicht voor routestates/scenario's.
- Historiek met versies, status, technische kwaliteit en terugkerende bevindingen.
- Registreer of de pagina daadwerkelijk gemeten is of uitsluitend bekend is door automatische ontdekking, gebruikersinvoer of import; bewaar de ontdekbron en eventuele overslagreden.

**Niveau C — Element / issue**

- Stabiele fingerprint van een vermoedelijke bron, *met versie*.
- Type risicopatroon, bronselector (indien betrouwbaar), broncontext en waargenomen regio.
- Historiek van eerste en laatste waarneming.
- Status van probleem, handmatige beoordeling en gekoppelde blockerregels.

### 5.3 URL-normalisatie en privacy

Een indexsleutel wordt niet simpelweg de volledige browser-URL.

**Standaard:**

- `origin` = scheme + host + port.
- `normalizedPath` = pad met eenduidige slash- en percent-encodingnormalisatie.
- Fragment (`#...`) standaard **niet** bewaren, tenzij routing expliciet als een hash-route herkend wordt; sla dan alleen de relevante routecomponent op.
- Queryparameters standaard **niet** bewaren: hier kunnen tokens, e-mailadressen of persoonsgegevens in staan.
- De gebruiker kan per site expliciet onschuldige querykeys opnemen die wezenlijk andere pagina's opleveren, bijvoorbeeld `?lang=nl`.
- Parameterwaarden met sleutelnamen als `token`, `key`, `auth`, `session`, `email` en `code` standaard nooit persistent opslaan.
- Optioneel een geconfigureerde routegroepering zoals `/product/:id`; het ruwe pad blijft afzonderlijk traceerbaar zonder geheime querystrings.
- Pagina's die via SPA-history veranderen, krijgen een route-entry bij gewijzigde relevante route.
- Ook paden, paginatitels, selectors en vrije notities kunnen gevoelige gegevens bevatten. Voor upload is daarom een aparte veldselectie en redactie nodig; alleen querystrings verwijderen is onvoldoende.
- Een geredigeerde route blijft herkenbaar als geredigeerd en wordt niet automatisch samengevoegd met een andere concrete route. Ontbrekende route-informatie verlaagt de vergelijkbaarheid.

**Aanbevolen technische opslag:** `siteId = hash(origin)` en `pageId = hash(siteId + normalizedRouteKey)`, met dezelfde informatie in leesbare velden waar privacy dit toelaat. Gebruik stabiele versieerbare hashes, geen willekeurig wisselende indexsleutels.

Deze deterministische sleutels dienen voor **lokale deduplicatie**, niet voor anonimiteit of toegangscontrole. Online rapporten krijgen onvoorspelbare identifiers; toegang wordt afzonderlijk gecontroleerd. Canonieke publieke site-identiteit blijft gebaseerd op de exacte origin. Privédata blijft aan de eigenaar gekoppeld en stroomt niet via gedeelde sleutels in publieke aggregaties.

### 5.4 Site-status: samenstellen zonder valse zekerheid

Een site kan pas betekenisvol beoordeeld worden met een expliciete **auditscope** (bijvoorbeeld `12 van 19 ontdekte routes, met initial-load, scroll en bereikbare menu's`). De runner legt de scope en het uitgevoerde scenario-overzicht automatisch vast. De indicator voor een site is dus niet het resultaat van één willekeurige pagina.

Regels voor het samenvatten:

1. Een **bevestigde overtreding** in de geteste scope → `NON_CONFORMANT` voor de relevante scope.
2. Geen bevestigde overtreding, wel kandidaten → `NEEDS_REVIEW`.
3. Onvoldoende metingen of ongeteste verplichte scenario's → `INCONCLUSIVE` of `PARTIALLY_TESTED` als de dekking apart wordt weergegeven.
4. Geen problemen waargenomen in alle *daadwerkelijk gemeten* scenario's → `NO_ISSUES_OBSERVED` voor die scope.
5. Een eventuele beperkte conformiteitsclaim vereist een afgebakende scope en aantoonbaar gehaalde criteria, scenario's en kwaliteitsvoorwaarden. Een automatisch ontdekte routeverzameling bewijst geen volledige site-inventaris; de standaard websitescan kent daarom geen globale `SITE_PASS` toe.

Op de sitekaart staat dus liever:

> `Geen problemen waargenomen · 5 van 12 bekende routes getest · 3 scenario's`

in plaats van:

> `Deze website is veilig`.

Toon bij een autonome scan daarnaast de stopreden en hoeveel routes/scenario's nog openstaan. `100% van de wachtrij afgehandeld` is geen `100% van de website onderzocht`.

### 5.5 Levenscyclus van een bevinding

```text
NEW_CANDIDATE
      │
      ├──► NEEDS_REVIEW ──────► CONFIRMED
      │             │                  │
      │             └──► FALSE_POSITIVE│
      │                                ▼
      │                             RESOLVED
      │                                │
      └────────────────────────────────┴──► REGRESSED (nieuw gezien)
```

- **`NEW_CANDIDATE`**: eerste technische detectie.
- **`NEEDS_REVIEW`**: wachten op voldoende bewijs/validatie.
- **`CONFIRMED`**: normatieve overtreding bevestigd, mét verwijzing naar controlemethode.
- **`FALSE_POSITIVE`**: gemotiveerd onterecht gedetecteerd; niet automatisch op alle toekomstige, gewijzigde content toepassen.
- **`RESOLVED`**: eerdere bevinding niet meer aangetroffen **in een vergelijkbare en voldoende dekkende heraudit**, of handmatig opgelost gemarkeerd (reden bewaren).
- **`REGRESSED`**: eerder opgelost probleem opnieuw gedetecteerd.

**Niet gezien ≠ opgelost.** Wanneer een element niet in beeld kwam of door een blocker verborgen was, blijft zijn vorige status behouden of wordt `not_retested` vastgelegd.

### 5.6 Vergelijken van audits

- Vergelijk dezelfde origin/route, viewportklasse, scenario's en relevante engineversie.
- Toon `nieuw`, `bestaand`, `opgelost`, `regressie`, `niet opnieuw getest`.
- Bewaar ruwe metrics per event voldoende lang om gewijzigde detectieregels opnieuw te kunnen interpreteren, zonder video standaard op te slaan.
- Resultaten van verschillende engineversies blijven leesbaar; markeer gewijzigde validatielogica.
- Bij actieve blocker: onderscheid **ongefilterde bronmeting** en **meting met mitigatie actief**.

### 5.7 Online zichtbaarheid en rapportlinks (P0)

| Modus | Wie kan lezen? | Vindbaar in publieke index? | Beheer |
|---|---|---|---|
| `PRIVATE` | Alleen de ingelogde eigenaar in v1. | Nee. | Eigenaar kan later bewust delen of verwijderen. |
| `UNLISTED` | Iedereen met een actieve, onvoorspelbare deellink. | Nee; ook uitsluiten van sitemap, zoek-API en interne suggesties. | Eigenaar kan de link intrekken of vervangen. |
| `PUBLIC` | Iedereen, zonder account of extensie. | Ja; publieke sitepagina met rapporten en historiek. | Eigenaar kan publicatie intrekken; beheer kan een gemeld rapport tijdelijk verbergen. |

- Lokaal bewaarde audits hebben nog geen online zichtbaarheid; `PRIVATE` duidt op een bewust online opgeslagen rapport.
- Een link verwijst naar één vaste inhoudsversie met eigen auditdatum en publicatiedatum. Een nieuwe meting of inhoudelijke correctie krijgt een nieuwe versie; een zichtbare verwijzing kan oud en nieuw verbinden.
- Intrekken maakt de inhoud niet meer beschikbaar via de beheerde webpagina, API en exports en verwijdert haar uit zoekresultaten en caches. Een ingetrokken link toont een neutrale melding zonder rapportgegevens.
- Privé maken trekt bestaande deellinks in en verwijdert publieke toegang; de eigenaar behoudt toegang via het account. Een moderatieblokkering kan niet door de auteur worden opgeheven door de zichtbaarheid te wijzigen.
- `UNLISTED` is delen op basis van bezit van de link: ontvangers kunnen die doorsturen. Gebruik deze modus niet als vervanging voor privétoegang. `noindex` is aanvullend gedrag voor crawlers, geen toegangscontrole.
- Eerder gedownloade of extern gekopieerde rapporten kunnen niet op afstand worden teruggehaald. De UI benoemt dat bij publiceren en intrekken.
- Lokaal wissen, online verwijderen en alleen een deellink intrekken zijn afzonderlijke acties met een duidelijk effect.

Dit intrekkingsbeleid geldt voor auditrapporten. De publieke CDN-regelindex uit §20 is een afzonderlijke, minimale distributie van expliciet vrijgegeven regels, zonder privérapporten of deellinks. Offline kopieën van die regels kunnen niet onmiddellijk worden ingetrokken; de voorwaarden voor opname in die feed maken dat vooraf duidelijk.

### 5.8 Herkomst, actualiteit en meerdere bijdragers

- Ieder online rapport vermeldt de aangeleverde meetdatum, door de server vastgelegde uploadtijd, publicerende accountnaam, engine-/regelversie en beoordelingsmethode. Openbare profielen tonen geen e-mailadres als standaardnaam.
- Een ingelogde publicerende gebruiker is niet automatisch eigenaar van de geaudite website. Een upload, account of inhoudshash bewijst evenmin dat de meting correct is uitgevoerd. De MVP toont **aangeleverd door gebruiker**; onafhankelijke verificatie moet afzonderlijk aantoonbaar zijn.
- Rapporten van verschillende bijdragers blijven afzonderlijke bronnen. De ene bijdrager kan andermans bevinding niet oplossen, verwijderen of inhoudelijk wijzigen. Globale deduplicatie van issues over bijdragers heen valt buiten P0.
- Publieke sitepagina's tonen datum, scope en herkomst per rapport. De meest recente scan van één route vervangt geen eerdere bevinding op een andere route. Tegenstrijdige resultaten blijven zichtbaar met hun context.
- De publieke site-indicatie gebruikt alleen toegankelijke, vergelijkbare gepubliceerde metingen en benoemt onvolledige dekking. Geen wereldwijde veiligheidsscore of automatische claim over de actuele hele site.
- P0 bevat een meldknop en een beperkt beheerscherm voor onjuiste inhoud, spam of gevoelige gegevens. Moderatie kan zichtbaarheid beperken, met reden en log; ze herschrijft geen meetgegevens en bevestigt geen WCAG-conformiteit.

---

## 6. Datamodel en opslag

### 6.1 Opslagkeuze

- **IndexedDB** in de extensie-origin voor lokale audits, historiek en een duurzame uploadwachtrij, bij voorkeur via **Dexie**.
- **`chrome.storage.local`** voor kleine extensie-instellingen en migratiemetagegevens.
- **`chrome.storage.session`** alleen voor vluchtige flags, actieve capturestatus en tijdelijke communicatie waar passend.
- **Centrale database:** Cloudflare D1 als voorkeursstartpunt voor accounts, online rapportversies, toegangsrechten en publieke indexmetadata. Gebruik een SQLite-compatibel schema en een expliciete storage-adapter; PostgreSQL is alleen een latere migratieoptie bij aantoonbare noodzaak.
- **Backend/API** voor aanmelden, uploadvalidatie, publiceren, lezen, intrekken en verwijderen. De extensie heeft nooit rechtstreeks database- of beheercredentials.
- **Account vereist voor online bewaren en beheer**; lokaal auditen en publiek/via-link lezen blijft zonder account mogelijk.
- Geen opslag van volledige videoframes als standaardgedrag.
- Geen essentiële sessiestatus uitsluitend in service-workergeheugen: Manifest V3-workers kunnen worden beëindigd.
- Sla online compacte geselecteerde snapshots op, geen kopie van alle lokale frame-events. Gebruik geïndexeerde metadata voor zoeken en vaste snapshots voor rapportdetails; limieten en kostenmodel staan in §17.
- Een aparte publieke objectopslag bevat alleen ondertekende feedreleases. De gehoste API/database zijn nodig om een nieuwe release te maken, niet om een al uitgegeven JSON-release te lezen of lokaal te gebruiken.
- De blocker bewaart actieve en vorige geverifieerde versies, lokale uitzonderingen en bekende ingetrokken regel-ID's persistent in de extensie. De HTTP-cache en vluchtige service-workerstatus zijn geen bron voor offline bescherming.

De lokale opslag is de bron voor de uitgevoerde audit. De server is de bron voor geaccepteerde online snapshots, eigenaarschap, zichtbaarheid en ingetrokken links. Een rapport wordt alleen als online bewaard getoond na serverbevestiging; lokale wijzigingen wijzigen een bestaande publicatie niet automatisch.

### 6.2 Voorgestelde entiteiten

| Entiteit | Primair doel | Belangrijkste velden |
|---|---|---|
| `Site` | Origin groeperen | `id`, `origin`, `registrableDomain?`, `createdAt`, `lastSeenAt` |
| `Page` | Route binnen een site | `id`, `siteId`, `normalizedRoute`, `title?`, `firstSeenAt` |
| `ScanJob` | Eén autonome opdracht | `id`, `siteId`, `startUrl`, `scope`, `budgets`, `state`, `stopReason`, `runnerVersion`, `policyVersion`, `checkpoint` |
| `ScanTask` | Ontdekte route en scenario | `id`, `jobId`, `pageId`, `discoveredFrom`, `scenario`, `state`, `attempts`, `skipReason?` |
| `ActionRecord` | Uitgevoerde of overgeslagen inspectiehandeling | `id`, `taskId`, `actionType`, `targetHint`, `outcome`, `reason?`, `startedAt`, `endedAt` |
| `AuditSession` | Eén meetpoging binnen job of expertmeting | `id`, `jobId?`, `taskId?`, `siteId`, `startedAt`, `endedAt?`, `mode`, `engineVersion`, `state`, `mitigationState` |
| `AuditSegment` | Route/scenario binnen scan | `id`, `sessionId`, `pageId`, `scenario`, `startedAt`, `endedAt`, `captureQuality` |
| `Observation` | Meetdata in tijd | `id`, `segmentId`, `type`, `startMs`, `endMs`, `measurement` |
| `Finding` | Overkoepelend probleem | `id`, `siteId`, `pageId?`, `fingerprint`, `type`, `reviewStatus`, `firstSeenAt`, `lastSeenAt` |
| `FindingOccurrence` | Bevinding in specifieke scan | `id`, `findingId`, `sessionId`, `segmentId`, `observationId`, `metrics` |
| `ElementTarget` | Bron/fingerprint | `id`, `siteId`, `framePath?`, `selector?`, `mediaHint?`, `confidence` |
| `BlockRule` | Toekomstige mitigatie | `id`, `siteId`, `scope`, `targetFingerprint`, `action`, `enabled`, `sourceFindingId` |
| `SiteSnapshot` | Herberekenbare samenvatting | `siteId`, `calculatedAt`, `status`, `coverage`, `counters` |
| `UserSetting` | Configuratie | `key`, `value` |
| `Account` | Eigenaar van online rapporten | `id`, `displayName`, `createdAt` |
| `ReportSnapshot` | Onveranderlijke, geselecteerde rapportinhoud | `id`, `ownerId`, `sourceJobId?`, `sourceAuditIds`, `schemaVersion`, `contentHash`, `payload`, `createdAt` |
| `Publication` | Toegang en zichtbaarheid van een snapshot | `id`, `snapshotId`, `ownerId`, `visibility`, `state`, `revision`, `publishedAt?`, `revokedAt?` |
| `ShareLink` | Intrekbare toegang tot een via-link-rapport | `id`, `publicationId`, `tokenHash`, `createdAt`, `revokedAt?` |
| `UploadJob` | Lokale, hervatbare upload van een gecontroleerde snapshot | `id`, `accountId`, `snapshotId`, `idempotencyKey`, `state`, `attempts`, `lastError?` |
| `ModerationReport` | Melding over een publicatie | `id`, `publicationId`, `reason`, `state`, `createdAt`, `resolvedAt?` |
| `FeedRelease` | Ondertekende publieke distributieversie | `channel`, `sequence`, `schemaVersion`, `generatedAt`, `expiresAt`, `files`, `revokedRuleIds`, `signatures` |
| `RuleFeedState` | Lokale vertrouwde updaterstatus | `channel`, `activeSequence`, `highestAcceptedSequence`, `activeDigest`, `previousDigest?`, `lastCheckedAt`, `status` |
| `LocalRuleOverride` | Gebruikerskeuze en bekende intrekking | `ruleId`, `disabled`, `sourceEnabled`, `revokedAtSequence?` |

De bestaande `Site`-, `Page`- en `Finding`-sleutels zijn lokaal uniek. Online opslag is per eigenaar afgeschermd; alleen expliciet publieke snapshots voeden een aparte publieke siteweergave. Een `ReportSnapshot.payload` gebruikt een beperkt, versieerbaar publicatieschema en is geen dump van alle lokale tabellen. Een websitescan bundelt meerdere meetpogingen in één rapport, inclusief jobstatus, dekking en stopreden. `BlockRule`, privénotities en ruwe frames worden niet automatisch meegenomen.

### 6.3 TypeScript-contracten (richtinggevend)

```ts
export type AuditStatus =
  | 'NOT_TESTED'
  | 'IN_PROGRESS'
  | 'NO_ISSUES_OBSERVED'
  | 'NEEDS_REVIEW'
  | 'NON_CONFORMANT'
  | 'INCONCLUSIVE'
  | 'ERROR';

export type FindingType =
  | 'GENERAL_FLASH'
  | 'RED_FLASH'
  | 'ANIMATION_CONTROL'
  | 'MOTION_FROM_INTERACTION';

export type ReviewStatus =
  | 'NEW_CANDIDATE'
  | 'NEEDS_REVIEW'
  | 'CONFIRMED'
  | 'FALSE_POSITIVE'
  | 'RESOLVED'
  | 'REGRESSED';

export type MitigationState = 'OFF' | 'ON' | 'PARTIAL' | 'UNKNOWN';

export interface ScanJob {
  id: string;
  siteId: string;
  startUrl: string; // genormaliseerd; geen geheime parameters
  scope: { allowedOrigins: string[]; maxDepth: number };
  budgets: { maxRoutes: number; maxDurationMs: number; maxActionsPerRoute: number };
  state: 'READY' | 'AUTHORIZING' | 'RUNNING' | 'PAUSED'
    | 'FINALIZING' | 'COMPLETED' | 'PARTIAL' | 'INTERRUPTED' | 'ERROR';
  stopReason?: 'QUEUE_EXHAUSTED' | 'BUDGET_REACHED' | 'USER_STOP'
    | 'PERMISSION_REVOKED' | 'CAPTURE_LOST' | 'BROWSER_CLOSED' | 'FATAL_ERROR';
  runnerVersion: string;
  policyVersion: string;
  startedAt?: string;
  endedAt?: string;
}

export interface ScanTask {
  id: string;
  jobId: string;
  pageId: string;
  discoveredFrom: 'START_URL' | 'LINK' | 'SPA' | 'SITEMAP' | 'IMPORT';
  scenario: string;
  state: 'QUEUED' | 'RUNNING' | 'OBSERVED' | 'PARTIAL' | 'SKIPPED' | 'ERROR';
  attempts: number;
  skipReason?: string;
}

export type ReportVisibility = 'PRIVATE' | 'UNLISTED' | 'PUBLIC';

export interface Publication {
  id: string;
  snapshotId: string;
  ownerId: string; // server bepaalt dit vanuit de geauthenticeerde gebruiker
  visibility: ReportVisibility;
  state: 'ACTIVE' | 'REVOKED' | 'HIDDEN_BY_MODERATION';
  revision: number; // voorkomt overschrijven door verouderde opdrachten
  publishedAt?: string;
  revokedAt?: string;
}

export interface UploadJob {
  id: string;
  accountId: string;
  snapshotId: string;
  contentHash: string;
  idempotencyKey: string;
  requestedVisibility: ReportVisibility;
  state: 'QUEUED' | 'UPLOADING' | 'SYNCED' | 'FAILED' | 'CANCELLED';
  attempts: number;
  lastError?: string;
}

export interface Site {
  id: string;
  origin: string;
  registrableDomain?: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface Page {
  id: string;
  siteId: string;
  normalizedRoute: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface AuditSession {
  id: string;
  jobId?: string;
  taskId?: string;
  siteId: string;
  mode: 'AUTONOMOUS' | 'QUICK' | 'EXTENDED' | 'INTERACTIVE';
  startedAt: string;
  endedAt?: string;
  engineVersion: string;
  rulesetVersion: string;
  state: 'RUNNING' | 'COMPLETED' | 'INTERRUPTED' | 'ERROR';
  mitigationState: MitigationState;
  declaredScope?: string;
}

export interface CaptureQuality {
  requestedFps?: number;
  measuredFpsAverage: number;
  measuredFpsMinimum?: number;
  receivedFrameCount: number;
  estimatedDroppedFrames?: number;
  largestGapMs: number;
  width: number;
  height: number;
  pixelFormat?: string;
  colorSpace?: string;
  hdrAssessment: 'SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN';
  grade: 'HIGH' | 'PARTIAL' | 'INSUFFICIENT';
  limitations: string[];
}

export interface AuditSegment {
  id: string;
  sessionId: string;
  pageId: string;
  scenario: string;
  startedAt: string;
  endedAt?: string;
  captureQuality: CaptureQuality;
  result: AuditStatus;
  passed: boolean | null;
}

export interface Finding {
  id: string;
  siteId: string;
  pageId?: string;
  fingerprint: string;
  fingerprintVersion: number;
  type: FindingType;
  reviewStatus: ReviewStatus;
  severity: 'INFO' | 'WARNING' | 'HIGH';
  firstSeenAt: string;
  lastSeenAt: string;
  lastVerifiedAt?: string;
  sourceElementId?: string;
  reviewerNote?: string;
}

export interface FlashMetrics {
  startMs: number;
  endMs: number;
  flashesPerRollingSecond: number;
  luminanceDeltaMax?: number;
  saturatedRedDetected?: boolean;
  cieUcsDelta?: number;
  concurrentAreaCssPx2?: number;
  visualFieldEstimate?: string;
  boundingBoxCapturePx?: { x: number; y: number; width: number; height: number };
  detectionConfidence: number;
  calculationVersion: string;
}

export interface BlockRule {
  id: string;
  siteId: string;
  scope: { origin: string; normalizedRoutePattern?: string };
  targetFingerprint: string;
  sourceFindingId: string;
  action: 'PAUSE_ANIMATION' | 'PAUSE_MEDIA' | 'HIDE_ELEMENT';
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  userApproved: boolean;
}
```

**Opmerking:** productie-interfaces worden uitgebreider en gevalideerd met runtime-schema's (bijvoorbeeld Zod). De relevante indexes, relaties, migraties en versiebeheer behoren tot de implementatie.

### 6.4 Voorbeeld van een site-indexrecord

```json
{
  "schemaVersion": 1,
  "site": {
    "id": "site_demo_01",
    "origin": "https://voorbeeld.be",
    "createdAt": "2026-10-20T11:20:00Z"
  },
  "summary": {
    "status": "NEEDS_REVIEW",
    "passed": null,
    "knownRoutes": 8,
    "testedRoutes": 3,
    "auditsCompleted": 7,
    "uniqueOpenCandidates": 2,
    "confirmedOpenIssues": 0,
    "resolvedIssues": 1,
    "activeBlockRules": 0,
    "lastAuditAt": "2026-10-26T18:30:00Z"
  },
  "coverage": {
    "scope": "3 geobserveerde routes",
    "routesCovered": 3,
    "routesKnown": 8,
    "scenarios": ["initial-load", "video-play"],
    "incompleteReasons": ["5 bekende routes niet geauditeerd"]
  }
}
```

**Dit is een fictief voorbeeld.** De geaggregeerde site-samenvatting is bij voorkeur een cache die opnieuw uit de onderliggende sessies en bevindingen opgebouwd kan worden.

### 6.5 Database-indexen

Minimaal de volgende lokale querypaden ondersteunen:

- `sites`: unieke index op `origin`.
- `pages`: unieke samengestelde index op `[siteId + normalizedRoute]`.
- `scanJobs`: index op `[siteId + startedAt]` en `state`.
- `scanTasks`: unieke index op `[jobId + pageId + scenario]`, index op `[jobId + state]`; herhalingen zijn expliciete pogingen op dezelfde taak.
- `actionRecords`: index op `[taskId + startedAt]`; geen volledige DOM-tekst of formulierwaarden opslaan.
- `sessions`: index op `[siteId + startedAt]` en `state`.
- `segments`: index op `[sessionId + pageId]` en `scenario`.
- `findings`: index op `[siteId + reviewStatus]` en unieke `[siteId + fingerprint]` waar de fingerprint stabiel genoeg is.
- `occurrences`: index op `[findingId + sessionId]` en `segmentId`.
- `blockRules`: index op `[siteId + enabled]` en `[sourceFindingId]`.
- `siteSnapshots`: unieke index op `siteId`; inhoud herberekenbaar.

Online aanvullend: alle eigenaargebonden queries filteren op `ownerId`, unieke idempotentiesleutels per account, rapporten per `[ownerId + createdAt]`, publicaties per `[visibility + state + publishedAt]`, unieke hashsleutels voor deellinks en meldingen per `[state + createdAt]`. Publieke zoekresultaten en rollups worden uitsluitend uit actieve `PUBLIC`-publicaties opgebouwd; een zoekindex is geen alternatieve toegangsroute tot privédata.

### 6.6 Bewaarbeleid

- Sites, pagina-index en compacte auditresultaten: behouden tot de gebruiker ze verwijdert.
- Meetdetail/events: instelbaar, bijvoorbeeld standaard **90 dagen**.
- Ruwe pixels/video: standaard **niet opslaan**.
- Beeldbewijs: uitsluitend na expliciete gebruikerskeuze; bij voorkeur gecropte, statische beelden en zonder automatische playback.
- Website wissen, volledige lokale historiek wissen en alle lokale data exporteren moeten beschikbaar zijn.
- Online rapporten verwijderen, links intrekken en accountgegevens exporteren/verwijderen zijn afzonderlijk beschikbaar. Lokaal wissen verwijdert geen online publicatie tenzij de gebruiker die actie ook kiest.
- Online rapportgegevens blijven bewaard tot verwijdering; intrekken beëindigt gedeelde toegang en is geen verwijdering van de onderliggende snapshot. De productrelease beschrijft een concrete bewaartermijn voor operationele logs en backups, met een herstelprocedure die verwijderde publicaties niet opnieuw toegankelijk maakt.
- Databaseversie en migraties expliciet beheren; geen stil gegevensverlies bij updates.
- Incognito: standaard uit; indien apart ingeschakeld **geen geschiedenis uit incognito persistent mengen** met de normale profielindex.
- Jobs, frontier/wachtrij en voltooide taken persistent bewaren zodat een workerherstart de voortgang niet verliest. Na browserherstart is capturetoestemming niet verondersteld; verdergaan vereist een geldige hervatflow.

### 6.7 Uploads, versies en herstel (P0)

- De uploadwachtrij bevat uitsluitend door de gebruiker goedgekeurde snapshots. De gecontroleerde inhoud, zichtbaarheid en account worden aan de opdracht gebonden; gewijzigde inhoud vereist een nieuwe preview.
- Uploads gebruiken een idempotentiesleutel en inhoudshash. De backend valideert het publicatieschema en berekent de hash opnieuw; dezelfde opdracht opnieuw versturen maakt geen dubbele publicatie. De hash bewaakt inhoudsintegriteit, geen meetwaarheid.
- De snapshot, publicatie en opdrachtstatus worden server-side atomair vastgelegd. Bij netwerkuitval blijft de lokale audit beschikbaar; een retry vraagt de status van dezelfde opdracht op of herhaalt haar idempotent.
- Uitloggen of wisselen van account pauzeert open opdrachten; die mogen niet onder een ander account verdergaan. De gebruiker kan een nog niet uitgevoerde opdracht annuleren.
- Wijzigingen in zichtbaarheid en intrekkingen controleren de actuele `revision`. Een verouderde upload/retry mag een ingetrokken publicatie of verwijderde snapshot niet herstellen; gebruik tombstones of een gelijkwaardige server-side blokkering.
- De webinterface blijft de beheerroute als de extensie niet beschikbaar is. Publicatiebeheer en een lokale audit zijn onafhankelijk van elkaar.

---

## 7. Architectuur en technologie

### 7.1 Voorkeursstack

| Laag | Keuze | Reden |
|---|---|---|
| Browser | Chrome, Manifest V3 | Toolbar-interface, optionele DevTools-interface en capture-API's. |
| Frontend extensie | React + TypeScript | Gewone popup/voortgangsinterface en technisch DevTools-dashboard. |
| Webportaal | Astro + TypeScript, `@astrojs/react` voor gerichte islands | HTML als basis, interactie per component; rendering- en prestatiebeleid in §21. |
| Backend/API | Astro-serverroutes met TypeScript op Cloudflare Workers via `@astrojs/cloudflare` | Eén kleine web/API-deploy voor publicatie, autorisatie en actuele rapporten. |
| Online database | Cloudflare D1 met SQLite-schema (voorkeursstartpunt) | Compacte rapporten, eigenaarschap en geïndexeerde queries; lokaal te ontwikkelen. |
| Accountbeheer | Bestaande onderhouden auth-library/provider met kostentoets vóór keuze | Web- en extensiesessies; gewone gebruikers mogen geen GitHub-account nodig hebben om te scannen. |
| Antispam | Cloudflare Turnstile + Workers-requestlimieten + atomaire accountquota | Schrijf- en authflows beschermen zonder scans of regeldistributie afhankelijk te maken van challenges; §9.5. |
| Hosting | productieaccount, Workers Static Assets + API + D1 | Weinig componenten en lage vaste kosten; begroting in §17. |
| Publieke JSON-distributie | Aparte R2-bucket met eigen CDN-hostnaam (voorkeur) | Statische regelreleases zonder Worker-/D1-call per download. |
| Offline regels | Ingebouwde basisset + geverifieerde lokale opslag | Blocker blijft functioneren met bekende regels wanneer distributie onbereikbaar is. |
| Repository en CI | Publieke GitHub-organisatierepository via de projectrepository | Community-PR's, beschermde main-branch en GitHub Actions. |
| Build tooling | Astro voor web; Vite + extension-buildconfiguratie voor Chrome | Afzonderlijke builds met gedeelde TypeScript-domeinmodules. |
| Webvormgeving | Eigen epi-less-tokens, Astro-layouts en scoped CSS | Compacte applicatienavigatie, tabellen en formulieren zonder marketingcompositie of zware animatieruntime; een bescheiden makercredit op de projectpagina. |
| Uitvoering | Chrome service worker + offscreen document | Messaging, capturelevenscyclus, media-API's. |
| Scanorkestratie | Duurzame jobwachtrij + lokale browseradapter | Zelfstandig navigeren, scenario's uitvoeren en hervatten. |
| Route-/actieplanner | Deterministische TypeScript-module met expliciete policies | Begrensde routeverkenning en reproduceerbare keuzes. |
| Frameverwerking | Web Workers + OffscreenCanvas waar ondersteund | Scherminterface ontlasten. |
| Detectielogica | Framework-onafhankelijke TypeScript-library | Testbaar en herbruikbaar. |
| Lokale opslag | IndexedDB + Dexie | Auditgeschiedenis, offline gebruik en uploadwachtrij. |
| Kleine settings | `chrome.storage.local` | Extensie-instellingen. |
| Schema-validatie | Zod of gelijkwaardig | Vertrouwde data- en berichtcontracten. |
| Unit/integratietests | Vitest | Deterministische analysescenario's. |
| Browsertests | Playwright + echte Chrome-testfixtures | Werkelijke capture-, permissie- en UI-tests. |

### 7.2 Componentdiagram

```text
Gewone extensie (popup + voortgang) ──┐
                                     │
Optioneel epi-less DevTools-paneel ─┤
                                     │ dezelfde jobcommando's
               ┌─────────────────────┘ via chrome.runtime messaging
               ▼
┌──────────────────────────────┐
│ MV3 Extension Service Worker│◄────────────── Chrome Action
│ - scanrunner / jobplanning  │              (start + autorisatie)
│ - tab-/origin-autorisatie   │
│ - routes / budgets / policy│
│ - checkpoint / statusherstel│
└──────────────┬───────────────┘
               │
        ┌──────┴───────────────────┐
        ▼                          ▼
┌──────────────────────┐  ┌─────────────────────────┐
│ Offscreen Document   │  │ Content Scripts         │
│ - tab MediaStream    │  │ - links / routecontext  │
│ - frame extractie    │  │ - scroll / UI-acties    │
│ - worker aansturen   │  │ - media / DOM-attributie│
└──────────┬───────────┘  └───────────┬─────────────┘
           │                          │
           ▼                          │
┌──────────────────────┐              │
│ Analysis Worker      │              │
│ - luminantie/rood    │              │
│ - tijdvensters       │              │
│ - WCAG-kandidaten    │              │
└──────────┬───────────┘              │
           └────────────┬─────────────┘
                        ▼
             ┌───────────────────────┐
             │ IndexedDB             │
             │ sites / pages / runs  │
             │ findings / rules      │
             │ jobs / tasks / acties │
             └───────────────────────┘
                        │ geselecteerde rapportsnapshot
                        ▼
             ┌───────────────────────┐
             │ Deelpreview + outbox  │
             └───────────┬───────────┘
                         │ HTTPS + account
                         ▼
             ┌───────────────────────┐
             │ Backend / API         │◄──── Webportaal
             │ auth / publicatie     │      - publieke index
             │ toegang / intrekken   │      - rapportlinks
             └───────────┬───────────┘      - eigen rapporten
                         ▼
             ┌───────────────────────┐
             │ D1 / SQLite-schema    │
             │ snapshots / accounts  │
             │ publicaties / links   │
             └───────────────────────┘

Gecontroleerde publieke regels → release-export + ondertekening
                                         │
                                         ▼
                              R2 / statische CDN-feed
                                         │ achtergrondupdate
                                         ▼
Ingebouwde basisset ─────────► Lokale geverifieerde regelset
                                         │ geen netwerk vereist
                                         ▼
                                Blocker op de website (P2)
```

### 7.3 Technische aandachtspunten bij starten en autonome capture

De gewone extensie-interface en DevTools sturen dezelfde scanrunner aan. De popup is geen uitvoeringscontext voor een langdurige scan; service worker, offscreen document, analyseworker en geïnstrumenteerde scantab hebben afzonderlijke verantwoordelijkheden.

- Chrome vereist een gebruikersaanroep van de extensie voor `tabCapture`; `targetTabId` vereist de bijbehorende `activeTab`-toegang. Vanaf Chrome 116 kan een service-worker-stream-ID in een offscreen document worden gebruikt. De documentatie beschrijft behoud van capture over navigaties binnen dezelfde tab. [Chrome tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture/)
- `activeTab`-toegang blijft bij navigatie binnen dezelfde origin behouden; een andere origin beëindigt die tijdelijke toegang. DOM-instrumentatie via `scripting` vereist hosttoegang of `activeTab`. [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- **PoC-vereiste:** bewijs één geldige toolbar-start en daarna meerdere volledige navigaties en SPA-overgangen zonder een nieuwe toestemming per route. Capturecontinuïteit, DOM-herkoppeling en framekwaliteit worden afzonderlijk gemeten.
- De scan gebruikt een expliciet aangewezen scantab. Onderzoek een aparte tab die tijdens de start geldig geautoriseerd wordt; opening van een tab alleen bewijst geen capturetoegang. Ook de keuze om de huidige tab te laten navigeren moet vóór de start helder zijn. Geen veronderstelde toegang tot andere tabbladen.
- DevTools bepaalt zijn doel via `chrome.devtools.inspectedWindow.tabId`; de gewone interface via de gekozen scantab. Een DevTools-start die geen geldige captureaanroep vormt krijgt dezelfde toolbar-startflow.
- Offscreen documenten hebben beperkte extension-API-toegang; regel captureautorisatie en andere Chrome-API's via de juiste context.
- Capture en DOM-inspectie werken op verschillende coördinaten/tijdslijnen; synchroniseer met timestamps, viewportgegevens en `devicePixelRatio`.
- Sommige browserpagina's (`chrome://...`, Chrome Web Store of andere beschermde contexten) zijn niet inspecteerbaar/injecteerbaar zoals gewone websites; toon `UNSUPPORTED`/`INCONCLUSIVE` in plaats van een pass.
- **Geen vereiste om mee te kijken:** valideer bruikbare frames terwijl de gebruiker het rustige voortgangsscherm bekijkt. Test achtergrondtab, vensterwissel, minimaliseren, slaapstand en gesloten popup apart. Een volledig gepauzeerde renderer of slechte sampling kan geen geldige meting opleveren.
- Een overlay, vervangende afbeelding of CSS die de onderzochte content in de scantab verbergt, verandert de meting en is geen oplossing om ongewijzigde content te analyseren. Laat geen live flitsbeelden in de voortgangsinterface zien.
- De gewone scan mag niet vereisen dat de gebruiker zelf routes doorloopt, media start of de scantab actief houdt voor elke stap. Als de gekozen lokale capturecontext dit niet betrouwbaar ondersteunt, is de autonome flow nog niet gereed en moet de uitvoeringsarchitectuur vóór release worden herzien. Verborgen rendering zonder kwaliteitsverlies is een te bewijzen eis, geen aangenomen Chrome-capaciteit.

**De eerste ontwikkeltaak is een werkende PoC met DevTools gesloten:** starten → routes ontdekken → meerdere pagina's en UI-toestanden autonoom onderzoeken → meetkwaliteit controleren → eindrapport maken. Het automatisch laden van HTML of maken van losse screenshots bewijst geen tijdgebonden flitsmeting.

### 7.4 Communicatie en events

Berichten krijgen een getypeerde envelope met uniek `requestId` en `messageVersion`, en de relevante `jobId`, `taskId` of `sessionId`. Onderstaande voorbeelden tonen de domeinpayloads:

```ts
type ExtensionMessage =
  | { type: 'SITE_SCAN_START_REQUEST'; requestId: string; tabId: number }
  | { type: 'SITE_SCAN_PROGRESS'; jobId: string; discovered: number; measured: number; skipped: number }
  | { type: 'SITE_SCAN_PAUSE_REQUEST'; jobId: string }
  | { type: 'SITE_SCAN_STOP_REQUEST'; jobId: string }
  | { type: 'SITE_SCAN_FINISHED'; jobId: string; state: ScanJob['state']; stopReason: ScanJob['stopReason'] }
  | { type: 'AUDIT_START_REQUEST'; requestId: string; tabId: number; mode: string }
  | { type: 'AUDIT_START_AUTH_REQUIRED'; requestId: string; tabId: number }
  | { type: 'AUDIT_STARTED'; sessionId: string; tabId: number }
  | { type: 'AUDIT_PROGRESS'; sessionId: string; elapsedMs: number; fps: number }
  | { type: 'AUDIT_FINDING'; sessionId: string; findingId: string }
  | { type: 'AUDIT_STOP_REQUEST'; sessionId: string }
  | { type: 'AUDIT_FINISHED'; sessionId: string; status: AuditStatus }
  | { type: 'AUDIT_ERROR'; sessionId?: string; code: string; message: string };
```

- Geen onbeveiligde `window.postMessage`-trust tussen website en extensie zonder strenge validatie.
- Verifieer bij berichten origin/context, tabId en toegang; vertrouw nooit blind op velden die vanuit de website kunnen komen.
- Herhaalde berichten mogen niet leiden tot dubbele sessies of dubbele bevindingen.
- Bij crash of workerherstart blijven job en laatst opgeslagen meetsegment identificeerbaar. Een onvolledig meetsegment krijgt `INTERRUPTED`; de runner hervat alleen met geldige capture en reconstrueerbare browsercontext.

### 7.5 Prestatie-eisen

- De extensie moet interactief blijven tijdens frameanalyse.
- Ruwe frames niet langdurig opstapelen in geheugen; gebruik begrensde ringbuffers.
- Performancebeleid voor 1080p/1440p/4K met expliciete detectie van overbelasting.
- Indien nodig een analyseprofiel `BALANCED` of `HIGH_ACCURACY`, maar resolutiereductie of frame-dropping moet de kwaliteitsstatus beïnvloeden.
- CPU/GPU/memoryverbruik tijdens een test vastleggen voor ontwikkeltelemetrie **lokaal**, geen automatische verzending.
- Geen garantie claimen op hoge-flitsfrequentiedetectie als de effectieve sampling daarvoor onvoldoende is.
- Voor de website gelden afzonderlijke browser-, asset- en renderingbudgetten uit §21.5; snelle lokale frameanalyse bewijst geen snelle webindex.

### 7.6 Webplatform en API (P0)

De backend verwerkt rapportgegevens; pixelanalyse blijft in de extensie. Astro verzorgt pagina's en serverroutes; gedeelde servermodules voeren validatie en toegangscontrole uit. SSR roept die modules rechtstreeks aan zonder extra HTTP-aanroep naar de eigen API. De eerste versie heeft deze routes en handelingen nodig (exacte URL-namen zijn richtinggevend):

| Oppervlak | Functie | Toegang |
|---|---|---|
| `/sites` en `/sites/:siteId` | Zoeken en publieke sitehistoriek bekijken. | Anoniem, uitsluitend actieve publieke publicaties. |
| `/reports/:publicationId` | Een vaste rapportversie bekijken. | Publiek anoniem; privé alleen eigenaar; unlisted alleen met actieve deellink. |
| `/share/:token` | Een via-link-rapport openen. | Actieve deellink; geen publieke listing of inhoudelijke externe preview. |
| `/account/reports` | Eigen rapporten en zichtbaarheid beheren. | Ingelogde eigenaar. |
| API: upload/publiceer | Een gecontroleerde snapshot opslaan met zichtbaarheid. | Ingelogde gebruiker; server bepaalt eigenaar. |
| API: wijzig zichtbaarheid / trek in / verwijder | Toegang tot eigen rapport wijzigen. | Eigenaar, met actuele publicatierevisie. |
| API: melden / modereren | Een publicatie melden en meldingen behandelen. | Begrensde meldingen; beheeracties alleen voor bevoegde beheerders. |

- Paginering en begrensde zoekqueries; publieke zoekfilters gebruiken dezelfde toegangsregels als rapportpagina's en exports.
- Elke leestoegang controleert publicatiestatus en zichtbaarheid. Een unlisted rapport mag niet alsnog via een kale rapport-ID worden opgevraagd.
- Online aggregaties worden opnieuw berekend bij publiceren, intrekken, verbergen en verwijderen. Verouderde caches mogen ingetrokken inhoud niet blijven tonen.
- Webhosting, API en database maken deel uit van de eerste productrelease. Een werkende extensie zonder bereikbaar deelrapport voldoet niet aan P0.
- Releasecontrole: vanuit een echte extensie een rapport publiceren, de link in een aparte browser zonder login/extensie openen, de publieke index controleren en intrekking opnieuw via pagina én API verifiëren.

### 7.7 Duurzame autonome runner (P0)

- De planner beslist welke route en welk ondersteund scenario volgt. Een browseradapter voert navigatie/acties uit; de capturemanager levert meetsegmenten; de rapportbouwer maakt zelfstandig de einduitkomst.
- Sla wachtrij, budgetverbruik, bezochte routes, actie-uitkomsten en checkpoints transactioneel in IndexedDB op. Geen essentiële voortgang uitsluitend in popup- of service-workergeheugen.
- Eén actieve joblease per scancontext voorkomt dat twee interfaces of herstartende workers tegelijk navigeren. Verouderde opdrachten worden genegeerd; een stopintentie wordt persistent gemaakt vóór verdere acties.
- Navigatie, wachten op render, scrollen, interactie, mediaobservatie en analyse hebben afzonderlijke timeouts. Een site die nooit `network idle` bereikt mag de job niet eindeloos blokkeren.
- Leg vóór een actie de intentie vast en erna de waargenomen uitkomst. Na een crash niet blind een mogelijk reeds uitgevoerde actie herhalen; herbegin waar mogelijk vanuit een bekende inspectietoestand of markeer de stap gedeeltelijk.
- Toestemmingsverlies, tabsluiting en browserherstart zijn herstelgrenzen. Voltooide taken blijven behouden; hervatten start nieuwe meetsegmenten en veronderstelt geen doorlopende opname over de onderbreking.
- Productkeuze voor v1: uitvoering lokaal zolang Chrome en de gevalideerde capturecontext beschikbaar zijn. De backend bewaart publicaties en neemt deze job niet stilzwijgend over. Doorgaan met een afgesloten browser zou een aparte remote runner vereisen en behoort niet tot deze lokale uitvoeringsbelofte.

---

## 8. Toekomstige blocker

### 8.1 Productvisie

De audit bouwt vanaf dag één de gegevens op die later kunnen helpen om specifieke risicovolle onderdelen van sites te herkennen en gericht te mitigeren. Publiek gedeelde bevindingen kunnen later als bron voor voorgestelde regels dienen; publicatie activeert nooit automatisch een blocker bij andere gebruikers. Toepassing blijft een afzonderlijke keuze met lokale controle van de bron en het doelelement.

Na het activeren van de blockerbron en de benodigde siterechten gebruikt de extensie lokaal aanwezige regels. De browser wacht bij paginanavigatie niet op de server of een CDN. Updates en matching zijn aparte processen; de uitval- en updateafspraken staan in §20.

**Twee gescheiden modules:**

1. **Auditor:** beoordeelt wat de website zonder ingreep laat zien.
2. **Blocker:** past door de gebruiker goedgekeurde mitigaties toe op herkende pagina's of elementen.

Een pagina die door de blocker aangepast wordt mag **niet automatisch een nieuwe `PASS` voor de oorspronkelijke website** krijgen. Er zijn aparte metingen mogelijk: `ORIGINAL` en `WITH_MITIGATION`.

### 8.2 Voorziene blokkeeracties

| Actie | Voorbeeld | Risico/beperking |
|---|---|---|
| `PAUSE_ANIMATION` | `animation-play-state: paused` / Web Animations API | Sommige animaties worden door JS opnieuw gestart of zijn onderdeel van de werking. |
| `PAUSE_MEDIA` | `<video>.pause()` | Werkt niet voor elk embedded of cross-origin medium. |
| `HIDE_ELEMENT` | Element verbergen of vervangen door statische placeholder | Kan content of functionaliteit onbereikbaar maken. |
| `REDUCE_MOTION` (later) | Bewegingsreductie per site | Niet alle websites respecteren het verzoek. |
| `SITE_LEVEL_COVER` (onderzoek) | Site voorlopig niet zichtbaar tonen | Kan captureanalyse en bruikbaarheid beïnvloeden; geen harde beschermingsgarantie. |

**Volgorde van voorkeur:** pauzeren → gebruikerskeuze/placeholder → verbergen. Bij iedere actie eenvoudige herstelmogelijkheid.

### 8.3 Regelsysteem

Een `BlockRule` bevat minimaal:

- Exacte `origin` en eventueel routepatroon.
- Doelelement via versieerbare fingerprint, selector en/of mediahint.
- Bronverwijzing naar eerdere `Finding`.
- Gewenste actie en reden.
- Beoordeling: handmatig bevestigd / kandidaat / onbekend.
- Ingeschakeld, uitgeschakeld of tijdelijk overruled.
- Laatst succesvol toegepast en fouten.
- Datum van aanmaak, aanpassing en optioneel vervaldatum.
- Voor gedistribueerde regels: stabiele `ruleId`, revisie, bronkanaal, compatibele engineversie en eventuele harde `notAfter`. Houd de technische geldigheid van een regel apart van de leeftijd van de feed.

### 8.4 Matching en fingerprints

**Niet uitsluitend vertrouwen op één CSS-selector**, omdat gegenereerde classnames en DOM-structuren vaak wijzigen.

Een fingerprint kan bestaan uit een gewogen combinatie van:

- Site + routepatroon.
- Elementtype, semantische rol en stabiele attributen.
- Selector met voorkeur voor expliciete IDs/`data-*`-attributen.
- Media-URL of gedeeltelijke resource-identiteit, voor zover privacyveilig.
- Relatieve DOM-structuur en iframepad.
- Geometrie als *secundair signaal*, nooit als enige identificatie.
- Detectietype (bijvoorbeeld rode flitsen) en eerder waargenomen context.

**Bij onzekere matching niet zomaar een willekeurig element verbergen.** Toon een kandidaat, vereis bevestiging of laat de regel inactief.

### 8.5 Blockermodi (P2)

- `OFF` — geen ingrepen.
- `MANUAL` — gebruiker kiest per bevinding een ingreep.
- `KNOWN_ONLY` — lokale regels uit individueel goedgekeurde regels of een expliciet ingeschakelde, vertrouwde feed toepassen op exact toegelaten sites, met lokale matchcontrole en uitzonderingen.
- `ASSISTED` (later) — nieuwe kandidaten signaleren en om toestemming vragen.

Een globale automatisch-blokkeer-stand **voor onbekende content** is geen standaardfeature. Nieuwe risicovolle beelden kunnen worden getoond vóór er voldoende frames zijn om ze te herkennen; realtime detectie alléén garandeert dus geen preventie.

### 8.6 Uitvoering van regels

- Gebruik waar mogelijk content scripts die bij `document_start` in toegelaten origins laden.
- De kritieke toepassingsroute leest uitsluitend lokaal beschikbare regeldata. Geen fetch, login, abonnement-/licentiecontrole of server-ACK vóór toepassing; koude start en workerherstart worden expliciet getest.
- Persistente regels moeten op relevante navigaties en SPA-routewisselingen worden nagekeken.
- Detecteer DOM-hertekening met een efficiënt en begrensd `MutationObserver`-mechanisme.
- Ondersteun meerdere targets, iframes en shadow DOM **alleen waar browserrechten en technische toegang dat toelaten**.
- Bewaar eerdere stijlen/status voor `Undo`, voor zover herstelbaar.
- Voorkom onnodige interventies in formulieren, kritieke bediening en toegankelijkheidscontrols; laat gebruiker ingrepen terugdraaien.
- De gebruiker kan voor elke site kiezen: uitschakelen, tijdelijke uitzondering, alle regels wissen.
- Lokale uitschakelingen en bekende intrekkingen blijven gelden na een update, rollback of terugval naar de ingebouwde basisset.
- Leg vast of blokkering werkelijk toegepast is; `rule.enabled = true` is niet voldoende bewijs dat het element effectief geblokkeerd werd.

### 8.7 Veiligheidswaarschuwing blocker

**Een browserextensie kan niet in alle situaties garanderen dat flitsende beelden voorkomen worden.** Denk aan browser-/GPU-rendering, niet-toegankelijke frames, netwerkveranderingen, vroeg getoonde frames, fullscreen, DRM, snelle canvasrendering en veranderende DOM's. Plaats de blocker daarom duidelijk in de categorie **best-effort risicobeperking**; geen medisch beschermingsmiddel of garantie.

---

## 9. Privacy, beveiliging en betrouwbaarheid

### 9.1 Privacyvereisten

- Lokale frameanalyse en lokale opslag van nieuwe audits; alleen een geselecteerde rapportsnapshot gaat na controle online.
- Lokaal auditen en publiek/via-link lezen zonder account; aanmelden voor online bewaren, publiceren en beheer.
- Geen analytics-/telemetry-endpoint tenzij een toekomstige expliciet opt-in feature.
- In P0 geen upload van ruwe frames, screenshots, video's of volledige browsergeschiedenis. Een rapport bevat geselecteerde routes, metingen, bevindingen, scope en beperkingen.
- Geen ruwe screenshots of volledige videoregistraties standaard bewaren.
- Zoekparameters, tokens, authcodes en gevoelige URL-gegevens standaard niet persistent opslaan.
- Exporteerbare en te uploaden rapporten tonen vooraf welke URL's, selectors, notities en eventuele lokale beeldgegevens ze bevatten; de online veldselectie sluit beelden in P0 uit.
- Auditinhoud kan persoonlijk of vertrouwelijk zijn; gebruiker kan lokale data en eigen online rapporten afzonderlijk wissen.
- Incognito standaard uitgesloten van permanente index; indien ondersteund isoleren en wissen na incognitosessie.
- Geen automatische melding of verzending aan de bezochte website. Een publiek rapport is wel voor iedereen leesbaar, inclusief de websitebeheerder.
- Autonome navigatie en media-afspeelverzoeken veroorzaken normale websiteverzoeken en kunnen bestaande inlogsessies gebruiken. Toon de gebruikte browsercontext bij de start; upload nooit sessiecookies, wachtwoorden of authheaders naar epi-less.
- Interne hosts, localhost en privé-IP-adressen komen niet in de publieke index; controleer dit bij publiceren. Voor andere gevoelige paden en inhoud blijven veldselectie en de gegevenspreview noodzakelijk.
- Privé- en via-link-rapporten krijgen geen inhoudelijke metadata voor sociale previews. Log geen toegangstokens of volledige deellinks; gebruik voor deelpagina's een restrictief referrerbeleid en geen externe trackers.
- De privacyuitleg vermeldt Cloudflare Turnstile als misbruikbescherming op betrokken formulieren. Geen rapportinhoud, bezochte URL's, e-mailadressen of deelcodes in widgetmetadata; operationele logging blijft beperkt volgens §9.5.

### 9.2 Browserrechten

- `devtools_page` voor het eigen DevTools-paneel.
- `tabCapture`, `offscreen`, `storage` en noodzakelijke permissies volgens daadwerkelijke implementatie.
- `activeTab`/eventuele aanvullende tab- en scriptingrechten uitsluitend waar nodig.
- Hostpermissies voor DOM-inspectie en blocker bij voorkeur **optioneel en per site** aanvragen.
- De autonome runner krijgt bij de start alleen toegang tot de afgesproken sitecontext. Nieuwe origins of benodigde browserbevestigingen worden niet onbeperkt tijdens de scan aangevraagd; buiten-scope-taken worden overgeslagen met reden.
- Alleen de noodzakelijke rechten voor de gekozen epi-less-API-origin en aanmeldflow toevoegen; geen algemene hosttoegang voor online delen.
- Geen permanente `<all_urls>`-toegang als dat met beperktere rechten kan worden opgelost.
- Geef in de UI een begrijpelijke reden vóór toestemming gevraagd wordt.

### 9.3 Security-eisen

- Strikt Manifest V3 met Content Security Policy; geen remote executable scripts.
- Valideer berichtpayloads en database-imports met runtime-schema's.
- Behandel CSS-selectors, URL's, elementtekst en pagina-inhoud als **onbetrouwbare input**.
- Geen `innerHTML` met ongesaniteerde data uit bezochte websites; exports correct escapen/sanitiseren.
- Geen `eval` van broncode van de bezochte website als algemene inspectiestrategie.
- Beveilig export/import tegen prototype-pollution, oversized payloads en invalid JSON.
- Beperk CPU/memory-gebruik en event-rate om de browser niet vast te laten lopen.
- Maak verwijdering van indexdata, uitzonderingen en blockerregels controleerbaar.
- Autorisatie op de server voor iedere lees-, schrijf-, export- en verwijderactie. Vertrouw `ownerId`, zichtbaarheid of een opgegeven rol uit de extensie nooit zonder controle.
- HTTPS voor de webapp/API; geen geheime serverkeys in de extensie of frontend. De gekozen auth-oplossing moet web- en extensiesessies ondersteunen, inclusief uitloggen en intrekken.
- Rate limits en payloadlimieten op uploads, zoeken, linkpogingen en meldingen. Deelcodes zijn cryptografisch willekeurig; bewaar alleen hun hash server-side.
- Turnstile wordt op beschermde acties altijd server-side gecontroleerd; een geslaagd widgetsignaal in de browser is geen toestemming om te publiceren. Zie §9.5 voor auth, tokenbinding, retries en uitval.
- Privé- en via-link-responses worden niet in gedeelde caches opgeslagen. Auditrapporten, zoekindexen en exports respecteren intrekking; rapportinhoud is niet rechtstreeks via openbare opslag-URL's bereikbaar. Alleen de afzonderlijk vrijgegeven, minimale regelindex uit §20 is statisch en publiek cachebaar.
- De feed bevat uitsluitend begrensde declaratieve gegevens en toegestane actie-enums. Geen JavaScript, WASM, willekeurige CSS-code of interpreteerbare programmalogica uit de CDN uitvoeren; alle uitvoeringslogica zit in de extensie. Chrome onderscheidt externe data van extern uitgevoerde code. [Chrome remote hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)
- Behandel ook geüploade rapporten als onbetrouwbare input: schema en bereik van meetwaarden controleren, tekst escapen, URL-schema's beperken en ononderbouwde `PASS`-/verificatieclaims niet automatisch als gevalideerd tonen.
- De backend haalt in P0 geen aangeleverde site- of media-URL's op. Linkpreviews gebruiken eigen statische assets; er is geen generieke URL-fetcher nodig.
- Moderatie verbergt publicaties via apart beheer met logging; auteurs kunnen hun rol of verificatielabel niet zelf verhogen.
- De actiepolicy van §2.5 wordt vóór elke autonome navigatie en interactie gecontroleerd. Website-inhoud is meetinput en mag de runner geen opdrachten geven om permissies, scope of transactieregels te wijzigen.

### 9.4 Meetbetrouwbaarheid

Aan ieder rapport toevoegen:

- Exacte extensie-, engine- en regelsversie.
- Chrome-versie, viewport en (waar relevant) schaal/zoom.
- Captureframerate, gedropte frames, maximale tijdgaten.
- Gekende beperkingen in kleurprofiel, HDR, fullscreen, iframes en bronattributie.
- Welke scenario's en routes getest zijn.
- Runner-/policyversie, automatische ontdekbronnen, uitgevoerde acties, overgeslagen taken, scanbudgetten en stopreden.
- Of actieve blocker/OS-reduced-motion-instellingen de waarneming kunnen hebben beïnvloed.
- Of de beoordeling voorlopig, automatisch gevalideerd of handmatig bevestigd is.

### 9.5 Cloudflare-antispam en misbruikbescherming (P0)

**Basiskeuze:** Turnstile in **Managed**-modus, met `appearance: interaction-only`. Cloudflare kan de controle op de achtergrond uitvoeren en toont bediening wanneer nodig; de flow belooft niet dat iedere bezoeker zonder interactie doorgaat. Het widget wordt alleen op de betreffende formulier-/verificatiestap geladen. [Widgetconfiguratie](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/)

| Oppervlak | Bescherming |
|---|---|
| Registratie en eigen herstel-/aanmeldlinkformulier | Turnstile vóór een nieuw account of mailverzoek, plus limieten per IP en doel/account. Bij een externe identityprovider zijn diens controles aanvullend; OAuth-callbacks krijgen geen willekeurige challenge. |
| Aanmelden | Requestlimieten en Turnstile bij herhaalde fouten of verdachte pogingen; generieke fouten zonder accountbestaan prijs te geven. |
| Nieuwe online rapporten, ongeacht zichtbaarheid | Accountcontrole, Turnstile-geverifieerde publicatieopdracht, idempotentie en de bestaande upload-/opslagquota. |
| Misbruikmelding over een rapport | Turnstile, limieten en deduplicatie per doel/indiener; een hoeveelheid meldingen maakt een audit niet automatisch ongeldig. |
| Index zoeken, rapport lezen en deellink openen | Begrensde queries en requestlimieten; standaard geen Turnstile-script of challenge. |
| Eigen rapport intrekken/verwijderen en uitloggen | Bestaande sessie-/autorisatiecontrole en aparte redelijke requestlimieten; geen nieuwe Turnstile-afhankelijkheid voor deze handelingen. |
| Lokale scan, CDN-feed en lokale blocker | Geen Turnstile, clearance-cookie of interactieve browsercheck; distributie en offline toepassing volgen §20. |

**Serververificatie en opslag**

- De Worker verifieert tokens via `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` met een serversecret. Controleer `success`, de toegestane `hostname`, de verwachte `action` en de verwachte ondoorzichtige opdrachtidentificatie in `cdata`. De server bepaalt de verwachte waarden; meegestuurde clientwaarden gelden niet als autoriteit.
- Een Turnstile-token is **vijf minuten geldig en eenmalig bruikbaar**. Vernieuw verlopen tokens vlak vóór verzending; bewaar ze niet als langdurig bewijs in een offline uploadwachtrij. Begrens tokenlengte en verificatietijd. Gebruik bij een verificatieretry dezelfde servergegenereerde `idempotency_key` voor die ene verificatie. [Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- Auth, eigenaarschap, CSRF-/origincontrole, schema-/payloadvalidatie en quota blijven apart verplicht. Een mens kan nog steeds spam of onjuiste meetgegevens insturen; Turnstile valideert geen auditinhoud.
- Koppel een geverifieerde publicatieopdracht server-side aan account, inhoudshash, zichtbaarheid en idempotentiesleutel. Het daaruit voortkomende eenmalige publicatierecht vervalt na maximaal tien minuten en wordt atomair met de daadwerkelijke opslag verbruikt. Een andere snapshot, account of zichtbaarheid kan het recht niet hergebruiken.
- Een retry van een reeds voltooide, identieke opdracht retourneert na autorisatie het bestaande resultaat; geen tweede publicatie, quotaverbruik of challenge. Een onvoltooide opdracht zonder geldig publicatierecht wacht op een nieuwe verificatie. Serialiseer verificatie/consumptie per opdracht zodat parallelle requests geen dubbele rechten opleveren.

**Extensie en gebruikersflow**

De extensie voert de websitescan volledig lokaal uit. Pas bij de bewuste online publicatie opent zij zo nodig een korte verificatiestap op de officiële HTTPS-site. Turnstile draait daar, **niet als extern script in de MV3-extensie en niet in de onderzochte website**. Een verse, onvoorspelbare state/nonce bindt die stap aan de aangemelde gebruiker en de al goedgekeurde uploadopdracht. De extensie haalt de uitkomst geauthenticeerd bij de eigen backend op; een willekeurige redirect of paginabericht kan geen publicatierecht toekennen. Begrens ook dit statusverkeer.

De verificatiepagina bevat geen rapportinhoud of geheime deellink in URL/referrer. Toon begrijpelijke status, toetsenbordbediening en **Opnieuw proberen**. Bij uitval blijft de geselecteerde audit lokaal bewaard. Dit verandert niets aan de autonome routeverkenning en introduceert geen controle per gescande pagina.

**Requestlimieten en kostenbescherming**

- Controleer goedkope methode-, payload- en requestlimieten vóór dure verwerking of Siteverify. Gebruik Workers Rate Limiting-bindings met afzonderlijke sleutels per actietype en actor; geen D1-schrijfactie voor elk openbaar leesverzoek.
- Deze Cloudflare-limieten zijn benaderend en gelden per datacenterlocatie. De harde dag-/opslagquota uit §17 worden daarom afzonderlijk atomair in de database afgedwongen. Een geslaagde Turnstile-controle omzeilt geen limiet. [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- Voorlopige startwaarden: zoeken/lezen **120 verzoeken/minuut per IP**, publicatie-/verificatiepogingen **10/minuut per account**, misbruikmeldingen **5/minuut per IP**. Combineer schrijfroutes met een aanvullende IP-limiet en authroutes met een limiet op het doel/account. Test gedeelde bedrijfs-/schoolnetwerken en IPv6; stel de waarden bij op gemeten misbruik en onterechte blokkades.
- Gebruik alleen door de vertrouwde ingress geleverde client-IP-informatie, nooit een vrij meegestuurde header. Sla geen ruwe IP's in applicatielogs op; eventuele pseudonieme limiteridentifiers gebruiken een kortlevende, gesleutelde afleiding.
- Weiger begrensde API-acties met `429` en `Retry-After`; toon in de webinterface wanneer opnieuw proberen zinvol is. Gebruik backoff, geen automatische requestlus. Voor mislukte deellinkpogingen bestaat een eigen teller, zonder tokens te loggen.
- Zet beschikbare Cloudflare WAF-/rate-limitregels gericht vóór de web/API-routes in. Velden, aantallen en mogelijkheden hangen van het zoneplan af; Workers Paid levert niet automatisch alle betaalde WAF- of botfuncties. Documenteer de werkelijke regels en hun prijs vóór release. [WAF rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- Geen sitebrede challenge of Bot Fight-instelling die programmatische JSON-downloads, API-verkeer of deelpreviews onbruikbaar maakt. De feedhost krijgt geen interactieve challenge; test echte extensie-requests zonder browsercookies. Als een beveiligingsfunctie die afbakening niet ondersteunt, kies een gerichte regel die dat wel doet.

**Uitval, configuratie en privacy**

- Faalt Siteverify of ontbreekt een geldig token, dan worden nieuw beschermde schrijf-/authverzoeken niet uitgevoerd. Geef bij provideruitval een tijdelijke fout met herstelactie; schakel productiecontrole niet automatisch uit. Bestaande, nog geldige publicatierechten blijven binnen hun oorspronkelijke begrenzing bruikbaar.
- Lezen, lokale scans, de CDN-feed, offline blokkeren en geautoriseerd intrekken krijgen geen nieuwe afhankelijkheid van Turnstile. Problemen met de verificatiedienst wissen geen data of lokale regels.
- `PUBLIC_TURNSTILE_SITE_KEY` is openbaar; `TURNSTILE_SECRET_KEY` staat uitsluitend in Worker-secrets. Productie en staging gebruiken afzonderlijke keys en expliciete hostnamelijsten. Zelfhosters configureren eigen keys; ontbrekende productiesleutels mogen nooit stilzwijgend bescherming uitschakelen.
- De website-CSP staat alleen op betrokken routes de noodzakelijke Turnstile-scripts en frames toe. De extensie behoudt haar eigen strikte CSP. [Turnstile en CSP](https://developers.cloudflare.com/turnstile/reference/content-security-policy/)
- Log geaggregeerde aantallen, foutcategorieën en operationele status, geen tokens, secrets, formulierinhoud of volledige IP-adressen. Verstuur geen gebruikers-/rapportgegevens als `action` of `cdata`; gebruik vaste actienamen en willekeurige opdracht-ID's. Documenteer gegevensverwerking en bewaartermijnen zonder anonimiteit te beloven.

**Begroting:** gecontroleerd op 26 oktober 2026 biedt Turnstile Free maximaal **20 widgets**, **10 hostnames per widget** en onbeperkte challenges/verificatieverzoeken zonder Turnstile-abonnementskosten. Dat dekt het beoogde startgebruik; Worker-, database-, auth-/mail- en eventuele WAF-kosten blijven afzonderlijk meetellen. Houd de Cloudflare-vermelding zichtbaar waar vereist. [Turnstile-plannen](https://developers.cloudflare.com/turnstile/plans/)

---

## 10. Rapportage en statistieken

### 10.1 Statistieken per site

De onderstaande statistieken gelden steeds binnen een benoemde context: lokale historiek, eigen online rapporten of publieke publicaties. Publieke tellingen omvatten geen privé- of via-link-rapporten. Issues van verschillende bijdragers worden in P0 per bron geteld, zonder een onbewezen globaal aantal unieke problemen te suggereren.

Standaardcards:

- **Aantal geïndexeerde routes.**
- **Aantal effectief geteste routes.**
- **Aantal auditpogingen / afgeronde audits.**
- **Aantal unieke open kandidaten.**
- **Aantal bevestigde open overtredingen.**
- **Aantal opgeloste / teruggekeerde problemen.**
- **Laatste auditdatum en status.**
- **Aantal actieve blokkeerregels** (P2).
- **Kwaliteitsratio:** percentage voltooide audits met toereikende meetkwaliteit.
- **Scope/dekking:** geteste routes en scenario's t.o.v. expliciet bekende/vereiste scope.
- **Autonome verkenning:** ontdekte, ingeplande, gemeten en overgeslagen routes/scenario's; resterende wachtrij en stopreden per job.

**Tel unieke bevindingen en occurrences apart.** Tien keer hetzelfde flitsprobleem in tien scans betekent één uniek issue en tien waarnemingen, niet automatisch tien verschillende problemen.

### 10.2 Grafieken en trends (P1)

- Audits per dag/week/maand.
- Nieuwe vs. opgeloste vs. geregreseerde problemen.
- Auditkwaliteit en uitvalpercentages.
- Vergelijking van twee gekozen audits.
- Uitsplitsing per WCAG-criterium en route.
- Trends in maximale gemeten flitsfrequentie **met vergelijkbare capturekwaliteit**.
- Historiek van actieve blokkeerregels en gemeten mitigatiesucces (P2).

### 10.3 Rapportexport

**JSON (P0)**

- Machineleesbaar, met `schemaVersion`.
- Site/route/sessie, metingen, criteria, statussen, coverage en beperkingen.
- Export van één audit, sitehistoriek of volledige index.
- Optionele anonimisering/pseudonimisering van URL's en selectors.

**HTML (P0)**

- Zelfstandig lokaal te openen rapport.
- Geen automatisch afspelende verdachte media.
- Inclusief statische tijdslijn, bevindingen, criteria, aanbevelingen en meetbeperkingen.
- Printvriendelijk en toegankelijk voor toetsenbord/schermlezer.

**CSV (P1)**

- Samenvattende audits, routes of issues, nuttig voor spreadsheets.

**Online rapport en deellink (P0)**

- Vaste rapportversie, zonder extensie te lezen; zichtbaarheid volgens §5.7.
- Statische tijdslijn, bevindingen, meetdatum, publicerende gebruiker, scope en beperkingen.
- Dezelfde betekenis van statussen als lokaal; uploaden promoveert een kandidaat niet tot bevestigde overtreding.
- Downloadbare exports volgen dezelfde toegangscontrole en bevatten uitsluitend de geselecteerde online snapshot, nooit verborgen lokale velden.
- Publieke sitepagina's koppelen de gepubliceerde rapporten met hun herkomst en meetdatum; een hertest krijgt een eigen link.

### 10.4 Auditresultaten vergelijken

Gebruik de categorieën:

| Categorie | Definitie |
|---|---|
| `NEW` | Nieuwe fingerprint/issue in recente audit. |
| `PERSISTING` | Vergelijkbaar issue nog aanwezig. |
| `RESOLVED` | In voldoende vergelijkbare hertest verdwenen of expliciet bevestigd opgelost. |
| `REGRESSED` | Eerder opgelost probleem opnieuw gezien. |
| `NOT_RETESTED` | Geen bewijs beschikbaar omdat relevante scène niet opnieuw geobserveerd is. |
| `CHANGED_METHOD` | Vergelijking beperkt doordat detector-/WCAG-implementatie gewijzigd is. |

---

## 11. Teststrategie en acceptatiecriteria

### 11.1 Testfilosofie

Flitsdetectie is een **veiligheidsrelevante meting**. Naast normale softwaretests zijn reproduceerbare algoritmetests, samplingtests, edge cases en vergelijking met gezaghebbende referenties noodzakelijk. Testen moeten bij voorkeur met **synthetische pixelreeksen en numerieke fixtures** gebeuren zodat testresultaten geen gevaarlijke knipperende beelden hoeven te tonen.

### 11.2 Minimale algoritmetests

| Test | Verwachte interpretatie |
|---|---|
| Statisch wit/zwart/gekleurde achtergrond | Geen flitsen; wel juiste capturekwaliteit. |
| Eén grote luminantietransitie zonder terugkeer | Niet foutief tellen als een volledige flits. |
| Twee algemene flitsen binnen één seconde | Niet als >3-flits-criterium markeren. |
| Vier algemene flitsen in één seconde, relevante grote oppervlakte | Kandidaat 2.3.1; na normvalidatie mogelijk `NON_CONFORMANT`. |
| Vier flitsen met bewezen kleine, normatief toegelaten oppervlakte | Onder voorwaarden mogelijk 2.3.1 OK; 2.3.2 AAA afzonderlijk beoordelen. |
| Vier verzadigd-rode flitsen met relevante oppervlakte | Rode-flitscontrole moet ze vinden. |
| Twee afzonderlijke gelijktijdig flitsende regio's | Relevante gecombineerde oppervlakte correct meten. |
| Niet-gelijktijdige regio's | Oppervlaktes niet verkeerd optellen. |
| Afwisselend licht/donker bij scherpe cut | Niet dubbel tellen door framegrenzen. |
| Loopende GIF op overgang einde/begin | Ook flitsen rond loopgrens meetellen. |
| Snelle reeks met gedropte frames | `INCONCLUSIVE` indien niet betrouwbaar te beoordelen. |
| 30 fps terwijl bron hogere flitsfrequentie heeft | Geen onterechte veilige conclusie door aliasing. |
| HDR/ongekend kleurprofiel | Relevante beperkingen zichtbaar, geen stille `PASS`. |
| DOM-bron in cross-origin iframe | Visuele bevinding behouden; bron `unknown` indien geen permissie. |
| Canvas/WebGL | Detector onafhankelijk van aanwezigheid van HTML-selector. |
| Fullscreen vs inline video | Afzonderlijke context/scenario vastleggen. |

### 11.3 Index- en statistiektests

- [ ] Eerste audit creëert exact één `Site` voor een origin.
- [ ] Tweede audit van dezelfde route creëert een nieuwe `AuditSession`, maar geen dubbele `Page`.
- [ ] Eén issue dat op meerdere momenten voorkomt houdt één `Finding` met meerdere `FindingOccurrence`-records.
- [ ] Exact dezelfde audit opnieuw wegschrijven is idempotent.
- [ ] Eerdere `false_positive` blijft traceerbaar en vereist herbeoordeling bij gewijzigd element/engine.
- [ ] Een niet-geobserveerde route kan niet automatisch `PASS` krijgen.
- [ ] Een afgebroken audit wordt `INTERRUPTED` of `INCONCLUSIVE` met de relevante reden.
- [ ] Queryparameters met tokens belanden niet in standaardopslag of exports.
- [ ] Browser herstarten behoudt normale sitehistoriek.
- [ ] Ondertussen actieve blockerregels beïnvloeden originele pass/fail-statistieken niet.
- [ ] Een lokale site wissen verwijdert ook gekoppelde lokale issues, occurrences, samenvattingen en blockerregels volgens een expliciet cascaderingsbeleid; online rapporten worden afzonderlijk beheerd.
- [ ] Historische data blijft leesbaar na migratie van de databaseversie.

### 11.4 Extensie-/UI-tests

- [ ] epi-less-tab verschijnt in Chrome DevTools.
- [ ] Starten koppelt aan het daadwerkelijk geïnspecteerde tabblad.
- [ ] Indien een DevTools-knop niet voldoet als user gesture, verschijnt een bruikbare alternatieve captureflow.
- [ ] Actieve capture stopt bij gebruikeractie en laat geen hangende stream achter.
- [ ] Statusupdates werken nadat een MV3-service-worker herstart.
- [ ] React-interface blijft bruikbaar bij hoge analysebelasting.
- [ ] Testresultaten zijn met toetsenbord en screenreader leesbaar.
- [ ] De UI bevat geen automatisch afspelende of knipperende probleemweergaven.
- [ ] HTML/JSON-export bevat dezelfde semantische status en meetbeperkingen.
- [ ] Een site met vier ongeteste routes verschijnt niet als volledig geslaagd.

### 11.5 Definitie van gereed voor een betrouwbare `PASS`

Een daadwerkelijke `passed: true` mag pas vrijgegeven worden wanneer:

1. De specifieke beoordelingsregel tegen officiële WCAG-definities is uitgewerkt.
2. Detector en kleur-/luminantieconversie aantoonbaar zijn gevalideerd.
3. Minimaal vereiste framekwaliteit en schaalinformatie beschikbaar zijn.
4. De geteste scope en scenario's expliciet zijn vastgelegd.
5. Relevante normuitzonderingen correct verwerkt zijn.
6. Geen blocker de onbehandelde broncontent ongemerkt heeft verborgen.
7. Reproduceerbare tests en documentatie aanwezig zijn.

Tot die tijd wordt de MVP als **screening- of audit-assistent** gepositioneerd, met kandidaatbevindingen en `NO_ISSUES_OBSERVED` in plaats van een definitieve conformiteitsclaim.

### 11.6 Online index en delen (P0)

- [ ] Een lokale meting van beschikbare content werkt zonder account of epi-less-backend; de websitescan uploadt niets vanzelf. Netwerkuitval bij het laden van nieuwe routes wordt als beperkte dekking gerapporteerd.
- [ ] De verzonden snapshot komt exact overeen met de gecontroleerde preview; verwijderde paden, selectors en notities ontbreken ook in API-responses, exports en logs.
- [ ] Een rapport dat privé online is bewaard, is alleen door de eigenaar te lezen; een andere ingelogde gebruiker krijgt geen toegang via geraden IDs of exports.
- [ ] Een actieve deellink werkt in een aparte browser zonder account of extensie. Een unlisted rapport is zonder die link niet via de rapport-ID beschikbaar.
- [ ] Via-link- en privérapporten ontbreken in publieke zoekresultaten, statistieken, sitemap en inhoudelijke externe previews.
- [ ] Een publiek rapport verschijnt op de juiste sitepagina met datum, herkomst, scope en meetkwaliteit.
- [ ] Een hertest krijgt een eigen rapportlink; de inhoud van een eerder gedeelde versie verandert niet stilzwijgend.
- [ ] Intrekken, privé maken en moderatie verbergen de inhoud ook in API, exports, caches en publieke aggregaties. Een ingetrokken deellink geeft geen rapportgegevens terug.
- [ ] Een offline upload of service-worker-herstart kan idempotent worden hervat zonder dubbele publicaties; wisselen van account hervat geen opdrachten van de vorige gebruiker.
- [ ] Een verouderde retry herstelt geen ingetrokken of verwijderde publicatie.
- [ ] Uploaden wijzigt geen auditstatus en kent geen geverifieerd label toe op basis van zelf aangeleverde claims.
- [ ] Rapporten van meerdere bijdragers blijven herkenbaar als afzonderlijke bronnen; een nieuwe onvolledige scan wist eerdere risico's niet uit.
- [ ] Lokale verwijdering en online verwijdering hebben elk het beschreven effect; een backupherstel maakt verwijderde publicaties niet opnieuw toegankelijk.
- [ ] Een melding kan worden behandeld door bevoegd beheer; gewone gebruikers kunnen geen moderatierechten verkrijgen.
- [ ] De online interface is met toetsenbord en screenreader bruikbaar en bevat geen autoplay van verdachte content.
- [ ] De volledige publiceer-, lees- en intrekflow is op de uitgerolde webapp/API geverifieerd; alleen lokale tests of een bereikbare homepage volstaan niet.

### 11.7 Gewone extensie en autonome websitescan (P0)

- [ ] Met DevTools gesloten kan een gebruiker via de toolbar starten en na de startflow zonder verdere klikken een rapport ontvangen.
- [ ] Een bekende testwebsite met interne links en meerdere documenten wordt zelfstandig doorlopen; de geplande routes en geobserveerde routes zijn controleerbaar tegenover de fixture.
- [ ] De runner vindt en onderzoekt ondersteunde SPA-routes en content onder de eerste viewport, inclusief begrensde lazy loading.
- [ ] Herkenbare menu's, accordions, tabs en media worden zelfstandig getest; het log bewijst de bereikte toestanden en de bijbehorende frames.
- [ ] Niet-uitvoerbare acties door ontbrekende user activation, login, CAPTCHA of onbekende controls worden overgeslagen met reden. De job gaat verder met andere routes en maakt zelfstandig een gedeeltelijk rapport.
- [ ] Een testpagina met betalen, verzenden, verwijderen, uitloggen en andere mutaties blijft onaangeraakt. Ook gevaarlijke links en controles met dubbelzinnige betekenis worden overgeslagen.
- [ ] Cyclische links, redirects buiten scope, kalenderpaden, queryvarianten, oneindige scroll en trage pagina's stoppen binnen de vastgelegde limieten.
- [ ] Popup/DevTools sluiten stopt de job niet; openen toont dezelfde voortgang. Twee interfaces veroorzaken geen dubbele job of acties.
- [ ] Een normale meervoudige documentnavigatie binnen scope vereist geen herhaalde capturetoestemming per route; framekwaliteit en DOM-herkoppeling blijven aantoonbaar correct.
- [ ] Met het rustige voortgangsscherm zichtbaar ontvangt de runner bruikbare frames zonder dat de gebruiker de onderzochte content moet bekijken. Achtergrond/minimaliseren/slaapstand worden afzonderlijk beoordeeld; onbruikbare frames leveren geen geldige meting op.
- [ ] Stoppen annuleert verdere navigaties en acties en bewaart deelresultaten. Een late callback start de job niet opnieuw.
- [ ] Workercrash, tabsluiting en browserherstart verliezen geen afgeronde taken; onzekere acties worden niet blind herhaald en ontbrekende autorisatie wordt niet verondersteld.
- [ ] Budgetgrens en lege wachtrij zijn verschillende stopredenen. `COMPLETED`, `PARTIAL` en meetuitkomst worden afzonderlijk getoond; onontdekte delen tellen niet als getest.
- [ ] Eén websitescan levert automatisch één rapport met routes, scenario's, bevindingen, kwaliteit en beperkingen op; online delen behoudt die betekenis.

Gebruik voor de runner gewone, niet-flitsende testsites en voor flitsalgoritmen numerieke fixtures. Een test waarbij de uitvoerder zelf alle routes en media moet openen, voldoet niet aan deze autonome acceptatiecriteria.

### 11.8 Open source, levering en betaalbare index (P0)

- [ ] Publieke repository onder de juiste GitHub-organisatie, met complete licentie, README en communitybestanden; alle badges/links komen overeen met werkelijk beschikbare onderdelen.
- [ ] Een nieuwe contributor kan de README-quickstart vanuit een schone checkout uitvoeren zonder productiecredentials, remote database of productiedata.
- [ ] Een fork-PR doorloopt de relevante tests zonder secrets of verhoogde rechten; een wijziging aan workflows krijgt expliciete maintainerreview.
- [ ] `main` en release-tags zijn beschermd. Een falende, geannuleerde of ontbrekende vereiste check verhindert merge.
- [ ] De merge queue test de daadwerkelijke mergegroep en ontvangt alle vereiste CI- én securitychecks, inclusief bij docs-only PR's.
- [ ] Het release-artifact is herleidbaar tot een gereviewde commit; staging en productiepromotie gebruiken de juiste versie en omgeving.
- [ ] De GitHub Environment beschermt productierechten; een fork, gewone PR of willekeurige tag kan niet deployen.
- [ ] Quota en payloadlimieten worden atomair afgedwongen, ook bij parallelle uploads en retries; een quota-afwijzing bewaart lokale data.
- [ ] De benchmark met 10.000 synthetische rapporten rapporteert werkelijke CPU-, database- en opslagkosten; de gekozen providerconfiguratie past binnen de vastgelegde startbegroting.
- [ ] Intrekken blijft correct werken met indexaggregaties en eventuele caches; kostenoptimalisatie verandert de toegangsregels niet.
- [ ] Private backup, schema-upgrade en herstel zijn getest zonder herpublicatie van verwijderde rapporten; productiedata verschijnt nooit in openbare CI-artifacts.

### 11.9 CDN-distributie en offline regels (P0-fundament, P2-toepassing)

- [ ] De CDN-feed bevat uitsluitend toegelaten publieke regelvelden; privé-/unlisted-rapporten, tokens en persoonsgegevens ontbreken.
- [ ] Met API en D1 uitgeschakeld kan een client een bestaande release via zowel warme als koude CDN-cache downloaden; de cachemiss gebruikt uitsluitend statische objectopslag.
- [ ] De feed-JSON heeft de bedoelde cacheheaders en aantoonbare cachehits. Rapport-/account-API's vallen buiten deze cacheconfiguratie.
- [ ] Een gedeeltelijke publicatie wijzigt `latest.json` niet; alle manifestverwijzingen, hashes en groottelimieten zijn vóór promotie gecontroleerd.
- [ ] Ongeldige handtekening, onbekende sleutel, verkeerde hash, te grote payload, incompatibel schema, verlopen nieuwe metadata en downgrade laten de actieve regelset intact.
- [ ] Een update activeert alle bestanden samen; netwerkonderbreking, volle opslag en crash tijdens schrijven veroorzaken geen gemengde of lege actieve set.
- [ ] De P2-blocker past eerder geactiveerde regels toe zonder API/CDN-request, ook na een koude browserstart met netwerk geblokkeerd en zonder epi-less-login.
- [ ] Een eerste offline start gebruikt uitsluitend de meegeleverde basisset en toont haar werkelijke dekking; een lege basisset geeft geen beschermingsclaim.
- [ ] Verlopen feedmetadata toont veroudering maar wist bestaande geldige regels niet. Harde regelvervaldatum, lokale uitschakelingen en bekende intrekkingen blijven gelden.
- [ ] Geldige intrekkingen worden bewaard wanneer een volgende bestandsdownload mislukt; terugval naar vorige of ingebouwde versies activeert die regels niet opnieuw.
- [ ] De updater bewaart het hoogste vertrouwde volgnummer, verwerkt klokafwijkingen en hervat alleen een identieke kandidaatversie; serverrollback gebeurt met een hoger volgnummer.
- [ ] Polling gebruikt spreiding en backoff, geen verzoek per bezochte site; bij volledige uitval ontstaat geen requeststorm.
- [ ] De offline toepassingsroute is gemeten op echte Chrome-testfixtures; geen wachten op een MV3-worker-netwerkantwoord vóór matching.

### 11.10 Astro-website, prestaties en vormgeving (P0)

- [ ] Startpagina, uitleg en documentatie worden statisch geserveerd zonder D1-query; de bundelanalyse toont geen React-runtime op pagina's zonder React-interactie.
- [ ] Een bezoeker kan zonder JavaScript de index doorzoeken via formulier/paginering en een toegelaten rapport lezen. Essentiële inhoud staat in de eerste HTML-response.
- [ ] Intrekking werkt onmiddellijk bij nieuwe HTML-, API-, export- en metadatarequests; er bestaat geen oude prerender, serviceworker-cache of gedeelde rapportcache die toegang omzeilt.
- [ ] Interactieve routes blijven binnen de JS/CSS/fontbudgetten uit §21.5; vertraagde islands, fouten en lege resultaten zijn bruikbaar en toegankelijk.
- [ ] De productiebuild wordt in de Workers-runtime getest met lokale D1-bindings en synthetische data; een gewone Node-devserver is onvoldoende deploybewijs.
- [ ] Representatieve pagina's voldoen aan de afgesproken mobiele prestatiemetingen; resultaten en bundleverschillen worden bij de PR bewaard.
- [ ] Startpagina, index, rapport en beheer zijn visueel gecontroleerd op 360, 768 en 1440 px, met toetsenbord, 200% zoom en reduced motion.
- [ ] De zelfstandige epi-less-identiteit, typografie en bescheiden makercredit op de projectpagina zijn consistent; tekstcontrast, focus en statuslabels zijn afzonderlijk getest. De site bevat geen automatisch bewegende of flitsende decoratie.

### 11.11 Antispam en challengevrije distributie (P0)

- [ ] Rechtstreekse beschermde API-aanroepen zonder geldige verificatie worden geweigerd; alleen de clientcallback namaken werkt niet.
- [ ] Ongeldig, verlopen of hergebruikt token en verkeerde hostname/action/opdrachtbinding veroorzaken geen account, mailverzoek, melding of nieuwe publicatie.
- [ ] Een publicatierecht is gebonden aan de goedgekeurde snapshot en account; parallelle requests en retries veroorzaken geen dubbel verbruik of dubbele opslag.
- [ ] Een lang offline bewaarde upload krijgt bij hervatten verse verificatie; provideruitval behoudt het rapport lokaal en toont een herstelactie.
- [ ] Rate limits werken per route en actor; harde quota houden ook bij parallelle uploads stand. `429`/`Retry-After` veroorzaakt clientbackoff.
- [ ] Bij geblokkeerd Turnstile werken lokale scans, gewone rapportweergave, geautoriseerd intrekken en JSON-downloads zonder challengecookies; de offline blocker blijft werken.
- [ ] Productie weigert ontbrekende secrets en test-/bypassconfiguratie. Tests dekken CSP, onterechte blokkades, toetsenbordbediening en widgetfouten.
- [ ] CI gebruikt officiële Turnstile-testkeys of een expliciet geïnjecteerde lokale verificatiefixture; echte productiekeys ontbreken in fork-PR's. Een geslaagde test met dummykeys is geen bewijs van werkende productieconfiguratie. [Cloudflare-testkeys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
- [ ] Vóór release is een echte stagingflow met eigen stagingkeys en hostname getest, inclusief server-side afwijzing, extensiepublicatie en challengevrije feed.

---

## 12. Roadmap en prioriteiten

### Fase 0 — Technische haalbaarheidsproef

**Doel:** aantonen dat de gewone extensie zonder DevTools meerdere pagina's en interactieve toestanden zelfstandig kan onderzoeken met bruikbare frames, en dat het rapport online deelbaar is.

- [ ] Monorepo, actuele README, lokale ontwikkelroute en minimale verplichte CI opzetten onder de beoogde projectrepository.
- [ ] MV3-extensie installeren met toolbar-interface, blijvende voortgang en epi-less DevTools-tab.
- [ ] Beide interfaces koppelen aan dezelfde scanrunner en de juiste scantab.
- [ ] Een geldige startflow voor de gewone gebruiker bewijzen; daarna zonder herhaalde bevestiging navigeren binnen scope.
- [ ] Offscreen document ontvangt de videostream.
- [ ] Een analyseworker ontvangt pixeldata en tijdstippen.
- [ ] Automatisch links ontdekken, minimaal drie routes bezoeken, scrollen, een menu openen en een ondersteund medium starten op een gecontroleerde testsite.
- [ ] Framekwaliteit bij volledige navigatie, SPA-overgang en achtergrondweergave aantonen zonder dat de gebruiker de content moet bekijken.
- [ ] Action policy en scanlimieten toepassen; een onbereikbare route overslaan en zelfstandig afronden.
- [ ] Uitvallen, navigaties en herstart testen.
- [ ] Job, taken en meetresultaten in IndexedDB bewaren en een automatisch samengesteld rapport heropenen.
- [ ] Minimale Worker/D1-backend met eigenaargebonden rapportsnapshot en deellink; lokaal én in een kleine staging bewijzen.
- [ ] Astro/React/Cloudflare-build met één statische startpagina en één dynamisch rapport bewijzen, inclusief toegang, cacheheaders en werkelijke serverbindings.
- [ ] Vanuit de extensie één gecontroleerd rapport uploaden, in een aparte browser openen en de link intrekken.

**Exitcriterium:** één toolbar-start met de nodige toestemming resulteert zonder verdere bediening in een rapport van meerdere automatisch bezochte routes en geteste UI-toestanden, met aantoonbare meetkwaliteit. Een geselecteerd rapport is via een werkende en intrekbare link te lezen. Lokale uitvoering blijft onafhankelijk van de epi-less-backend. De keuze van scantab en capturecontext is hiermee bewezen, niet alleen beschreven.

### Fase 1 — MVP: autonome extensie voor iedereen, DevTools en online index (P0)

**Lokale uitvoering — 27 oktober 2026:** aangevinkte onderdelen zijn lokaal geïmplementeerd en gecontroleerd. De gebruiker heeft hosting en externe publicatie uitgesteld. Testbewijs en grenzen staan in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) en [docs/P0-ACCEPTANCE.md](docs/P0-ACCEPTANCE.md).

- [x] Gewone extensie met **Scan deze website**, begrijpelijke voortgang en automatisch eindrapport.
- [x] Autonome routeontdekking, navigatie, scrollen en ondersteunde interactie-/mediascenario's.
- [x] Duurzame jobwachtrij, actiesbeleid, budgetten, pauze/stop, herstel en expliciete dekking/stopreden.
- [x] DevTools op dezelfde engine, met snelle en uitgebreide viewportmetingen als expertopties.
- [x] Frameanalyse voor algemene en rode flitskandidaten.
- [x] Tijdvensters, regiometingen en capturekwaliteit.
- [x] Lighthouse-achtig overzicht met statussen en technische uitleg.
- [x] Automatische lokale site-/route-index inclusief historiek.
- [x] `NO_ISSUES_OBSERVED`, `NEEDS_REVIEW`, `INCONCLUSIVE`, `ERROR`.
- [x] Bevindingen opslaan en minimaal dedupliceren.
- [x] JSON- en HTML-export.
- [x] Astro-webportaal met een eigen epi-less-identiteit, bescheiden makercredit op de projectpagina en publieke website-index, zoekfunctie en rapportpagina's; React alleen waar nodig voor interactie.
- [x] Renderingbeleid, prestatiebudgetten, toegankelijkheid en visuele controles uit §21 in de verplichte CI opnemen.
- [x] Aanmelden en eigen online rapporten beheren.
- [x] Gegevenspreview en veldselectie vóór upload; duurzame uploadwachtrij met retries.
- [x] Privéopslag, via-link delen en publieke publicatie met vaste rapportversies.
- [x] Deelbare links die zonder extensie werken; generieke of publieke statische previews volgens zichtbaarheid.
- [x] Toegangscontrole, intrekken, verwijderen en correcte publieke aggregaties.
- [x] Herkomstlabels en basisflow voor melden en modereren.
- [x] Privacyinstellingen en afzonderlijk lokale/online gegevens verwijderen.
- [ ] Webapp, API en database online uitrollen en de deel- en intrekflow live controleren.
- [x] Open-sourcebestanden en correcte licentie, contributorquickstart en eigen deployroute.
- [ ] Branch-/tagbescherming, codeowners, merge queue en werkende GitHub Actions volgens §19.
- [ ] Reproduceerbare releases, productiepromotie en apart beheerde storepublicatie.
- [x] Payload-/accountquota, benchmark met 10.000 rapporten, lokale gebruiksdrempels en geteste versleutelde lokale backups/herstel.
- [ ] Providerkosten, gehoste monitoring, backupplanning en onafhankelijk duurzame ledger in de echte hostingomgeving controleren.
- [x] Cloudflare Turnstile, server-side verificatie, extensiepublicatiestap en requestlimieten volgens §9.5; uitval- en misbruiktests volgens §11.11.
- [x] Ondertekende publieke JSON-feed, statische export en zelfstandige lokale distributie zonder API/D1; nog niet gevalideerde regels blijven uit de feed.
- [ ] Echte R2/CDN-publicatie, cachehits en warme/koude uitvaltests op de gekozen hostingomgeving.

**Exitcriterium:** een niet-technische gebruiker start vanuit de gewone extensie een websitescan en krijgt zonder zelf pagina's, menu's of video's te bedienen een rapport. De runner voert de begrensde verkenning, metingen en rapportage zelfstandig uit. Resultaten zijn later terug te vinden, basaal te vergelijken en online deelbaar; ontvangers hebben geen extensie nodig. Publieke rapporten zijn vindbaar en publicaties intrekbaar. De community kan aantoonbaar bijdragen via de gedocumenteerde ontwikkel- en mergeflow; de beheerder host de officiële index binnen een onderbouwde startbegroting. Autonome uitvoering, online index en open-sourcelevering zijn vereist voor deze MVP. **Geen gevalideerde algemene veiligheidsclaim.**

### Fase 2 — Normvalidatie, bronlokalisatie en statistieken (P1)

**Stand 0.4:** de onderstaande vakjes beschrijven de volledige P1-eis, niet alleen aanwezige code. De kandidaatimplementatie heeft al bruikbare delen:

| Onderdeel | Ontwikkeld en lokaal getoetst | Nog open voor volledige acceptatie |
|---|---|---|
| Ruimtelijke beoordeling | Exacte gelijktijdige maskers, gecombineerde losse regio's, expliciete veldgeometrie en statische patroon-/bewegingshints. Externe vergelijking: 24 maskers, 10 TP/2 FN/0 FP/12 TN; 36 gedecodeerde video's volgens CSV, 14 TP/4 FN/0 FP/18 TN. | Normatieve fysieke kalibratie en bredere validatie. JSON-labels geven afzonderlijk 10 TP/2 FN/4 FP/19 TN op 35 geldige gevallen; zeven bronconflicten blijven zichtbaar. |
| Bronnen en animaties | Tijdgestempelde geometrie, mutaties, animatietiming en videotijd, behoud van meerdere kandidaten, echte lokale elementinspectie en herstelclues. Chrome-fixtures toetsen veranderende DOM, scroll en verouderde identiteit. | Bewezen causaliteit op het exacte capturetijdstip, bekende capturelatentie, bredere animatie-/pauzecontrole en ontoegankelijke DOM. |
| Review en hercontrole | Lokale bevestiging/false-positive-notities, opgeslagen scenarioherhaling, compatibiliteits- en kwaliteitscontrole, herwaargenomen/niet-waargenomen/onvergelijkbaar. Opgelost/heropend vereist een passende hercontrole en expliciete review. | Betrouwbare defectidentiteit over verschillende sitesessies en herontwerpen; volledige automatische NEW/PERSISTING/RESOLVED/REGRESSED-statistieken. |
| Autonome dekking | Meer carrouselstaten, begrensde focus, uitgestelde toestand, compact viewportprofiel en echte hover in een optionele advanced build. Overgeslagen en niet-bereikte scenario's blijven zichtbaar. | Native compacte capture is nog niet bewezen: compacte dekking staat tweemaal UNREACHED na geweigerde captureconstraints; onafhankelijke pogingen en oorzaak zijn niet bewezen. Verder ontbreken de hardware-/browsermatrix en dekking van willekeurige componenten. |

De videovalidator encodeert echte FFV1-bestanden en controleert alle 1.204 gedecodeerde framehashes en tijdstippen zonder media af te spelen. Dit is geen Chrome-capturetest. De twee afwijkende maskers bevatten in hun geheel minder pixels dan de opgegeven drempel; tegenstrijdige labels blijven ongewijzigd. De uitgebreide temporele referentie bewaart daarnaast alle 18 extra kandidaten als onderzoekspunten. Zie [het kwaliteitsdossier](docs/SCANNER-QUALITY.md) voor methode, bronbestanden en exacte beperkingen.

- [ ] Normatieve oppervlakte-/kleurbeoordeling en referentietests.
- [ ] Geverifieerde `NON_CONFORMANT`-uitkomsten en alleen waar gerechtvaardigd beperkte `passed: true`.
- [ ] DOM-elementdetectie, selectors en confidence.
- [ ] CSS-/Web Animations API-inventarisatie.
- [ ] Historiek met `NEW`, `PERSISTING`, `RESOLVED`, `REGRESSED`.
- [ ] Site-dashboard met grafieken en coverage.
- [ ] Verschillen tussen audits en engineversies zichtbaar maken.
- [ ] Reviewworkflow voor false positives en bevestigde problemen.
- [ ] Optionele handmatige aanvullende audit voor experts, extra scenario-adapters en import van routelijsten.
- [ ] Uitgebreidere online vergelijkingen en aantoonbare verificatie van bijdragers of site-eigenaarschap waar nodig, gescheiden van meetvalidatie.

**Exitcriterium:** ontwikkelaars en auditors kunnen betrouwbare, herhaalbare beoordelingen en herstelde problemen op een website volgen.

### Fase 3 — Blocker op basis van bestaande index (P2)

- [ ] User-approved regels maken vanuit een specifieke finding.
- [ ] Element-fingerprinting en matchkwaliteitscontrole.
- [ ] `PAUSE_ANIMATION`, `PAUSE_MEDIA`, `HIDE_ELEMENT`.
- [ ] Per-site activeren en pauzeren.
- [ ] Vroegtijdige toepassing waar browsers dit toelaten.
- [ ] Undo, uitzonderingen en foutlogging.
- [ ] Scheiding originele audit vs. `WITH_MITIGATION`.
- [ ] Ingebouwde basisregels en lokale geverifieerde regelopslag met achtergrondupdates via CDN.
- [ ] Volledig offline toepassen na browserherstart, inclusief uitzonderingen, intrekkingen, rollback en zichtbare veroudering.
- [ ] Duidelijke waarschuwing dat blokkering geen totale bescherming garandeert.

**Exitcriterium:** eerder gekende en door de gebruiker goedgekeurde risicobronnen kunnen gericht worden gemitigeerd en eenvoudig hersteld, ook met de project-API en CDN onbereikbaar en na een browserherstart. Alleen het verkrijgen van nieuwe regels vereist een bereikbare distributiebron.

### Fase 4 — Uitbreidingen (P3)

- [ ] Opdrachten over meerdere afzonderlijke websites; de autonome scan van één website is al P0.
- [ ] CLI en integratie met Playwright/CI via gedeelde engine (kan een aparte lokale Node-runtime vereisen, maar geen cloudserver).
- [ ] CSV, gestructureerde teamsrapporten en releasevergelijking.
- [ ] Optionele synchronisatie van geselecteerde lokale werkdata tussen apparaten via de bestaande backend, aanvullend op het online bewaren en delen uit P0.
- [ ] Gedeelde teamwerkruimten, uitgebreidere rollen en gezamenlijke beoordeling.
- [ ] Verdere blockerondersteuning voor dynamische websites.

---

## 13. Projectstructuur en ontwikkelafspraken

### 13.1 Voorgestelde monorepo

```text
epi-less/
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── GOVERNANCE.md
├── CHANGELOG.md
├── .env.example
├── .node-version
├── package.json                 # gepinde packageManager en gedeelde scripts
├── pnpm-lock.yaml
├── .github/
│   ├── CODEOWNERS
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── ISSUE_TEMPLATE/
│   ├── dependabot.yml
│   └── workflows/
│       ├── ci.yml
│       ├── security.yml
│       ├── deploy-staging.yml
│       ├── release.yml
│       ├── publish-feed.yml
│       └── deploy-production.yml
├── apps/
│   ├── chrome-extension/
│   │   ├── manifest.json
│   │   ├── src/
│   │   │   ├── devtools/          # createPanel entrypoint
│   │   │   ├── panel/             # React audit dashboard
│   │   │   ├── popup/             # Scan deze website, gewone gebruikers
│   │   │   ├── progress/          # blijvend voortgangs- en rapportscherm
│   │   │   ├── background/        # MV3 service worker
│   │   │   ├── browser-adapter/   # navigatie, capturecontext en actieresultaten
│   │   │   ├── offscreen/         # MediaStream / frameextractie
│   │   │   ├── content/           # route-, DOM-, animatie-inspectie
│   │   │   ├── publishing/        # preview, account, uploadwachtrij
│   │   │   └── action/            # toolbar-start en browserautorisatie
│   │   └── public/
│   └── web/                      # Astro + React-islands, één Worker-deploy
│       ├── astro.config.mjs
│       ├── wrangler.jsonc        # bindings en expliciete hostingconfiguratie
│       ├── src/pages/            # statische info + dynamische index/rapporten
│       │   └── api/              # auth, publicatie, toegang, moderatie
│       ├── src/layouts/          # Astro-documenten, SEO en navigatie
│       ├── src/components/       # Astro-componenten en gerichte React-islands
│       ├── src/server/           # gedeelde use cases voor SSR en API
│       │   └── abuse-protection/ # Turnstile, opdrachtbinding en requestlimieten
│       └── src/styles/           # epi-less-tokens, typografie en scoped CSS
├── packages/
│   ├── analysis-engine/
│   │   ├── src/luminance/
│   │   ├── src/red-flash/
│   │   ├── src/temporal/
│   │   ├── src/spatial/
│   │   └── src/rules/
│   ├── audit-domain/             # types en use cases
│   ├── scan-runner/              # jobs, frontier, scenario's, budgets, herstel
│   ├── action-policy/            # toegestane inspectieacties en scopecontrole
│   ├── persistence/              # lokale Dexie-opslag en migraties
│   ├── server-storage/           # D1/SQLite, migraties en autorisatiequeries
│   ├── publication/              # snapshots, zichtbaarheid, intrekken
│   ├── rule-feed/                # publieke projectie, manifest, signing en schema
│   ├── rule-updater/             # P2: verificatie, lokale versies en intrekkingen
│   ├── site-index/               # normalisatie, rollups, matching
│   ├── reporting/                # HTML/JSON-export
│   ├── blocker/                  # P2, rules en toepassing
│   └── shared/                   # versioned message schemas
├── tests/
│   ├── synthetic-fixtures/
│   ├── wcag-reference/
│   ├── extension-e2e/
│   ├── autonomous-scan/          # routes, UI-toestanden, blokkades en stopgedrag
│   ├── sharing-e2e/              # publiceren, lezen, intrekken, autorisatie
│   ├── web-quality/              # rendering, bundels, performance, a11y en visueel
│   ├── cost-benchmark/           # CPU, opslag, row reads/writes en quota
│   ├── feed-distribution/        # CDN, signatures, privacy en atomaire updates
│   ├── blocker-offline/          # P2: herstart en matching zonder netwerk
│   └── data-migration/
└── docs/
    ├── architecture.md
    ├── autonomous-scanning.md
    ├── wcag-validation.md
    ├── privacy.md
    ├── abuse-protection.md
    ├── publishing.md
    ├── deployment.md
    ├── development.md
    ├── self-hosting.md
    ├── operations.md
    ├── rule-feed.md
    ├── web-design.md
    ├── web-performance.md
    ├── costs.md
    └── decisions/
```

De API zit vanaf de start in de serverlaag van `apps/web`; een afzonderlijke `apps/api`-deploy is niet nodig. SSR en API delen autorisatie- en publicatiecode. Domeinmodules blijven onafhankelijk van Astro, React en Cloudflare, zodat een latere andere deployment geen herschrijving van de meetlogica vereist.

### 13.2 Technische conventies

- Alle detectielogica is **onafhankelijk van React, Chrome en de database**.
- Analyseresultaten zijn deterministisch voor dezelfde inputframes, timestamps, regelsversie en configuratie.
- Gebruik discriminated unions voor eventtypes en statusovergangen.
- Iedere publieke data-export heeft een `schemaVersion`.
- Database-migraties en meetregelmigraties zijn gescheiden.
- Gebruik consistente UTC-timestamps voor persistentie en lokale tijdzone voor presentatie.
- Centraliseer URL-normalisatie en de regels voor site-/route-identiteit.
- Bewaar audit- en blokkeringstoestand als aparte domeinen.
- Bewaar meetuitkomst, publicatiezichtbaarheid, moderatiestatus en uploadstatus als aparte domeinen.
- Scheid ook jobuitvoering, route-/scenariodekking en meetkwaliteit. Een afgehandelde taak heeft niet automatisch geldige metingen.
- Gewone extensie en DevTools gebruiken dezelfde jobcontracten; geen aparte detectielogica of verplichte DevTools-levenscyclus.
- Houd routeplanning en actiepolicies testbaar buiten Chrome; valideer daadwerkelijke navigatie, scenario-uitvoering en capturekwaliteit in echte Chrome-integratietests.
- Deel versieerbare publicatieschema's tussen extensie, web en API; backend valideert alles opnieuw.
- Een publicatie is een vaste geselecteerde snapshot. Bestaande links veranderen niet stilzwijgend naar een gewijzigde lokale audit.
- Controleer eigenaarschap en zichtbaarheid op de server, ook voor zoekresultaten, aggregaties en exports.
- Geautomatiseerde tests bij iedere aanpassing van normwaarden en detectieregels.
- Toegankelijkheid van extensie én webportaal is een harde releasevoorwaarde.
- Astro verzorgt webdocumenten en routing; React-islands hebben een concrete interactiefunctie en een expliciete laadstrategie. Geen volledige React-app als standaard paginaschil.
- README/quickstart, runtime-schema's en CI-commando's worden samen met de implementatie onderhouden; geen groene placeholders voor onuitgevoerde controles.
- Repository- en productieconfiguratie zijn beschreven en controleerbaar; secrets en gebruikersdata staan niet in Git.

### 13.3 Kerngebruiksscenario's

**US-01 — Eerste audit**\
Als websitebezoeker wil ik op **Scan deze website** klikken en zonder DevTools of technische instellingen een begrijpelijk rapport ontvangen, zodat ik mogelijke flitsproblemen kan herkennen.

**US-02 — Historiek behouden**\
Als auditor wil ik dat de resultaten na het sluiten van Chrome beschikbaar blijven, zodat ik de ontwikkeling van een website kan opvolgen.

**US-03 — Pass/fail per pagina**\
Als ontwikkelaar wil ik weten welke routes aan de daadwerkelijk geteste criteria voldoen en welke niet, met testdekking en onzekerheid, zodat ik geen foute conclusies trek.

**US-04 — Probleembron vinden**\
Als ontwikkelaar wil ik waar mogelijk naar het betrokken element springen, zodat ik snel een codewijziging kan doen.

**US-05 — Regressies herkennen**\
Als QA'er wil ik een nieuwe audit vergelijken met vorige versies, zodat ik nieuwe of teruggekeerde problemen zie.

**US-06 — Regel voorbereiden**\
Als gebruiker wil ik een bevestigde bevinding kunnen bewaren als kandidaat-blokkeerregel, zodat ik die later expliciet kan activeren.

**US-07 — Blocker uitschakelen**\
Als gebruiker wil ik iedere actieve regel direct kunnen uitschakelen, zodat ik normale websitefunctionaliteit kan herstellen.

**US-08 — Gegevens wissen**\
Als gebruiker wil ik één site of alle lokale auditdata vanuit de extensie kunnen verwijderen en mijn online rapporten afzonderlijk kunnen verwijderen of intrekken, met een duidelijk onderscheid tussen die acties.

**US-09 — Rapport via link delen**\
Als auditor wil ik de te delen inhoud controleren en een vaste rapportlink naar een ontwikkelaar kunnen sturen, zodat die mijn bevindingen zonder extensie of account kan lezen.

**US-10 — Publieke index doorzoeken**\
Als bezoeker wil ik op een domein zoeken en de publiek gedeelde audits met datum, herkomst en dekking zien, zodat ik weet wat daadwerkelijk onderzocht is.

**US-11 — Online historiek beheren**\
Als gebruiker wil ik mijn geselecteerde rapporten online terugvinden en hertests als nieuwe versies delen, zodat eerdere meetresultaten traceerbaar blijven.

**US-12 — Delen intrekken**\
Als publicerende gebruiker wil ik een deellink intrekken of een rapport privé maken, zodat de beheerde deelpagina en publieke index de inhoud niet langer tonen.

**US-13 — De website autonoom onderzoeken**\
Als gebruiker wil ik dat epi-less zelf pagina's ontdekt, scrolt, ondersteunde menu's opent en media onderzoekt, zodat ik geen handmatige rondgang moet uitvoeren.

**US-14 — Weten wat ontbreekt**\
Als gebruiker wil ik zien welke routes of scenario's niet gemeten zijn en waarom de scan stopte, zodat ik de beperkte uitkomst juist begrijp.

**US-15 — Verdiepen via DevTools**\
Als ontwikkelaar wil ik dezelfde autonome scan in DevTools kunnen volgen en technische details of aanvullende metingen openen, zodat ik bevindingen gericht kan onderzoeken.

**US-16 — Blokkeren bij serveruitval**\
Als gebruiker wil ik dat de blocker reeds gecontroleerde regels lokaal blijft toepassen als de server of CDN niet reageert, zodat uitval de bestaande werking niet uitschakelt.

---

## 14. Open technische beslissingen

Deze punten moeten **vóór implementatie of vóór een complianceclaim** met een kleine PoC of validatie worden beslist:

**Reeds beslist:** de gewone extensie voor niet-ontwikkelaars, autonome websitescan, DevTools-interface, online index, backend, deelbare rapporten en open-sourcelevering via de projectrepository horen bij P0. De website gebruikt Astro met selectieve React-islands en een eigen epi-less-vormgeving, met een kleine makercredit op de projectpagina. De officiële dienst wordt door de beheerder gehost met kostenbeheersing als randvoorwaarde. Onderstaande uitvoeringskeuzes veranderen die productscope niet.

| Beslissing | Voorgesteld startpunt | Waarom |
|---|---|---|
| Capture en scantab starten | Eén bewezen toolbar-startflow; DevTools gebruikt dezelfde route | De gewone scan mag niet afhangen van een geopend DevTools-paneel of toestemming per pagina. |
| Voortgangsinterface | Popup voor starten plus blijvend scherm, bijvoorbeeld side panel | Popup sluiten mag de job niet beëindigen. |
| Rendering zonder meekijken | Lokale scantab en capturecontext in PoC valideren, inclusief achtergrondstatus | Autonomie en meetkwaliteit moeten tegelijk haalbaar zijn zonder getoonde flitscontent als gebruikersflow. |
| Route- en actiebudget | 50 routes, diepte 4 en 20 minuten als voorlopige defaults | Begrensde eindtijd en eerlijke rapportage over resterende scope. |
| Browsercontext en sessies | Expliciete scantab; documenteer bestaand profiel en toegestane inspectiehandelingen | Geen impliciete toestemming voor transacties of accountwijzigingen. |
| Framesampling | Zo hoog en stabiel mogelijk; 60 fps als verzoek, niet als belofte | Aliasing en gemiste transities beïnvloeden geldigheid. |
| Video-extractie | `HTMLVideoElement`/`requestVideoFrameCallback` of equivalente route evalueren | Exacte timestamps en browserondersteuning controleren. |
| Worker-/GPU-versnelling | CPU-baseline, daarna optional WebGL/WebGPU waar beschikbaar | Kwaliteit en reproduceerbaarheid gaan voor snelheid. |
| HDR en kleurbeheer | Eerst sRGB/SDR met expliciete beperking, HDR apart valideren | Verkeerde conversie creëert foute uitkomsten. |
| WCAG-conformiteit | Regels pas als gevalideerd markeren na onafhankelijke referentietests | Vermijd schijnconformiteit. |
| Site-identiteit | Exacte origin; domeingroepering alleen voor weergave | Subdomeinen kunnen wezenlijk andere applicaties zijn. |
| DOM-fingerprint | Versiebeheer en confidence verplicht | Site-updates maken selectors instabiel. |
| Blocker op onbekende pagina's | Standaard uit | Nieuwe flitsen kunnen zichtbaar worden vóór detectie. |
| Historische beelden | Standaard geen frame-opslag | Privacy en lokale schijfruimte beschermen. |
| Astro/Cloudflare-integratie | Actuele onderling ondersteunde versies pinnen; statische routes, SSR, auth en D1 in PoC testen | Frameworkkeuze staat vast; runtimecompatibiliteit en precieze bindings moeten bewezen worden. |
| Hosting en database | De beheerder beheert Workers + D1 als voorkeursstartpunt; benchmark vóór release | Lage vaste kost en beperkte onderhoudslast; alternatief alleen met onderbouwde kosten/functionaliteit. |
| Authenticatie | Onderhouden oplossing met web- en extensieflow, minstens één toegankelijke aanmeldoptie naast eventueel GitHub | Eigenaarschap zonder onnodige vaste SaaS- of e-mailkosten; gewone gebruikers blijven ondersteund. |
| Upload en versiebeheer | Vaste snapshots, idempotente uploads, revisiecontrole en intrekking | Offline retries mogen geen dubbele of opnieuw zichtbare publicaties maken. |
| Bewaartermijnen en beheer | Concrete log-/backuptermijnen en verantwoordelijke voor meldingen vóór release vastleggen | Verwijderen en publieke meldingen moeten uitvoerbaar zijn. |
| Organisatie, domein en licentie | De projectbeheerder; exacte GitHub-slug/domein invullen bij inrichting, MIT als licentievoorstel | Geen fictieve repository-, download- of hostlinks publiceren. |
| Regelindex en CDN | Afzonderlijke publieke JSON-feed op R2/custom domain, lokale blockeropslag | Geen API/D1-afhankelijkheid voor downloads en geen netwerkafhankelijkheid voor toepassing. |
| Signing en updaterprotocol | Gecontroleerde sleutels, exacte payloadbinding, versies en bekende intrekkingen | Een CDN-download mag geen onbewezen regels of oude versies activeren. |

---

## 15. Bronnen en normatieve referenties

**W3C / WCAG**

- [WCAG 2.2 — volledige specificatie](https://www.w3.org/TR/WCAG22/)
- [WCAG 2.2, criterium 2.3.1 — Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold)
- [WCAG 2.2, criterium 2.3.2 — Three Flashes](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes)
- [WCAG 2.2, criterium 2.2.2 — Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide)
- [WCAG 2.2, criterium 2.3.3 — Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions)
- [Nederlandstalige WCAG 2.2-vertaling](https://www.w3.org/Translations/WCAG22-nl/)

**Chrome Extensions**

- [Chrome DevTools Panels API](https://developer.chrome.com/docs/extensions/reference/api/devtools/panels)
- [DevTools inspectedWindow API](https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow)
- [Chrome tabCapture API](https://developer.chrome.com/docs/extensions/reference/api/tabCapture/)
- [Audio Recording and Screen Capture — Chrome Extensions](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)
- [Offscreen Documents API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Manifest V3 Extension Service Workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers)

---

## 16. Open source en community

### 16.1 Eigenaarschap en distributie

- Een **publieke GitHub-repository binnen de projectorganisatie** is de centrale bron voor extensie, engine, webapp, API, migraties en documentatie. Officiële repository: [`Orka-digital/epiless`](https://github.com/Orka-digital/epiless).
- De beheerder beheert de officiële domeinnaam, hostingaccounts, Chrome Web Store-vermelding, releasekeys en productieomgeving. Communityleden dragen bij via issues, discussies en pull requests.
- De gewone extensie, DevTools-interface en backend blijven samen versieerbaar in één monorepo. Een bijdrage aan de engine hoeft geen productieaccount of toegang tot productie te vereisen.
- De Engelse README is de beknopte internationale ingang; deze Nederlandse specificatie blijft de uitgebreide productreferentie. Er komt geen badge, downloadknop of live-link die een nog niet bestaande release suggereert.
- De eerste ondersteunde eigen installatie gebruikt de gedocumenteerde Workers/D1-deployroute in een **eigen account**. Lokale ontwikkeling gebruikt de lokale runtime en testdata. Een volledig andere hostingstack is een latere bijdrage, geen onbewezen compatibiliteitsclaim.

### 16.2 Licentie en grenzen van openbaarheid

**Licentievoorstel: MIT voor eigen broncode en documentatie**, met correcte copyrightvermelding en behoud van toepasselijke dependencyvermeldingen. Vóór de eerste publieke coderelease wordt de volledige `LICENSE` toegevoegd met de correcte rechthebbende. MIT is een door OSI erkende open-sourcelicentie. [MIT bij OSI](https://opensource.org/license/mit)

- Licentiekeuze en `LICENSE` moeten overeenkomen in README, package-metadata en releasebestanden. De repository bevat inmiddels de MIT-licentie voor de eigen broncode en documentatie.
- De code-licentie geeft geen publicatierecht op privérapporten, persoonsgegevens, derdenmedia of merken van de oorspronkelijke maker. Publieke rapporten krijgen eigen duidelijke gebruiks-/exportvoorwaarden; een openbare link is geen automatische open-datalicentie.
- Testfixtures zijn synthetisch of aantoonbaar herbruikbaar. Geen klantdata, echte sessiecookies, incidentcaptures met persoonsgegevens of risicovolle videobestanden in Git.
- Secrets, productiedumps en moderatiegegevens blijven buiten de repository en openbare CI-artifacts. `.env.example` bevat uitsluitend namen en veilige voorbeeldwaarden.

### 16.3 Communitydocumentatie vanaf de eerste release

| Bestand | Concrete inhoud |
|---|---|
| `README.md` | Doel, actuele status, eenvoudige instap, architectuur, bijdragen en officiële hosting; concept in §18. |
| `LICENSE` | Volledige gekozen licentie, correcte rechthebbende. |
| `CONTRIBUTING.md` | Lokale installatie, testcommando's, kleine PR's, relevante fixtures, changelog en reviewproces. |
| `CODE_OF_CONDUCT.md` | Gedragsregels en daadwerkelijk beheerd contactkanaal. |
| `SECURITY.md` | Ondersteunde versies, private kwetsbaarheidsmelding en wat niet in openbare issues hoort; geen fictieve responstijd. |
| `GOVERNANCE.md` | projectmaintainers, besluitvorming, reviewrollen, nieuwe maintainers en noodprocedure. |
| `CHANGELOG.md` | Wijzigingen per versie, meetregelwijzigingen en migraties. |
| `.github/CODEOWNERS` | Werkelijke teams voor engine, runner, backend, workflows en documentatie. |
| `.github/ISSUE_TEMPLATE/` | Bug, detectorbevinding, feature en documentatie; vraag versies/reproductie zonder gevoelige inhoud. |
| `.github/PULL_REQUEST_TEMPLATE.md` | Probleem, resultaat, relevante validatie en impact op meetregels, migratie of kosten. |
| `docs/development.md` / `docs/self-hosting.md` | Geteste lokale setup en eigen deployment zonder productiesecrets. |
| `docs/operations.md` / `docs/costs.md` | Backup/herstel, intrekken, incidenten, gebruiksmetingen en bijgewerkte begroting. |
| `docs/abuse-protection.md` | Turnstile-keys/hostnames, actiebeleid, limiterconfiguratie, WAF-scope, uitval en eigen installatie. |

Bijdragen aan vertaling, begrijpelijkheid, toegankelijkheid en numerieke detectorfixtures zijn even welkom als code. Labels zoals `good first issue` krijgen een concrete afbakening en verwachte uitkomst. Een bot sluit inhoudelijke problemen niet alleen wegens inactiviteit.

---

## 17. Goedkope hosting en kostenbeheersing

### 17.1 Minimale officiële hosting

**Voorkeursstartpunt:** één Astro-deploy op Cloudflare Workers voor de API en dynamische index-/rapportpagina's, Static Assets voor vooraf gebouwde pagina's en bestanden, één D1-database voor compacte rapporten en indexmetadata en een aparte publieke R2/CDN-feed voor regeldata. De beheerder is eigenaar van de dienst. Scans blijven lokaal; de index heeft geen server-side browserfarm, AI-aanroepen, Redis, externe zoekcluster of permanent draaiende VPS nodig.

- Zoek op genormaliseerd domein, status, datum en criterium met gerichte SQL-indexen en cursorpaginering. Geen volledige rapportsnapshots lezen om een lijst met 25 sites te tonen.
- Bereken samenvattingen bij publicatie/intrekking en bewaar deze als herberekenbare metadata. Vermijd een volledige herberekening van alle audits bij iedere paginalaad.
- Sla alleen gecontroleerde samenvattingen en noodzakelijke bevindingen online op. Frame-events, alle actiedetails en ruwe beelden blijven lokaal tenzij ze binnen de expliciet geselecteerde compacte tekstsnapshot vallen.
- Serveer statische webassets via de assetroute en de vrijgegeven JSON-regelindex via de aparte CDN-host. Auditrapportinhoud en toegang blijven via de gecontroleerde serverlaag (SSR/API) lopen. In P0 geen gedeelde cache voor dynamische rapport- en zoekresponses: intrekken moet direct effect hebben op nieuwe opvragingen. Het eigen cache-/offlinebeleid voor publieke regels staat in §20.
- D1-specifieke toegang blijft achter `server-storage`; SQLite-schema, migraties en data-export worden gedocumenteerd. D1 is niet uitwisselbaar met PostgreSQL zonder migratiewerk.
- De Astro-build en adapterconfiguratie worden op extra diensten gecontroleerd: geen automatisch toegevoegde betaalde afbeeldingsbewerking, KV-sessies of andere bindings zonder expliciete noodzaak en begroting. Informatieve statische routes mogen geen algemene auth-/databasemiddleware activeren; details in §21.

### 17.2 Prijsmomentopname en budget

**Gecontroleerd op 26 oktober 2026; USD, exclusief belastingen, domein en eventuele auth-/mail-/backupkosten.** Dit is een startbegroting op basis van gepubliceerde tarieven, geen onbeperkte prijsbelofte.

| Scenario | Verwachte basis | Voorwaarden |
|---|---:|---|
| Klein prototype | **$0/maand** aan Workers/D1-abonnement | Binnen de gratis request-, CPU-, database- en opslaglimieten; overschrijding kan beschikbaarheid beperken. |
| Kleine officiële index | **Vanaf $5/maand** aan Workers Paid | Binnen inbegrepen verbruik; extra requests, CPU en databaseverbruik kunnen de factuur verhogen. |
| Werkbudget voor de start | **$5–10/maand als streefbedrag** voor indexhosting | Projectdoel, geen providerplafond; pas na loadtest en inclusief overige gekozen diensten de volledige begroting vaststellen. |

Workers Paid heeft een minimum van $5 per account per maand, met onder meer 10 miljoen dynamische requests en 30 miljoen CPU-ms inbegrepen. Rechtstreeks geserveerde statische assets zijn gratis; een dynamische Worker-route blijft meetellen. Het gratis plan kent onder meer 100.000 dynamische requests per dag en 10 ms CPU per aanroep. [Workers-prijzen](https://developers.cloudflare.com/workers/platform/pricing/)

D1 Free omvat 5 miljoen gelezen en 100.000 geschreven rijen per dag. Paid omvat 25 miljard gelezen rijen, 50 miljoen geschreven rijen per maand en 5 GB opslag; daarboven gelden verbruikstarieven. Queries tellen **gelezen rijen**, niet alleen teruggegeven resultaten. Bij overschrijding van gratis limieten kunnen queries falen. [D1-prijzen](https://developers.cloudflare.com/d1/platform/pricing/)

Let op het verschil tussen accountopslag en één database: **500 MB per database op Free, 10 GB op Paid**. Een gratis accounttotaal van 5 GB betekent geen gratis database van 5 GB. D1 kent ook een rijlimiet van 2 MB; houd rapportsnapshots daar ruim onder. [D1-limieten](https://developers.cloudflare.com/d1/platform/limits/)

**Rekenvoorbeeld, geen voorspelling:** 10.000 rapporten van gemiddeld 100 KiB gebruiken ongeveer 0,95 GiB voor de snapshotinhoud alleen. Metadata, indexen, accounts en backups komen erbij. Dit past niet in één gratis database van 500 MB. Meet de werkelijke opslagverhouding op representatieve fixtures voordat een rapportcapaciteit wordt gecommuniceerd.

Inbegrepen accountverbruik kan met andere projecten worden gedeeld. Begroot epi-less op het werkelijk beschikbare aandeel en tel bestaande abonnementen niet automatisch als onbeperkte gratis capaciteit.

### 17.3 Concrete kostenbegrenzing

- Uploadlimiet: **1 MiB ongecomprimeerde, gevalideerde JSON per rapport**; streef naar gemiddeld maximaal 100 KiB. Te grote uploads krijgen een begrijpelijke fout en een nieuwe preview voor een compactere selectie, geen stille afkapping van bevindingen of scope.
- Voorlopige standaardquota voor de officiële dienst: **10 nieuwe rapporten per account per dag en 25 MiB actieve rapportopslag per account**. Retry van dezelfde upload telt niet als nieuw rapport. Quota zijn server-side configureerbaar en zichtbaar vóór upload; de gebruiker kan lokaal blijven scannen/exporteren.
- Begrens zoekresultaten tot 25 items per pagina, parameterlengte, requests per account/IP, maximale querytijd en CPU per API-aanroep. Voorkom brede `LIKE '%...%'`-scans op ieder toetsaanslagverzoek.
- Volg minstens dynamische requests, CPU, gelezen/geschreven rijen, opslaggroei en grootste payloads. Gebruik geaggregeerde operationele metingen zonder rapportinhoud of tokens te loggen.
- Waarschuw bij 50%, 80% en 95% van het ingestelde operationele budget/quotum. Dit zijn applicatie-/beheermaatregelen, geen garantie op een harde providerfactuurstop. Bij dreigende overschrijding eerst nieuwe uploads begrenzen en bestaande rapporten/intrekkingen beschikbaar houden.
- Geen betaalde auth-/maildienst of AI-reviewbot als stilzwijgende afhankelijkheid. Kies een onderhouden auth-oplossing met een aantoonbare startkost; naast eventueel GitHub moet ook een geschikte optie voor gewone gebruikers beschikbaar zijn.
- Productie, staging, backups en CI-storage tellen mee in de kostenraming. Staging gebruikt synthetische data en kleine quota; geen databasekopie per community-PR.
- CDN-objectopslag, downloads en periodieke feedchecks tellen afzonderlijk mee. Gelijkblijvende bestanden worden via hashes/ETag hergebruikt; de blocker maakt geen dure originlookup per sitebezoek.
- Turnstile Free is het startpunt voor antispam; extra Worker-verificaties, limiterverkeer, databasewrites en eventuele betaalde WAF-opties worden afzonderlijk begroot. Geen verplicht Enterprise Bot Management-abonnement. Zie §9.5.
- Meet vóór release de endpoints met minstens 10.000 synthetische rapporten: domeinzoeken, sitepagina, rapport openen, publiceren en intrekken. Leg queryplannen, row reads/writes, opslag en CPU vast in `docs/costs.md`.

### 17.4 Backups, herstel en doorgroeien

- Gebruik het beschikbare D1 point-in-time-herstel en documenteer de planlimieten. Time Travel biedt momenteel 7 dagen op Free en 30 dagen op Paid. [D1 backupdocumentatie](https://developers.cloudflare.com/d1/reference/time-travel/)
- Bewaar daarnaast dagelijks een versleutelde export in door de beheerder beheerde **private** opslag, met een vastgelegde korte rotatie en een apart doorgerekende opslagkost. Geen database-export als artifact van een publieke GitHub-run.
- Bewaar verwijderings-/intrekkingsinformatie zodanig dat herstel geen ingetrokken publicaties opnieuw ontsluit; test dit bij de eerste release en na wijzigingen aan herstel of schema.
- App-rollback en dataherstel zijn verschillende procedures. Migraties blijven eerst achterwaarts compatibel; destructieve stappen volgen pas nadat de oude appversie niet meer nodig is en herstel getest is.
- Evalueer meer capaciteit of PostgreSQL pas bij gemeten knelpunten, zoals opslag die richting de limiet per database groeit, niet-passende transactie-eisen of structureel dure queries. Leg de vergelijking inclusief onderhoud en migratiewerk vast.

---

## 18. README en ontwikkelervaring

### 18.1 README-kwaliteitslat

De README moet in ongeveer een minuut duidelijk maken **wat epi-less doet, wat vandaag bestaat, hoe iemand begint en hoe iemand bijdraagt**. Engels als hoofdtaal; korte paragrafen, rustige vormgeving, één statische screenshot zodra er echte UI is. Geen geanimeerde flitsdemo, badgewand, verzonnen score of marketingclaim over medische veiligheid.

- Bovenaan de actuele projectstatus en een concreet productdoel.
- Alleen werkende links naar officiële index, releases en store zodra die werkelijk bestaan; tot dan de status eerlijk benoemen.
- Maximaal enkele relevante badges nadat CI/licentie/releases bestaan. Een groene CI-badge bewijst geen normvalidatie.
- Gebruikers krijgen een eenvoudige start; contributors krijgen versievereisten en een korte lokale quickstart. Uitgebreide architectuur, API's en operatie horen in aparte docs.
- README-commando's en interne links worden vanuit een schone checkout gecontroleerd. Een spec-only repository toont geen fictieve installatiehandleiding voor nog niet bestaande code.

### 18.2 README van de lokale implementatie

Onderstaande tekst is de volledige actuele Engelse README, bijgewerkt op 27 oktober 2026. [`README.md`](README.md) is de leesbare ingang van de repository; deze kopie bewaart de gevraagde README ook in de productspecificatie. Werk beide samen bij. De repository is voorlopig privé op verzoek van de eigenaar; publieke communityontwikkeling blijft de beoogde vervolgstap. Er is geen officiële hosted release of Chrome Web Store-versie.

````markdown
# epi-less

**Find and investigate flashing web content, directly in Chrome.**

epi-less scans websites locally, records when and where suspicious changes occur, and gives you measurements to investigate them. Start capture from the toolbar; follow and control the same scan in DevTools. Keep reports on your device, export them, or deliberately share a reviewed snapshot through the web application.

A community project for investigating flashing web content. Contributions to detection, accessibility and documentation are welcome.

> **Development preview · open for contributions.** The local P0 workflow runs; scanner 0.4 remains a candidate implementation with unresolved capture and validation gates. There is no official hosted service or Chrome Web Store release yet. The scanner produces review candidates, not a validated WCAG verdict or medical safety guarantee.

[Quickstart](#quickstart) · [First scan](#your-first-scan) · [Detection quality](#detection-quality) · [Contributing](#contributing) · [Documentation](#documentation)

## What you can do

- **Scan automatically.** Discover same-origin routes, scroll through content and exercise supported menus, tabs, disclosures, carousel states and muted media. Bounded focus, delayed-state observations and samples across existing seekable video loops extend the plan; the optional advanced build adds real browser hover in its own temporary scan tab. A bounded compact profile uses a temporary background window; the ordinary scan returns its tab, while the advanced scan closes its own tab after stopping or finishing; unsupported or interrupted states remain explicit. Quick and extended modes observe just the current viewport.
- **Investigate a finding.** Read static luminance/red-ratio plots, exact RGB samples and simultaneous pixel-area evidence. A bounded DOM timeline adds geometry, mutations, animation timing and video position near the estimated event window. Open a retained original element in DevTools while its local reference remains valid.
- **Check a proposed fix.** Save a local review, rerun the recorded scenario and compare compatible measurements. Rechecks must cover the original document/animation phase and, for video, the recorded clip interval and presentation sequence. Missing or poor-quality evidence cannot resolve an issue. Keep local history and export standalone HTML or JSON without replaying suspect content.
- **Share deliberately.** Review routes, text and optional diagnostics before choosing private, unlisted or public visibility. Manage links, withdraw reports and search the public index in your own running instance.

![epi-less's report interface with synthetic measurements, an expanded diagnostic chart and scan context](docs/images/diagnostic-report.png)

_Actual application UI with synthetic example data. The graph is static; this is not an audit of example.org._

## Quickstart

You need **Node.js 24.19.0**, **pnpm 11.13.1**, Git and access to this repository. Use Chrome to run the extension. Chrome 116 is the API minimum; the recorded native capture tests use Chrome for Testing 156 on macOS, not a full browser/OS compatibility matrix.

### 1. Start the local web application

```sh
git clone https://github.com/Orka-digital/epiless.git
cd epiless
pnpm install --frozen-lockfile
pnpm setup:local
pnpm dev
```

Open **<http://localhost:4321>**. The [example report](http://localhost:4321/voorbeeld/) lets you explore the interface before scanning anything.

Setup creates local configuration and applies local D1 migrations. No Cloudflare login, production credentials or remote database is needed. There is no demo account: create one at `/account` when you want to test sharing. Development uses a local challenge fixture and sends no email, so email-based password recovery is unavailable locally.

### 2. Build and load the extension

In a second terminal, from the repository root:

```sh
EPI_LESS_WEB_URL=http://localhost:4321 pnpm --filter @epi-less/chrome-extension build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select **`apps/chrome-extension/dist`**. Pin epi-less to the toolbar.

Scanning itself needs neither an account nor a running epi-less web server. The web application is used to publish and manage shared reports.

<details>
<summary>Using a different local port</summary>

Keep the configured web origin, extension build and browser tests aligned:

```sh
EPI_LESS_PORT=4387 pnpm setup:local
EPI_LESS_PORT=4387 pnpm dev
```

In the second terminal:

```sh
EPI_LESS_WEB_URL=http://localhost:4387 pnpm --filter @epi-less/chrome-extension build
```

Open `http://localhost:4387`. Rebuild and reload the extension when its publication origin changes. Also prefix later `pnpm build` and `pnpm dev:extension` commands with `EPI_LESS_WEB_URL=http://localhost:4387`; otherwise they rebuild for the default port. For browser checks, also set `EPI_LESS_PORT=4387` on web tests and `EPI_LESS_WEB_URL=http://localhost:4387` on extension tests.

</details>

## Your first scan

1. Open a normal HTTP(S) website you intend to inspect. The autonomous scanner navigates the **current tab in your current browser session**.
2. Open epi-less from the toolbar, choose **Hele website · automatisch** and select **Scan deze website**. Quick and extended modes use **Start viewportmeting** instead. Grant the requested browser permission. The current interface is in Dutch.
3. Let the runner explore supported routes and interactions. You can follow progress, pause or stop; captured segments remain available.
4. Open a finding's **Technische diagnose bekijken** panel. Check its measurements together with frame quality, observed scenarios and skipped work.
5. Export locally, or choose **Uploadvoorbeeld openen** to review a snapshot in the web application. Nothing is published by opening that preview.

The optional [advanced build](apps/chrome-extension/README.md#optional-advanced-interactions) prepares a separate scan tab and requires a real toolbar start on that tab. It keeps your original page intact. After that authorization, exploration and cleanup are automatic.

The default autonomous budget is 50 routes, depth 4, 20 minutes and 12 actions per route. Form submissions, transaction-like actions, unsupported controls and blocked states are excluded by policy. These limits are recorded; they do not establish complete site coverage. See the [extension guide](apps/chrome-extension/README.md) for supported actions and capture constraints.

## Detection quality

The engine looks for general luminance and saturated-red flash candidates in captured pixels. Reports distinguish the result from whether the runner finished its plan:

| Report status        | Meaning                                                         |
| -------------------- | --------------------------------------------------------------- |
| `NEEDS_REVIEW`       | Candidates were observed and need investigation.                |
| `NO_ISSUES_OBSERVED` | No candidates were observed in the measured scope.              |
| `INCONCLUSIVE`       | Capture or coverage was insufficient for a reliable conclusion. |

A stopped or failed runner can still retain useful segments; inspect its job state and stop reason separately. Every report keeps `passed: null`. Read the findings even when a report is inconclusive: insufficient capture does not erase an observed candidate. A completed route plan is not a safety or conformance verdict.

Engine **0.4.0-candidate** preserves native pixels within a **2,073,600-pixel budget** (1920 × 1080) and bounds retained analysis state to 256 MiB. Larger sources are rescaled and disclosed. Its bundled WASM kernel preserves Float64 calculations and shared histories. Current changes retain one complete spatial witness and constrain source clues to the actual event window; numeric regressions and real Chrome control-flow tests cover these changes.

On this Mac, recorded build **`6770f520…`** passes controlled desktop and compact captures of a tiny video candidate over a dense background and from an encoded VP9 file, around 60 fps. A separate native signal → fixed video → signal recheck preserves all **53 actual frame-presentation timestamps** across the same clip. That build's comparison reports **not observed** after the fix and **reobserved** after its return. This is one controlled seekable-video case, not general video or hardware validation.

The subsequent replay guard records document and animation clocks: reloading a page and measuring too early must not miss an unchanged delayed effect and count as repair evidence. A fresh native chain on **`7fc0a67c…`** passes the stricter comparison: **307/315/315 frames near 60 fps at 1800 × 1126**, all 53 video presentations and complete original document-interval coverage, with **not observed → reobserved** after fix and recurrence. This proves that selected scenario on this Mac; the baseline whole-site scan remains partial. Older scans lack phase evidence and cannot support a new negative comparison. The dashboard explains missing phase/media evidence and shows the measured timing; historical reports and reviews stay intact.

An existing-loop fixture also passes with 310 captured frames near 60 fps and two independently observed loop boundaries. It uses an artificial moving, low-contrast four-pixel marker; the whole job remains partial and inconclusive because other states were not reached. A bounded loop sample is not a whole-video test.

The earlier dense/encoded fixtures retain `MEDIA_REPLAY_NOT_REPRODUCIBLE`; their capture success does not erase missing replay evidence. Advanced cancellation releases resources, but exact CSS-height restoration still fails. The [quality record](docs/SCANNER-QUALITY.md) and [capture record](docs/CAPTURE_VALIDATION.md) preserve each fixture’s build identity, successes and failures. These results establish neither whole-site safety nor state-of-the-art performance.

DOM samples are collected during observation, with bounded read intervals and animation/video timing, then aligned through recorded per-frame receipt timestamps. The event window remains **estimated**. Capture-to-DOM latency remains unknown; these are source candidates and repair clues, not proof of which element flashed. Native observations sum simultaneous regions within W3C's **341 × 256 CSS-pixel reference field** at standard page and pinch zoom. Verified native DPR maps this to source pixels: **682 × 512 at DPR 2**. Rescaling, uncertain mapping, or a viewport/zoom change removes that reference comparison while retaining the pixel candidate. Actual screen geometry and viewing distance are not measured; this is not physical calibration or a WCAG verdict. Motion, fine-pattern hints and reference-area results never automatically dismiss a finding. Targeted rechecks require the same cold-build source fingerprint as well as compatible state, geometry and adequate capture.

Seekable file-video rechecks also require matching playback settings and the original, actually presented frame timestamps. Stalled, missing or uncertain presentations cannot support a negative comparison; live, unseekable or over-24-hour media are unsupported. The locally stored source-locator hash identifies an address, **not file contents**; editing a video at that address can be the fix. Playback metadata and replay plans stay local. A bounded loop sample is not a whole-video test, and “not observed again” never automatically means “resolved”.

The expanded independent TRACE numeric comparison scores **398 cases: 129 expected positives found, 0 missed, 18 extra candidates and 251 negatives matched**. Two malformed originals remain unscored. A separate lossless decoded-media comparison scores 36 cases against the upstream CSV labels: **14 found, 4 missed, 0 extra and 18 negatives matched**. The spatial corpus contains conflicting labels; the unchanged JSON labels and exact mask totals are also reported separately. These selected sets now serve as regression references, not real-world accuracy estimates. A [source-backed numeric review](docs/DETECTION-DISAGREEMENTS.md) explains the original staircase disagreements and the expanded set: seven transitions and complete peak-to-valley excursions matter; one delayed red excursion remains ambiguous. Original labels and scores stay unchanged.

```sh
pnpm validate:detection --check-baseline
pnpm validate:expanded --check-baseline
# Requires ffmpeg and ffprobe; encodes/decodes files without playing them.
pnpm validate:spatial-media --check-baseline
```

CI rejects new case-level disagreements without relabelling the external reference. Read the [reference method and licenses](tests/reference/README.md), [spatial/media evidence](tests/reference/trace-spatial/README.md), [scanner quality record](docs/SCANNER-QUALITY.md) and [native capture evidence](docs/CAPTURE_VALIDATION.md) for the exact scope and remaining gaps.

## Data and sharing

Frames are analysed locally. Raw video and screenshots are not persisted in reports; a finding can retain a bounded numeric trace from one representative pixel. Local history stays on the device unless you choose to export or share it.

Publication defaults replace route paths and redact original free text. Pixel traces, spatial details and source timelines require a separate diagnostic opt-in. Local inspection tokens, review notes and replay controls are not published; pseudonymized exports remove source timelines, media playback metadata and replay context. The preview shows exactly what will be sent; origin, timestamps, versions and basic measurements remain present. Approved uploads survive offline interruptions and remain bound to the approving account.

| Visibility | Access                                                         |
| ---------- | -------------------------------------------------------------- |
| Private    | The owner's authenticated session.                             |
| Unlisted   | Anyone holding the share link; excluded from the public index. |
| Public     | Publicly readable and eligible for the searchable index.       |

Withdrawal stops subsequent server access; downloaded copies remain outside the service's control. Removing local history and removing an online publication are separate actions. Repository visibility does not determine report visibility.

## Architecture and hosting

| Workspace                                              | Responsibility                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [`apps/chrome-extension`](apps/chrome-extension)       | Chrome MV3 runner, capture worker, toolbar/DevTools UI, local storage and exports.                           |
| [`packages/analysis-engine`](packages/analysis-engine) | Streaming pixel analysis, exact simultaneous masks and bounded temporal diagnostic traces.                   |
| [`packages/core`](packages/core)                       | Report contracts, validation, privacy policy helpers and static report rendering.                            |
| [`apps/web`](apps/web)                                 | Astro, focused React islands, accounts, report management and the searchable index on Cloudflare Workers/D1. |
| [`packages/rule-feed`](packages/rule-feed)             | Signed, versioned JSON feed with integrity, expiry and rollback checks.                                      |

Scans run on the user's device, avoiding hosted browser workers. Ordinary report pages need no application JavaScript. Turnstile and server-side rate limits protect account and publication flows; reading public reports does not require a challenge. See [self-hosting](docs/self-hosting.md) and the [cost model](docs/costs.md) for configuration and measured boundaries.

The **signed rule feed is groundwork for a later blocker**. Its approved rule set is empty; offline blocking and a durable updater are not implemented. The intended CDN feed is separate from access-controlled audit reports. Private and revocable reports must not enter a public static cache. Details are in the [feed protocol](packages/rule-feed/README.md).

## Development and checks

Run commands from the repository root. After local setup:

```sh
pnpm check
pnpm test
pnpm validate:detection --check-baseline
pnpm validate:expanded --check-baseline
pnpm build
```

For browser checks, **stop the local web server first**. The suites start their own preview or fixture on the configured port; run them sequentially after building:

```sh
pnpm exec playwright install chromium
pnpm test:web-quality
pnpm --filter @epi-less/chrome-extension test:browser
pnpm test:review-ui
```

`pnpm check` also checks unused code/dependencies and typechecks the JavaScript build, CI and validation helpers. The [codebase map](docs/CODEBASE.md) explains module ownership and the limits of these checks.

`pnpm verify:quickstart` combines local setup, checks, unit/integration tests and builds; browser checks are separate. For extension development, `pnpm dev:extension` watches TypeScript; reload the unpacked extension after changes. See [development notes](docs/development.md) for custom origins, native capture fixtures and troubleshooting.

The recorded `6770f520…` checkpoint passed `pnpm check`, **423 unit/integration tests across 45 files** and all seven then-current extension browser scripts. Later changes and their validation are tracked in the [implementation status](docs/IMPLEMENTATION.md). Native capture evidence has the separate scope described above.

The [CI workflow](.github/workflows/ci.yml) covers types, formatting, documentation, builds, tests, numeric and lossless-media detection regressions, and browser quality on pull requests and merge groups. The full spatial/media check requires FFmpeg; CI installs it explicitly. Workflow definitions are included; actual GitHub rules and release permissions are separate configuration. The [governance guide](GOVERNANCE.md) describes review and merge expectations.

## Contributing

While the repository is private, contributions are limited to people with access. Start with [CONTRIBUTING](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Useful work includes independently sourced detection cases, capture reliability, accessible diagnostics and documentation.

Keep a pull request focused on a concrete problem and show how the change was verified. Use synthetic data and numeric fixtures. Report security issues through the private channels described in [SECURITY](SECURITY.md); keep credentials, private browsing data and flashing recordings out of issues and CI artifacts.

## Documentation

Start with the [codebase map](docs/CODEBASE.md) for module ownership and maintenance checks, and the [validation map](docs/VALIDATION.md) to distinguish current gates from historical evidence.

| Looking for…                              | Read                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Implemented scope and remaining work      | [Implementation status](docs/IMPLEMENTATION.md) · [P0 acceptance map](docs/P0-ACCEPTANCE.md)            |
| Detection evidence and limitations        | [Scanner quality](docs/SCANNER-QUALITY.md) · [Reference comparison](tests/reference/README.md)          |
| Browser capture evidence                  | [Capture validation](docs/CAPTURE_VALIDATION.md)                                                        |
| Local setup and development               | [Development](docs/development.md) · [Extension guide](apps/chrome-extension/README.md)                 |
| Deployment, abuse protection and recovery | [Delivery](docs/DELIVERY.md) · [Turnstile](docs/abuse-protection.md) · [Operations](docs/operations.md) |
| Product decisions and changes             | [Dutch product specification](epi-less-audit.md) · [Changelog](CHANGELOG.md)                            |

## License and stewardship

Original code and documentation use the [MIT License](LICENSE). Dependencies and the [TRACE reference fixtures](tests/reference/trace-pse/upstream/LICENSE) retain their own licenses; see [third-party notices](docs/THIRD_PARTY_NOTICES.md).

Project credits: Orka Digital. See [governance](GOVERNANCE.md) for project stewardship and contributions.

Technical compatibility: legacy storage keys and signed-feed identifiers remain unchanged so existing local data and signatures stay valid. Historical validation artifacts retain their original bytes. The product and workspace packages use **epi-less**; local development variables use `EPI_LESS_*`.
````

### 18.3 Quickstartcontract van de lokale implementatie

De workspace en onderstaande scripts bestaan. Node staat vast in `.nvmrc` en `package.json`, pnpm in `packageManager`; de lockfile wordt mee beheerd. Lokale ontwikkeling vereist geen productieaccount, Cloudflare-login of productiesecrets.

```bash
pnpm install --frozen-lockfile
pnpm setup:local
pnpm dev
```

`setup:local` maakt development-configuratie met lokale secrets aan en voert D1-migraties uit met `--local`. Er worden geen demo-account, synthetische seeds of remote resources aangemaakt. `dev` start de webapp/API; de extensie wordt in een tweede terminal afzonderlijk gebouwd:

```bash
EPI_LESS_WEB_URL=http://localhost:4321 pnpm --filter @epi-less/chrome-extension build
```

Laad `apps/chrome-extension/dist` via **Load unpacked** in Chrome. De scan zelf heeft geen epi-less-server of account nodig. Voor delen maak je lokaal een account aan. Lokale registratie verstuurt geen mail; wachtwoordherstel via email werkt daarom niet in deze development-configuratie.

Bij een andere poort moeten `EPI_LESS_PORT` voor setup/webtests en `EPI_LESS_WEB_URL` voor elke extensie-/workspacebuild, watchmodus en extensietest dezelfde origin gebruiken. Stop de lokale webserver vóór browsertests; de tests starten hun eigen preview/fixture en draaien na elkaar.

| Script | Geïmplementeerd gedrag |
|---|---|
| `pnpm check` | TypeScript, `astro check`, formattering en document-/workflowvalidatie. |
| `pnpm test` | Unit- en integratietests voor engine, runner, contracten, autorisatie, publicatie en operatie. |
| `pnpm test:integration` | Backendtests met de echte migraties/SQL in lokale in-memory SQLite, plus publicatie- en clientbeleid; geen productie-D1. |
| `pnpm validate:detection --check-baseline` | Externe numerieke referenties verifiëren en nieuwe afwijkingen per geval weigeren; bekende verschillen blijven zichtbaar. |
| `pnpm test:e2e` | Playwright-webflows tegen de lokale productiepreview; geen native capture-autorisatie. |
| `pnpm test:web-quality` | Bundlebudgetten en volledige websuite, inclusief mobiele labmetingen, toegankelijkheid en publicatieflows. |
| `pnpm --filter @epi-less/chrome-extension test:browser` | Chrome-extensieopslag, UI, exports, overdracht en DOM-acties; echte toolbar-capture blijft afzonderlijk bewijs. |
| `pnpm build` | Web- en extensiebouw met de huidige configuratie; stel de publicatie-origin expliciet in bij een afwijkende poort. |
| `pnpm verify:quickstart` | Lokale setup, checks, unit-/integratietests en builds; browsercontroles draaien afzonderlijk. |

De [implementatievoortgang](docs/IMPLEMENTATION.md) en [capturevalidatie](docs/CAPTURE_VALIDATION.md) leggen vast welke bewijsstukken bij welke build horen. Een README-wijziging alleen is geen nieuwe volledige quickstart- of productievalidatie.

---

## 19. Mergebeleid, GitHub Actions en releases

### 19.1 Branches en review

- Bescherm `main`: wijzigingen via pull requests, geen force-push of branchverwijdering, gesprekken opgelost en vereiste checks geslaagd op de te mergen combinatie.
- Standaard **squash merge**, korte branches en automatisch opruimen na merge. PR-titel beschrijft het gedrag; releases verwijzen naar de resulterende commit.
- Eén onafhankelijke maintainerreview als minimum; gewijzigde code na review moet opnieuw worden beoordeeld. Engine-/drempelwaarden, actiepolicy, permissies, auth, migraties en workflows krijgen de passende code-ownerreview.
- Codeowners zijn werkelijke maintainerteams, geen voorbeeldhandles. Een bot of AI-review vervangt de inhoudelijke review niet.
- Als de beheerder voorlopig maar één maintainer heeft, geen onhaalbare self-approvalprocedure invoeren: documenteer een beperkte, gelogde beheerdersuitzondering voor eigen PR's in `GOVERNANCE.md`. Checks blijven verplicht; voeg een tweede maintainer toe voor de normale onafhankelijke route.
- Release-tags en de productieomgeving zijn alleen door releasebeheerders te bedienen. Een goedgekeurde communitybijdrage krijgt geen deployrechten.

Deze instellingen worden als controleerbaar repositoryconfiguratiecontract vastgelegd; alleen een workflowbestand toevoegen beschermt `main` niet. [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

### 19.2 Merge queue en auto-merge

Een merge queue is beschikbaar voor publieke repositories van een organisatie. Configureer de vereiste checks ook voor `merge_group`, zodat de combinatie met de actuele `main` wordt getest. Start met maximaal één gelijktijdige mergegroep; gebruik squash en laat alleen afzonderlijk geslaagde PR's toe. [GitHub merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)

- Een maintainer kan een gereviewde PR in de queue plaatsen of auto-merge toestaan. De queue omzeilt reviews of checks niet.
- Vereiste checknamen zijn stabiel en bestaan voor zowel PR- als mergegroep-events. `CI / required` is het aggregatiepunt en wordt ook na mislukte onderliggende jobs uitgevoerd.
- Een docs-only wijziging krijgt nog steeds documentvalidatie en een positief of negatief aggregatieresultaat. Geen `paths-ignore` op de volledige verplichte workflow waardoor GitHub eindeloos op een niet-gerapporteerde check wacht.
- Begin eenvoudig met een compacte CI-suite voor elke PR. Selectief zware tests overslaan komt pas later, met een expliciete wijzigingsclassificatie en een aggregatiejob die onverwacht overgeslagen jobs afkeurt.
- Dependabot maakt gegroepeerde wekelijkse updates voor dependencies en Actions. Patch/minor-updates kunnen pas automatisch mergen na dezelfde checks en vereiste review; geen ongecontroleerde auto-merge van engine-, auth-, build- of major-updates.

### 19.3 Vereiste workflows

| Workflow | Trigger | Uitkomst |
|---|---|---|
| `ci.yml` | `pull_request`, `merge_group`, push op `main` | Check, unit/integratie, gerichte Chrome/web-E2E, webprestatiebudgetten, build en verplichte aggregatiecheck. |
| `security.yml` | `pull_request`, `merge_group`, push op `main`, wekelijks | Statische analyse en dependencycontrole; concrete nieuwe bevindingen blokkeren volgens gedocumenteerd beleid, uitzonderingen hebben reden en einddatum. |
| `deploy-staging.yml` | Na geslaagde CI én security op een push naar `main` | Kleine gedeelde staging met synthetische data, exact geteste commit; rooktest van publiceren, openen en intrekken. |
| `release.yml` | Beschermde versietag van de beheerder | Tag/commit en checks valideren; changelog, manifestversie, ZIP, hashes en bronverwijzing als release-artifacts. |
| `publish-feed.yml` | Gereviewde regelrelease; geplande vernieuwing van al goedgekeurde inhoud | Publieke projectie controleren, ondertekenen, vaste JSON publiceren/verifiëren en pas daarna `latest.json` promoveren. |
| `deploy-production.yml` | promotie van een gevalideerde release | Gecontroleerde migratie, deploy van exact goedgekeurde versie en functionele livecontrole. |

Alleen workflows die werkelijk bestaan en succesvol draaien krijgen badges of required-checkconfiguratie. Een vervolgworkflow controleert event, repository, branch, commit en alle benodigde uitkomsten; een willekeurige geslaagde PR-run mag geen stagingdeploy starten. Backupautomatisering met productiegegevens draait in een afzonderlijke vertrouwde operationele omgeving, niet als algemene PR-job.

De feedworkflow heeft een aparte beschermde omgeving, beperkte opslag-/signingrechten en een geserialiseerde releasevolgorde. Zij verwerkt alleen een gecontroleerde publieke selectie, nooit een openbare database-export. Een geplande vernieuwing mag geen nieuwe, nog niet beoordeelde regels meenemen. Bij fouten blijven de bestaande CDN-release en lokale gebruikerskopieën geldig volgens §20.

### 19.4 CI-contract

Onderstaande YAML legt events, minimale rechten en de verplichte eindcheck vast. Het is een **contractfragment**, nog geen uitvoerbare workflow: de jobs `quality`, `tests`, `integration`, `browser` en `build` moeten worden ingevuld met de scripts uit §18.3. `quality` omvat `astro check`; `build` controleert assetbudgetten en `browser` voert `pnpm test:web-quality` op de productiebuild uit. Iedere job krijgt een korte timeout en gebruikt standaard Linux-runners. Chrome-capturetests gebruiken de vereiste displaycontext, bijvoorbeeld Xvfb; een gewone headless paginalaad telt niet als extensiecapturebewijs.

```yaml
name: CI
on:
  pull_request:
  merge_group:
    types: [checks_requested]
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  # Implement quality, tests, integration, browser and build here.
  required:
    if: ${{ always() }}
    needs: [quality, tests, integration, browser, build]
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - name: Require all checks to pass
        env:
          RESULTS: ${{ toJSON(needs) }}
        run: |
          node -e 'const r = JSON.parse(process.env.RESULTS); if (!Object.values(r).every(j => j.result === "success")) process.exit(1)'
```

De eindcheck accepteert geen mislukte, geannuleerde of onverwacht overgeslagen afhankelijkheid. Voeg de afzonderlijke securitychecks eveneens toe aan de repositoryregels; `CI / required` alleen betekent niet automatisch dat een andere workflow geslaagd is. De daadwerkelijke checknaam wordt na de eerste run in de branchregels vastgelegd. [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)

### 19.5 Veilige en goedkope community-CI

- PR-tests draaien op `pull_request` met read-only rechten en zonder deployment-, auth- of databasesecrets. Forkbijdragen gebruiken lokale runtime en fixtures.
- Gebruik nooit `pull_request_target` om code uit een PR te installeren of uit te voeren met verhoogde rechten. Een vereiste maintainergoedkeuring van een fork-run geeft die code nog geen recht op secrets.
- Pin externe Actions aan volledige, gecontroleerde commit-SHA's en vermeld de bijbehorende release als commentaar. Pin ook toolchains en gebruik `--frozen-lockfile`; Dependabot kan pins bijwerken.
- Interpoleer geen onbetrouwbare PR-titels, branchnamen of issue-inhoud rechtstreeks in shellcode. Geef waarden als data via omgevingsvariabelen of gestructureerde parameters door.
- Geen publieke fork-jobs op productiemachines of permanente self-hosted runners. Gebruik tijdelijke GitHub-hosted runners en gescheiden caches voor vertrouwde releases; een publicatiejob hergebruikt geen onbewezen PR-artifacts.
- Deploymentsecrets staan uitsluitend in de juiste GitHub Environment, met beperkte rechten en toegestane refs. Gebruik kortlevende identiteit waar de gekozen provider dit ondersteunt; anders een beperkte roteerbare API-token.

Deze maatregelen volgen de GitHub-richtlijnen voor workflowbeveiliging. [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use)

Standaard GitHub-hosted runnergebruik voor publieke repositories is gratis. Dat maakt betaalde grotere runners, externe diensten of onbeperkte opslag niet automatisch gratis. Beperk CI-artifacts bijvoorbeeld tot 7 dagen, bewaar browsertraces alleen bij fouten en houd dependencycaches klein. Geen parallelle OS-/browserversiematrix zonder aantoonbare noodzaak. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

### 19.6 Releases en productiecontrole

1. De beheerder kiest een geslaagde, gereviewde commit op `main` en maakt een beschermde versietag. De releasejob controleert afkomst, manifest/packageversies en vereiste checks voor die commit.
2. Bouw de release uit die vertrouwde bron met gepinde dependencies; maak een extensie-ZIP, checksums, changelog en herleidbare versie-informatie. Scheid `engineVersion`, `rulesetVersion`, databaseschema en extensieversie.
3. Test de web/API-release in staging, inclusief echte publicatie, toegang door een tweede gebruiker, intrekking en migratie vanaf het vorige schema.
4. Promoveer alleen het gevalideerde artifact naar de productieomgeving. Productiedeploys zijn geserialiseerd en worden niet halverwege door een volgende run geannuleerd. Bij een driftende database of ontbrekende backup stopt de migratiestap vóór wijziging.
5. Controleer na deploy de echte rapportflow via UI én API, geen uitsluitend groene homepage. Een mislukte controle markeert de release als mislukt en gebruikt het vooraf geteste app-rollbackplan; een destructieve datamigratie wordt niet blind teruggedraaid.
6. Chrome Web Store-publicatie is een afzonderlijke releasehandeling. Een geslaagde ZIP-build of upload betekent nog niet dat de storeversie goedgekeurd en beschikbaar is. Documenteer die status eerlijk in release notes.

SemVer en een changelog zijn verplicht. Een gewijzigde detector kan eerdere resultaten anders interpreteren; documenteer dat expliciet en wijzig historische metingen niet stilzwijgend. Een community-PR naar `main` publiceert niet automatisch een nieuwe storeversie of productierelease.

---

## 20. JSON-index via CDN en offline blocker

### 20.1 Doel en onderscheid tussen gegevens

**De blocker moet bekende, geactiveerde regels kunnen toepassen als de server niet reageert.** Daarvoor wordt de regelindex vooraf opgehaald en lokaal bewaard. De CDN verlaagt serverbelasting en maakt distributie onafhankelijk van de API; de lokale opslag maakt toepassing onafhankelijk van het netwerk.

| Gegevens | Distributie | Gedrag bij uitval |
|---|---|---|
| Privé-, via-link- en publieke auditrapporten | API met publicatiestatus en toegangscontrole | Kunnen tijdelijk onbereikbaar zijn; geen verborgen offline kopie via de publieke feed. |
| Vrijgegeven publieke regelindex | Ondertekende statische JSON via CDN | Reeds uitgegeven bestanden blijven los van API/D1 leesbaar; lokale kopie blijft bruikbaar. |
| Eigen lokale regels en uitzonderingen | Extensie-opslag | Blijven lokaal beschikbaar en hebben geen productieaccount nodig. |

De publieke feed bevat uitsluitend gereviewde regelbeschrijvingen: exacte origin, minimaal routepatroon, technische doelfingerprint, begrensde selector indien bruikbaar, toegestane actie, versie en geldigheid. Geen gebruikersnamen, privé-/unlisted-rapporten, deellinks, tokens, ruwe paden met persoonsgegevens of volledige auditgeschiedenis.

Een kandidaatbevinding wordt niet automatisch een blokkeerregel. Opname vereist een controle op werking, scope, neveneffecten en publiceerbare inhoud. Auteurs die materiaal voor de feed aanleveren moeten weten dat die minimale regeldata publiek herverdeeld en offline bewaard wordt. Verwijdering van het bronrapport trekt bestaande offline kopieën niet op afstand terug.

### 20.2 Statische bestanden en cachebeleid (P0-fundament)

Voorgestelde paden onder een nog in te richten aparte feedhostnaam:

```text
/feeds/stable/latest.json
/feeds/stable/releases/000042/manifest.json
/feeds/stable/releases/000042/rules.<sha256>.json
```

- `latest.json` bevat een ondertekend manifest met een oplopend volgnummer en verwijzingen naar vaste bestanden. Een extra manifestkopie onder het releasepad maakt reproduceerbare downloads en mirrors mogelijk.
- Een releasepad wordt nooit hergebruikt voor andere bytes. Publiceer bestanden eerst, verifieer ze via de publieke CDN-URL en vervang **pas daarna** `latest.json`.
- De JSON staat in een aparte publieke R2-bucket, bereikbaar via een eigen domein. Een cachemiss leest het statische object, niet de epi-less-API of D1. Backups en rapportdata zitten nooit in deze publieke bucket.
- Configureer caching expliciet voor de feed-JSON; alleen een bestand op R2 zetten garandeert geen JSON-cachehit. Cloudflare beschrijft custom domains als de route voor R2-caching; `r2.dev` is voor ontwikkeling. [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)

| Bestand | Voorgesteld `Cache-Control` | Aanvullend |
|---|---|---|
| `latest.json` | `public, max-age=300, stale-while-revalidate=3600, stale-if-error=86400` | ETag, korte actualiteitsduur; werkelijke stale-afhandeling op de gekozen CDN testen. |
| Versiemanifest en regelbestand | `public, max-age=31536000, immutable` | Bestandsnaam/manifest bindt inhoud; nooit overschrijven. |
| Auditrapport-/account-API | Bestaand toegangs- en intrekkingsbeleid | Buiten de feed-cacheconfiguratie houden. |

Cloudflare kan met `stale-while-revalidate` een oude kopie leveren terwijl zij op de achtergrond vernieuwt. Conflicterende directives zoals `must-revalidate`, `no-cache` of een onjuist gecombineerd `s-maxage` kunnen dat gedrag verhinderen; controleer de feitelijke responseheaders en cacheconfiguratie. [CDN-herbevestiging](https://developers.cloudflare.com/cache/concepts/revalidation/)

Een TTL zegt hoe lang inhoud vers is, niet dat de CDN haar tot dan bewaart. Cache-evictie, provideruitval en een lege edgecache blijven mogelijk. Daarom is CDN-caching een extra distributielaag; de offline-eis wordt door de extensieopslag gedragen. [Cachebewaring en versheid](https://developers.cloudflare.com/cache/concepts/retention-vs-freshness/)

### 20.3 Manifest en authenticiteit

Het ondertekende manifest bevat minimaal:

- `schemaVersion`, vast `channel`, oplopende `sequence`, `generatedAt` en `expiresAt`.
- `minExtensionVersion` en ondersteunde regel-/fingerprintversies.
- Per bestand het relatieve pad, aantal **ongecomprimeerde bytes** en SHA-256 van die exacte bytes.
- `revokedRuleIds` voor ingetrokken regels; een intrekking identificeert een stabiele regel-ID, niet een veranderlijke selector.
- Identificatie van de gebruikte signing key en de handtekening(en).

Gebruik een expliciet ondertekeningsformaat met testvectoren en een onderhouden verificatie-implementatie. De handtekening bindt de exacte manifestpayload inclusief bestandsnamen, hashes, versies en vervaldata. De extensie vertrouwt vooraf ingebouwde publieke sleutels; een sleutel die uitsluitend naast een download op dezelfde CDN staat is geen vertrouwensbasis. HTTPS en een hash zonder vertrouwde handtekening volstaan niet als authenticiteitscontrole.

De updater weigert onbekende sleutels, verkeerde kanalen, ongeldige handtekeningen, verlopen **nieuwe** metadata, incompatibele schema's, afwijkende bestandshashes en een lager volgnummer dan de hoogste al vertrouwde metadata of de ingebouwde ondergrens. Dezelfde versie met andere inhoud is ongeldig; dezelfde gecontroleerde metadata mag een onderbroken bestandsdownload hervatten. Een teruggedraaide systeemklok mag niet stilzwijgend als bewijs van versheid dienen.

Signing keys staan uitsluitend in de beschermde releaseomgeving; publieke sleutels mogen in Git. Sleutelrotatie verloopt via een vooraf vertrouwde rotatieketen of een officiële extensie-update, niet via een los onbeveiligd CDN-veld. Werk het protocol vóór implementatie uit aan de hand van bestaande updatebeveiliging, waaronder TUF; deze specificatie claimt geen volledige TUF-implementatie. [The Update Framework](https://theupdateframework.github.io/specification/latest/)

### 20.4 Lokale werking en updatevolgorde (P2)

De bronvolgorde bij starten is: **actieve geverifieerde lokale versie → vorige bruikbare lokale versie → met de extensie meegeleverde basisset**. Bekende intrekkingen en lokale uitschakelingen blijven bij elke stap van toepassing. De basisset bevat uitsluitend aantoonbaar gereviewde regels; bij een lege set is er geen bekende regeldekking.

Lokale terugval verlaagt nooit het hoogste vertrouwde volgnummer voor toekomstige netwerkupdates. Dat nummer hoort bij geverifieerde metadata en kan hoger zijn dan de actieve regelset wanneer een bestandsdownload nog niet is voltooid.

1. Laad lokaal aanwezige, compatibele regels en lokale gebruikerskeuzes. Start matching zonder op netwerk te wachten.
2. Controleer op de achtergrond of een update nodig is. Voorgestelde normale cadans: eenmaal per 6 uur met spreiding, plus een begrensde controle na opstarten/herstel van verbinding; nooit per bezochte website.
3. Download `latest.json` met korte timeout en ETag. Verifieer metadata, kanaal, handtekening, versie, actualiteit en grenzen vóór verdere verwerking. Een 304 of oude CDN-kopie maakt de oorspronkelijke `generatedAt` niet nieuwer.
4. Verwerk geldige nieuwe intrekkingen persistent zodra vertrouwde metadata ze bekendmaakt. Zo blijven die gelden als de bijbehorende regeldownload mislukt; oude sets mogen ze niet opnieuw activeren.
5. Download alle bestanden voor de kandidaatversie naar tijdelijke lokale opslag. Verifieer bytes, hashes, schema, selectors, actie-enums en totale omvang; externe redirectbestemmingen en bestandspaden moeten binnen vooraf toegestane distributiehosts blijven.
6. Activeer pas na volledige verificatie de hele regelset met één lokale transactionele omschakeling. Geen mengsel van versies. Behoud de vorige versie voor herstel en behoud alle lokale uitzonderingen.
7. Bij timeout, 404/5xx, kapotte JSON, ongeldige handtekening, onvolledige download of opslagfout: verwerp alleen de kandidaat en blijf de bestaande bruikbare regels toepassen. Herhaal met oplopende wachttijd en spreiding; geen eindeloze requestlus.

Voorgestelde initiële limieten: 64 KiB manifest, 8 MiB totale ongecomprimeerde regeldata en 50 MiB lokale updateropslag inclusief kandidaat/vorige versie. Toets deze waarden in de PoC. Indexeer de volledige compacte feed lokaal op origin; geen download van domeinspecifieke stukken bij ieder sitebezoek. Een latere opdeling moet bruikbare dekking vooraf downloaden en exact aangeven welke delen lokaal ontbreken.

Gebruik duurzame extensie-opslag/IndexedDB voor regelsets en controleer opslagfouten. `chrome.storage.session` is vluchtig; `chrome.storage.local` heeft standaard een beperkt quotum. De updater mag niet stilzwijgend de actieve set opruimen om een te grote update te laten passen. [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage)

### 20.5 Uitval, oude regels en intrekkingen

| Situatie | Verplicht gedrag |
|---|---|
| API of D1 onbereikbaar | Blocker gebruikt lokale regels; CDN-download blijft mogelijk zonder API. Nieuwe publicaties/exports kunnen wachten. |
| CDN of volledige netwerkverbinding onbereikbaar | Bestaande lokale regels blijven werken, ook na browser-/workerherstart. |
| Eerste start zonder netwerk of na wissen van extensiedata | Gebruik ingebouwde basisset voor wat daarin gedekt is; geen belofte van recentere of ontbrekende regels. |
| Nieuw manifest ongeldig, verlopen of teruggezet | Geen nieuwe versie activeren; lokale bruikbare versie behouden en updatestatus zichtbaar maken. |
| Bestaande feed wordt ouder dan `expiresAt` | Status `STALE_OFFLINE`: reeds aanvaarde regels blijven inzetbaar zolang ze lokaal geldig en passend zijn; niet presenteren als actuele feed. |
| Regel heeft harde `notAfter`, is bekend ingetrokken of matcht niet meer betrouwbaar | Die regel niet toepassen, ook niet via basisset of rollback; ontbrekende dekking aangeven. |
| Nieuwe geldige intrekking bereikt de extensie | Regel lokaal uitschakelen en uitschakeling bijwerken vóór/los van verdere regeldownload; andere regels blijven beschikbaar. |
| Beide lokale sets onleesbaar | Ingebouwde basisset gebruiken en herstelstatus tonen; geen lege feed als succesvolle update opslaan. |

**Bewuste afweging:** oude, eerder goedgekeurde regels blijven bij een storing beschikbaar. Daardoor kan de extensie een nog niet ontvangen intrekking of sitewijziging niet kennen. Toon datum, versie, bron en ontbrekende updates in het eigen dashboard, met **Regel uitschakelen** en **Updates opnieuw proberen**. Geen telkens terugkerende popup tijdens gewone navigatie.

Het verlopen van distributiemetadata blokkeert acceptatie van een nieuwe download; het is geen opdracht om een al geïnstalleerde regelset ineens te wissen. Harde geldigheid van afzonderlijke regels, lokale uitschakelingen en bekende intrekkingen blijven wel leidend. Een offline client kan niet tegelijk volledig serveronafhankelijk zijn en onmiddellijk op onbekende serverintrekkingen reageren.

### 20.6 Publiceren, terugdraaien en kosten

- De beheerder laat `publish-feed.yml` een gecontroleerde publieke selectie exporteren. Geen automatische promotie van alle auditbevindingen. Alleen een vertrouwde releaseomgeving kan ondertekenen en `latest.json` wijzigen.
- Bouw deterministische bestanden en controleer dat privédata ontbreekt. Publiceer vaste bestanden, controleer CDN-bereikbaarheid en hashes, publiceer daarna het ondertekende nieuwste manifest. Een fout halverwege laat de vorige release actief.
- Functioneel terugdraaien betekent een **hoger volgnummer met herstelde regelinhoud**, inclusief alle nog geldende intrekkingen. Het oude volgnummer terugzetten is een geweigerde downgrade.
- Een problematische regel intrekken gebeurt via een nieuwe ondertekende release. Eventueel de korte `latest.json`-cache verversen; daarmee verdwijnen geen al gedownloade offline kopieën. Bij persoonsgegevens in een publicatie: betrokken originobjecten verwijderen en caches/mirrors purgen, terwijl de beperking voor reeds gekopieerde data blijft gelden.
- Publiceer zo nodig dagelijks een vernieuwd manifest met hoger volgnummer en dezelfde bestandshashes om actualiteit te bevestigen; haal bij ongewijzigde inhoud geen hele feed opnieuw binnen. Leg vervaltermijn, vernieuwingsschema en sleutelherstel vast in het runbook. Voorgestelde metadata-levensduur: 7 dagen.
- Reserveer CDN-objectopslag en requestkosten in `docs/costs.md`. Geen D1-query of API-authenticatie voor iedere blockerstart; gebruik cachebare statische bytes en conditionele requests. R2 heeft eigen opslag-/operatietarieven, dus het eerdere Workers-basisbedrag is geen totaalprijs voor onbeperkte distributie. [R2-prijzen](https://developers.cloudflare.com/r2/pricing/)
- De app werkt met lokaal aanwezige regels ook bij volledige Cloudflare-uitval. Een latere onafhankelijk gehoste mirror kan het binnenhalen van updates verbeteren; identieke ondertekende bestanden, ingebouwde vertrouwde bronnen en dezelfde versiecontroles blijven vereist. Een tweede host onder dezelfde provider geldt niet als onafhankelijke uitvalsbescherming.

### 20.7 Fasering

**P0:** datacontract, selectie/redactie, signing/verificatieproef, statische JSON-export, CDN-publicatie, cacheheaders en uitvaltests voor de distributielaag. Als nog geen regels zijn gevalideerd, publiceer een expliciet lege feed en gebruik synthetische fixtures voor tests; geen onbewezen blockerclaim.

**P2:** meegeleverde basisset, lokale updater, rollback, bekende intrekkingen, gebruikerskeuzes en echte blockerwerking zonder netwerk. De blocker is pas gereed na bewezen toepassing op een testsite met API, database en CDN geblokkeerd en na een browserherstart. Offline beschikbaarheid bewijst geen garantie dat vroege of onbekende flitsen voorkomen worden; de bestaande beperkingen uit §8 blijven gelden.

---

## 21. Astro, React en epi-less-vormgeving

### 21.1 Websitearchitectuur

**Vaste keuze:** Astro + TypeScript, met `@astrojs/react` voor interactieve onderdelen en `@astrojs/cloudflare` voor de Worker-runtime. De extensie behoudt haar eigen React-build. Pin bij implementatie onderling ondersteunde versies en de lockfile; kopieer geen oude adapterconfiguratie uit een ander project.

Astro kan HTML leveren zonder clientruntime voor statische componenten. Een `client:*`-directive activeert een afzonderlijk interactief eiland. Dit ondersteunt de keuze om navigatie, inhoud en rapporttabellen als HTML te leveren en React gericht toe te voegen. [Astro islands](https://docs.astro.build/en/concepts/islands/), [React-integratie](https://docs.astro.build/en/guides/integrations-guide/react/)

| Onderdeel | Rendering | Browserinteractie en cachebeleid |
|---|---|---|
| Startpagina, uitleg, documentatie, privacy | Prerender bij build | HTML/CSS, CDN; geen live rapportdata of D1-query. |
| `/sites` en `/sites/:siteId` | Astro SSR op aanvraag | Zoekformulier, filters en paginering werken als gewone links/formulieren; actuele publieke selectie, `Cache-Control: no-store`. |
| `/reports/:publicationId` en `/share/:token` | Astro SSR na toegangscontrole | Samenvatting, scope en bevindingen direct in HTML; `Cache-Control: no-store`, ook voor metadata en foutresponses. |
| `/account/*` en beheer | Astro SSR na sessiecontrole | React-islands voor complexe beheertaken; private responses met `Cache-Control: private, no-store`. |
| API-routes | Astro-serverendpoints | Dezelfde autorisatie-/publicatiemodules als SSR; geen gedeelde cache van gebruikers- of rapportdata. |
| CSS, JS, fonts en statische illustraties | Vooraf gebouwde assets met inhoudshash | Lang cachebaar; alleen benodigde bestanden per route laden. |
| Publieke JSON-regelfeed | Afzonderlijke R2/CDN-distributie | Volgt §20; geen Astro-rendering, login of databasequery bij download. |

Start met standaard statische output en kies per dynamische pagina/endpoint `export const prerender = false`. De adapter verzorgt rendering op aanvraag. Een vaste rapportsnapshot is inhoudelijk onveranderlijk, maar haar toegang kan worden ingetrokken: **rapportinhoud hoort niet in de statische build**. Ook social metadata volgt de bestaande zichtbaarheidsregels. [Astro rendering op aanvraag](https://docs.astro.build/en/guides/on-demand-rendering/)

- Houd SSR en API in één Worker-deploy; beide roepen dezelfde server-use-cases aan. Serverbindings, sessiegeheimen en private velden komen nooit in eilandprops of browserbundels.
- Statische routes en assets gebruiken rechtstreeks assetdelivery. Controleer de werkelijke adapterrouting; algemene middleware mag deze verzoeken niet alsnog door auth, D1 of dynamische rendering sturen.
- Gebruik expliciete D1-bindings en lokale synthetische seeds. Controleer adapterdefaults voor afbeeldingen en sessies; kies build-time beeldoptimalisatie en voeg extra diensten alleen toe wanneer hun noodzaak en kosten zijn vastgelegd. De actuele adapter kan runtime-beeldbewerking en KV-sessies configureren. [Cloudflare-adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- Een nieuwe publicatie of intrekking veroorzaakt geen volledige Astro-rebuild. Indexlijsten gebruiken compacte samenvattingen en cursorpaginering; rapportdetails worden begrensd opgehaald.
- Geen serviceworker die intrekbare rapporten offline bewaart. Bij API-uitval toont de website een begrijpelijke fout met herstelactie. De aparte offline blocker gebruikt zijn eigen lokale regelopslag volgens §20.
- Leg omgeving en bindings vast in het buildmanifest. Als de adapter per omgeving een andere build vereist, valideer ook het productieartifact vóór promotie; een stagingbuild bewijst die variant niet automatisch.

### 21.2 React alleen voor gerichte interactie

| Component | Uitvoering |
|---|---|
| Header, footer, uitleg, statuslabel, gewone resultatenlijst | Astro-componenten en CSS; semantische links, formulieren en `details` waar passend. |
| Direct bruikbare interactieve filters of publicatiebeheer | Kleine React-island met `client:load` zodra native HTML onvoldoende is; server voert elke autorisatie opnieuw uit. |
| Uitgebreide visualisatie onder de vouw, bijvoorbeeld P1-historiek | `client:visible` met gereserveerde afmetingen en een leesbare tabel/samenvatting vóór laden. |
| Niet-essentiële verbetering na de eerste weergave | Alleen indien nodig `client:idle`; geen essentiële bediening laten wachten op idle. |

Geen globale React-root, router of provider nodig voor gewone paginanavigatie. Gebruik `client:only` uitsluitend voor een bewezen browserafhankelijk onderdeel met een bruikbare fallback. Deel domeintypes en kleine componenten wanneer nuttig; importeer nooit het hele DevTools-dashboard of de analyse-engine om één webstatus weer te geven.

Zoeken verstuurt standaard op submit. Eventuele latere livezoekfunctie krijgt debounce, annulering van verouderde requests en dezelfde querylimieten. Geen periodieke polling op gewone rapportpagina's. Stuur alleen de vereiste gegevens naar een island; geen complete rapportsnapshot dubbel in HTML, JSON-props en een tweede clientfetch.

Turnstile wordt alleen op betrokken schrijf-/authformulieren of de afzonderlijke verificatiepagina geladen, niet in de algemene layout. Een kleine Astro-component kan het officiële script rechtstreeks laden; daarvoor is geen extra React-wrapper nodig. Gebruik een eigen ruimte en toegankelijke foutstatus voor eventuele bediening. De relevante flow en servercontrole staan in §9.5.

### 21.3 Utilitaire epi-less-vormgeving

**Ontwerpbesluit van 27 oktober 2026:** de website wordt een functionele applicatie met weinig tot geen marketing. De eerdere huisstijlreferentie en tussentijdse redactionele richting zijn vervangen. De actuele basis staat in `apps/web/src/styles/site.css` en de Astro-layouts en -componenten. De productinterface heeft haar eigen indeling; de projectpagina bevat een kleine makercredit.

| Onderdeel              | Concrete basis                                                 | Toepassing in epi-less                                                                                        |
| ---------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Applicatiestructuur    | Vaste zijbalk en compacte bovenbalk                            | Directe toegang tot index, rapporten, account en ondersteunende functies; aangepast aan smalle schermen.        |
| Achtergrond en panelen | Neutrale lichte achtergrond, witte panelen, fijne randen       | Duidelijke groepering van bediening en gegevens zonder grote decoratieve vlakken.                               |
| Accent                 | Beperkt groen, centraal vastgelegde tokens                     | Actieve navigatie, primaire bediening en focus; contrast per combinatie meten.                                  |
| Typografie             | Systeemfonts met Arial- en sans-serif-fallback | Compacte koppen van circa 28–36 px, leesbare tabellen en formulieren; geen gedownloade webfonts.          |
| Productmarkering       | Kleine statische oog-/observatiemarkering                      | Herkenning in de navigatie, zonder cursorvolgende pupil of bewegende merkeffecten.                              |
| Makervermelding        | Bescheiden makercredit op de projectpagina                                 | Een kleine credit op de projectpagina; geen herhaalde organisatienaam in navigatie of exports.                                  |
| Compositie             | Compacte secties, tabellen, labels en functionele zijpanelen   | Gegevens en acties staan vooraan; geen marketinghero, decoratieve rapportillustratie of promotionele zijbalken. |

De startpagina biedt directe toegang tot bruikbare functies. De index heeft een compact gelabeld zoekformulier en gebruikt de beschikbare inhoudsbreedte voor resultaten, paginering en directe lege/fouttoestanden. Een rapport toont domein, meetdatum, status, meetbereik, kwaliteitscontext en uitklapbare routes; een functionele zijbalk bevat het scanplan. Domeinhistoriek gebruikt een compacte tabel. Ondersteunende pagina's geven beknopte instructies bij de bijbehorende taak. Op smalle schermen volgt een logische enkele kolom; brede meettabellen blijven in een benoemd scrollgebied.

De productnaam is **epi-less**. Merkaccent en meetuitkomst blijven aparte tokens: groen draagt op zichzelf geen veiligheidsbetekenis. Iedere meetstatus krijgt tekst en waar nuttig een icoon; kleur alleen draagt nooit de betekenis. Toets normale tekst op minimaal 4,5:1 en grote tekst op 3:1, naast focus- en componentcontrast. Compacte labels blijven leesbaar en bediening houdt voldoende aanraakruimte.

Gebruik scoped CSS en een kleine gedeelde tokenset. Een zelfstandige installatie kan naam, logo en kleuren vervangen zonder de scanlogica te wijzigen. Neem alleen bestanden met passende hergebruikrechten op en behoud de bijbehorende licenties. Er is geen apart displaylettertype nodig. De MIT-codekeuze wijzigt de merkgrenzen uit §16.2 niet.

### 21.4 Rustige bediening en toegankelijkheid

- De epi-less-site toont zijn eigen productidentiteit en leesbare inhoud meteen. Geen intro die eerst moet worden geactiveerd, geen knipperende tekst, autoplayvideo, marquee, parallax, cursorvervanger of scrollovername.
- Alleen korte, niet-repeterende interactiefeedback wanneer nuttig. `prefers-reduced-motion` schakelt niet-essentiële beweging en smooth scrolling uit; inhoud is nooit verborgen tot een animatie draait.
- Echte headings, landmarks, skiplink, zichtbare toetsenbordfocus, gekoppelde formuliervelden en begrijpelijke foutmeldingen. React-updates behouden focus en melden uitkomsten zonder onnodige herhaalde aankondigingen.
- Een gebruiker kan rapporten lezen, zoeken en pagineren zonder JavaScript. Interactief beheer toont een begrijpelijke fallback als het onderdeel niet geladen kan worden.
- Houd de lay-out bruikbaar vanaf 360 px en bij 200% zoom. Brede meettabellen krijgen een benoemd scrollgebied of aangepaste weergave; de hele pagina mag niet horizontaal uitlopen.
- Gebruik statische synthetische voorbeelden. De website, README en screenshots bevatten geen bewegende flitsdemonstraties.

### 21.5 Meetbare efficiëntie

Deze waarden zijn **initiële projectbudgetten**, nog geen gemeten prestaties. Meet de productiebuild met vaste synthetische fixtures en een vastgelegd mobiel labprofiel. Een gemotiveerde budgetwijziging vereist een zichtbare ontwerpbeslissing en review; verhoog de limiet niet stilzwijgend om CI groen te krijgen.

| Onderdeel | P0-budget / meetdoel |
|---|---|
| Startpagina, uitleg en gewone rapportweergave | **0 KiB React-runtime**, maximaal **5 KiB gzip eigen JavaScript**; de kern werkt met JS uit. |
| Route met actieve React-island | Maximaal **100 KiB gzip initieel JS**, inclusief React en gedeelde chunks; later geladen functies krijgen een afzonderlijk budget. |
| CSS per route | Maximaal **30 KiB gzip**, inclusief algemene en componentstijlen. |
| Fonts | Maximaal **100 KiB WOFF2** bij eerste bezoek, maximaal twee gedownloade fontfamilies per route; zelf hosten, `font-display: swap`, alleen noodzakelijke preload. |
| Eerste paginaweergave | Maximaal **450 KiB gecomprimeerde assets en HTML samen** voor representatieve start-, index- en rapportpagina's; grote rapportdetails via paginering. |
| Mobiele labmeting | LCP maximaal **2,5 s** en CLS maximaal **0,1** op de vastgelegde representatieve routes; mediane uitkomst van drie koude runs per route. |
| Werkelijke interactie na ingebruikname | Streef naar INP maximaal **200 ms** op p75 waar voldoende privacyvriendelijke velddata beschikbaar is; labtests rapporteren apart hun interactietimings. |
| Informatieve statische pagina's | **0 D1-queries** en geen dynamische Worker-uitvoering op de normale assetroute, te controleren in de deployment. |

Alle automatisch gedownloade scripts tellen mee, ook deferred of inline scripts en gedeelde runtimecode. Meet bytes met een lege browsercache; `client:idle` is geen manier om een runtime uit het budget te verbergen. Apart uitgestelde, door scrollen of bediening geactiveerde onderdelen worden in hun eigen scenario gemeten. Een labscore is geen gemeten INP of bewijs van prestaties voor alle gebruikers.

Turnstile heeft externe, veranderlijke script-/framekosten: meet die op de beschermde formulierstap afzonderlijk én in het totaal, inclusief mogelijke layoutverschuivingen. Leg hiervoor vóór release een apart beoordeeld formulierbudget vast. De bestaande start-, index- en rapportbudgetten blijven gelden; daar wordt Turnstile niet geladen. CI met dummykeys vervangt de stagingmeting van de echte widget niet.

Optimaliseer statische beelden tijdens de build en lever passende afmetingen, moderne formaten en vaste aspectratio's. De eerste zichtbare afbeelding mag geen onnodige lazy-load krijgen. Laad grote visualisatielibraries pas in het betrokken onderdeel; kies eenvoudige SVG/CSS wanneer dat voldoende is. Geen externe fontservice of marketingtrackers als basisafhankelijkheid.

Combineer dit met de API-/D1-kostenmetingen uit §17. Een kleine browserbundel kan nog steeds dure queries of hoge SSR-CPU veroorzaken. Meet daarom ook publicatie, index, rapport en intrekking op de gekozen Worker-runtime voordat het hostingbudget wordt bevestigd.

### 21.6 CI en oplevering

`pnpm test:web-quality` controleert de routebundels, HTML zonder JS, cacheheaders, toegankelijkheid en mobiele prestatiefixtures. Gebruik dezelfde productiebuild als de E2E-tests; test representatieve lege, gevulde, ingetrokken en niet-toegankelijke rapporttoestanden. Documenteer toolversies, throttling en meetroutes in `docs/web-performance.md`.

Assetbudgetten en functionele rendering-/toegankelijkheidscontroles zijn verplichte mergechecks. Bewaar synthetische screenshots en prestatie-uitkomsten met korte artifactretentie. Visuele wijzigingen aan startpagina, index, rapport en beheer krijgen inhoudelijke review; verander een screenshotbaseline pas na beoordeling. Automatische toegankelijkheidschecks worden aangevuld met toetsenbord-, zoom- en motioncontrole.

Vóór de eerste release moet de combinatie bewezen zijn: consistente epi-less-vormgeving met bescheiden makercredit op de projectpagina, snelle eerste HTML, werkende React-bediening, correcte autorisatie en intrekking, lage gemeten serverkosten en een afzonderlijke CDN-feed. De websitekeuze verandert de autonome scanflow, lokale meetengine en offline blockerarchitectuur niet.

---

## Einddefinitie van het product

epi-less Audit is een **autonoom website-auditplatform met een gewone Chrome-extensie voor iedereen, een DevTools-interface voor ontwikkelaars en een online index om resultaten te bewaren en te delen**, met:

1. Een reproduceerbare analyse van visueel waargenomen websitegedrag.
2. Transparante technische en WCAG-gerelateerde bevindingen.
3. Een blijvende online website-, pagina- en auditindex met bevindingen, plus lokale opslag voor offline audits en nog niet gedeelde resultaten.
4. Statistieken, historische vergelijkingen en regressieopvolging.
5. Transparante meetstatussen zoals `NO_ISSUES_OBSERVED`, `NEEDS_REVIEW`, `NON_CONFORMANT` en `INCONCLUSIVE` binnen een expliciete scope.
6. Een toekomstige optionele blocker die bestaande bevindingen gebruikt zonder auditscores te vervalsen.
7. Lokale frameanalyse in Chrome en een backend voor bewust geselecteerde rapportgegevens.
8. Privéopslag, intrekbare deellinks en een publieke doorzoekbare index **vanaf de eerste productversie**.
9. Zelfstandige routeverkenning, navigatie, scrollen, ondersteunde interactie-/mediatests en rapportage vanaf één startflow.
10. Begrijpelijke voortgang en expliciete dekking, limieten en stopredenen, zonder verplichte handmatige rondgang.
11. Open-sourceontwikkeling via de projectrepository, met een duidelijke README, communitybijdragen, beschermde merges en geteste GitHub Actions.
12. Een door de beheerder gehoste officiële index met compacte opslag, lage vaste kosten, meetbare quota en herstelbare releases.
13. Een ondertekende JSON-regelindex via CDN en een latere blocker die bekende regels lokaal blijft toepassen bij server- of netwerkuitval.
14. Een efficiënte Astro-website met gerichte React-islands, een eigen epi-less-identiteit en geteste budgetten voor snelheid, toegankelijkheid en serververbruik.
15. Cloudflare Turnstile met serververificatie en gerichte limieten tegen spam, zonder challenges in de autonome scan of offline regeldistributie.

**Eerste implementatiestap:** bewijs de volledige keten met DevTools gesloten: **Scan deze website** → automatisch routes ontdekken en bezoeken → scrollen, ondersteunde UI en media testen → bruikbare frames meten → zelfstandig rapport maken → rapport online delen → link in een andere browser openen → toegang intrekken. Werk vervolgens runner, detectie-engine, gewone interface, DevTools en online index uit tot de MVP; normvalidatie en de blocker volgen volgens de roadmap.
