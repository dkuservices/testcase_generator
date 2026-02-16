# AI Orchestrator Module 4.1 - Kompletna dokumentacia

## Obsah

1. [Prehladova informacia](#1-prehladova-informacia)
2. [Technicka zakladna](#2-technicka-zakladna)
3. [Architektura systemu](#3-architektura-systemu)
4. [Instalacia a konfiguracia](#4-instalacia-a-konfiguracia)
5. [Pouzivanie systemu (UI)](#5-pouzivanie-systemu-ui)
6. [API referencia](#6-api-referencia)
7. [Spracovatelsky pipeline](#7-spracovatelsky-pipeline)
8. [Rezimy vykonavania](#8-rezimy-vykonavania)
9. [LLM provideri](#9-llm-provideri)
10. [Hierarchia projektov](#10-hierarchia-projektov)
11. [Spracovanie dokumentov](#11-spracovanie-dokumentov)
12. [Export a vystupy](#12-export-a-vystupy)
13. [Monitoring a naklady](#13-monitoring-a-naklady)
14. [Bezpecnost](#14-bezpecnost)
15. [Datova struktura](#15-datova-struktura)
16. [Praca s logmi](#16-praca-s-logmi)
17. [Rozsirenie systemu](#17-rozsirenie-systemu)
18. [Riesenie problemov](#18-riesenie-problemov)

---

## 1. Prehladova informacia

### Co je AI Orchestrator Module 4.1?

AI Orchestrator Module 4.1 je AI-pohaname nastroj na automaticke generovanie testovacich scenarovi z Confluence specifikacii a Word dokumentov. System transformuje prirodzeny text specifikacii na strukturovane testovacie pripady pomocou LLM providerov (Claude / Ollama) a pripravuje ich na import do Jira.

### Klucove vlastnosti

- **AI generovanie testov** - Automaticke vytváranie testovacich scenárov z textovych specifikacii
- **Viacere zdroje vstupu** - Confluence stranky, Word dokumenty (.docx), manualne zadanie
- **3 rezimy vykonavania** - Manualny (REST API), planovany (cron), event-driven (webhook)
- **Dvojuroven fallback** - LLM-level + validacny fallback pre maximalnu spolahlivost
- **Hierarchia projektov** - Projekt > Komponent > Stranka s agregovanymi testami na kazdej urovni
- **Review workflow** - Schvalovanie, editovanie a zamietanie scenarovi
- **Export** - Excel (.xlsx) a PDF export scenarovi
- **Slovencina** - Vsetky generovane testovacie kroky su v slovenskom jazyku
- **TestFlo format** - Strukturovane kroky: akcia, vstup, ocakavany vysledok
- **AI chat asistent** - Konverzacne upresnenie a zlepsenie scenarovi
- **Batch spracovanie** - Hromadne generovanie testov z viacerych stranok
- **Jira integracia** - Priame generovanie payloadov pre Jira API
- **Sledovanie nakladov** - Denne reporty spotreby LLM tokenov

### Podporovane workflow

```
Confluence stranka  ─┐
Word dokument (.docx)─┤──> Normalizacia ──> Prompt ──> LLM ──> Validacia ──> Jira format
Manualne zadanie    ─┘
```

---

## 2. Technicka zakladna

### Technologicky stack

| Vrstva | Technologia | Verzia |
|--------|-------------|--------|
| **Runtime** | Node.js | >= 18.0.0 |
| **Jazyk** | TypeScript | 5.3.3 |
| **Framework** | Express.js | 4.18.2 |
| **LLM - Claude** | Claude CLI (subprocess) | - |
| **LLM - Ollama** | ollama SDK | 0.6.3 |
| **Validacia** | Joi | 17.11.0 |
| **Schemova validacia** | Zod | 3.22.4 |
| **HTML parsing** | Cheerio | 1.0.0-rc.12 |
| **Word parsing** | Mammoth | 1.11.0 |
| **PDF parsing** | pdf-parse | 2.4.5 |
| **PDF generovanie** | pdfmake | 0.3.3 |
| **Excel generovanie** | ExcelJS | 4.4.0 |
| **DOM** | jsdom | 27.4.0 |
| **Logovanie** | Winston + daily-rotate-file | 3.11.0 / 4.7.1 |
| **Cron** | node-cron | 3.0.3 |
| **Confluence API** | confluence.js | 1.7.3 |
| **Jira API** | jira-client | 7.2.0 |
| **Bezpecnost** | Helmet | 7.1.0 |
| **Rate limiting** | express-rate-limit | 7.1.5 |
| **UUID** | uuid | 9.0.1 |
| **Textova podobnost** | string-similarity | 4.0.4 |

### TypeScript konfiguracia

- **Target**: ES2020
- **Module system**: CommonJS
- **Strict mode**: Zapnuty (strict: true)
- **Source maps**: Zapnute
- **Ochrana pred chybami**: noUnusedLocals, noUnusedParameters, noImplicitReturns, noFallthroughCasesInSwitch

### Struktura projektu

```
testcase_generator/
├── config/                          # Konfiguracne JSON subory
│   ├── execution-modes.json         # Rezimy vykonavania
│   ├── confluence.json              # Confluence nastavenia
│   ├── jira.json                    # Jira nastavenia
│   ├── pricing.json                 # Ceny LLM modelov
│   └── chunking.json                # Chunking nastavenia pre dokumenty
├── public/                          # Frontend (HTML + JS + CSS)
│   ├── dashboard.html/js            # Hlavna stranka
│   ├── generate.html/js             # Generovanie testov
│   ├── review.html/js               # Review desk
│   ├── jobs.html/js                 # Sprava jobov
│   ├── projects.html/js             # Zoznam projektov
│   ├── project.html/js              # Detail projektu
│   ├── component.html/js            # Detail komponentu
│   ├── page.html/js                 # Detail stranky
│   ├── documents.html/js            # Wizard pre dokumenty
│   ├── document.html/js             # Detail dokumentu
│   ├── sidebar.js                   # Navigacny strom
│   ├── toast.js/css                 # Notifikacie
│   ├── export-helper.js             # Export utilita
│   ├── generate.css                 # Zdielane styly
│   ├── hierarchy.css                # Sidebar styly
│   ├── review.css                   # Review styly
│   └── documents.css                # Dokumenty styly
├── src/                             # Backend zdrojovy kod
│   ├── index.ts                     # Vstupny bod aplikacie
│   ├── api/                         # REST API vrstva
│   │   ├── server.ts                # Express app factory
│   │   ├── middleware/              # Middleware (error, validation, rate-limit)
│   │   └── routes/                  # 23 route suborov
│   ├── pipeline/                    # Spracovatelsky pipeline (17 suborov)
│   ├── modes/                       # 3 rezimy vykonavania
│   ├── llm/                         # LLM provideri
│   │   ├── provider-factory.ts      # Factory pattern
│   │   ├── types.ts                 # Rozhrania
│   │   └── providers/               # Claude + Ollama implementacie
│   ├── models/                      # Datove modely (10 suborov)
│   ├── storage/                     # Perzistentna vrstva (10 suborov)
│   ├── integrations/                # Confluence + Jira klienti
│   ├── export/                      # Excel + PDF generatory
│   ├── utils/                       # Utility funkcie (10 suborov)
│   ├── monitoring/                  # Nakladove sledovanie + metriky
│   └── types/                       # TypeScript deklaracie
├── data/                            # Generovane vystupy
├── logs/                            # Logovacie subory
├── package.json
├── tsconfig.json
└── .env                             # Premenne prostredia (necommitovat!)
```

---

## 3. Architektura systemu

### Vysokourovnovy diagram

```
┌──────────────────────────────────────────────────────────────┐
│                     FRONTEND (public/)                        │
│  Dashboard │ Generate │ Review │ Jobs │ Projects │ Documents  │
│                    Sidebar │ Toast │ Export                    │
└──────────────────┬───────────────────────────────────────────┘
                   │ HTTP (REST API)
┌──────────────────▼───────────────────────────────────────────┐
│                     EXPRESS SERVER                             │
│  Routes │ Middleware (Helmet, CORS, Rate-limit, Validation)   │
└──────────────────┬───────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────┐
│                  REZIMY VYKONAVANIA                            │
│  Manual (REST) │ Scheduled (Cron) │ Event-driven (Webhook)    │
└──────────────────┬───────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────┐
│              SPRACOVATELSKY PIPELINE (6 krokov)               │
│  1. Normalizacia  ──>  2. Planovanie scenarovi                │
│  3. Prompt builder  ──>  4. LLM invokacie s fallback          │
│  5. Validacia + auto-korekcia  ──>  6. Jira formatovanie      │
└────────┬──────────────────────┬──────────────────────────────┘
         │                      │
┌────────▼──────────┐  ┌───────▼────────────┐
│   LLM PROVIDERI   │  │   INTEGRACIE       │
│  Claude CLI       │  │  Confluence API     │
│  Ollama API       │  │  Jira API           │
└───────────────────┘  └────────────────────┘
         │
┌────────▼──────────────────────────────────────────────────────┐
│                     STORAGE VRSTVA                              │
│  Job Store │ Page Store │ Project Store │ Batch Store │ Files  │
│              (JSON subory v data/ adresari)                     │
└───────────────────────────────────────────────────────────────┘
```

### Kliucove navrhove vzory

**1. Pipeline Pattern** - 6-krokovy sekvencny pipeline s casovanim kazdej fazy

**2. Factory Pattern** - `createLlmProvider()` / `createFallbackProvider()` pre dynamicke vytvaranie LLM providerov

**3. Context Logger Pattern** - Kazda funkcia vytvara kontextovy logger s metadatami (job_id, step, page_id) pre plnu sledovatelnost

**4. Async Job Processing** - API vracia 202 Accepted okamzite, spracovanie bezi na pozadi, klient polluje vysledky

**5. Dual Fallback Strategy** - Dvojuroven fallback: LLM-level (iny provider) + validacny-level (porovnanie oboch sad)

---

## 4. Instalacia a konfiguracia

### Predpoklady

- Node.js >= 18.0.0
- npm >= 9.0.0
- Pristup k LLM provideru (Claude CLI alebo Ollama)
- (Volitelne) Confluence a Jira pristupove udaje

### Instalacia

```bash
# Klonovanie repozitara
git clone <repository-url>
cd testcase_generator

# Instalacia zavislosti
npm install

# Kompilacia TypeScript
npm run build
```

### Premenne prostredia (.env)

Vytvorte subor `.env` v korenovom adresari:

```env
# ===== LLM Konfiguracia =====
LLM_PROVIDER=claude                    # "claude" alebo "ollama"
LLM_FALLBACK_PROVIDER=ollama           # Fallback provider (volitelne)
VALIDATION_FALLBACK_ENABLED=true       # Aktivuje dvojity fallback

# ===== Claude =====
CLAUDE_CLI_PATH=claude                 # Cesta k Claude CLI
CLAUDE_MODEL=sonnet                    # Primarny model
CLAUDE_TEMPERATURE=0.2                 # Teplota (0.0 - 1.0)
CLAUDE_MAX_TOKENS=4096                 # Maximalny pocet tokenov
CLAUDE_TIMEOUT_MS=120000               # Timeout v ms
CLAUDE_MODEL_FALLBACK=haiku            # Fallback model
CLAUDE_TEMPERATURE_FALLBACK=0.0        # Fallback teplota

# ===== Ollama =====
OLLAMA_BASE_URL=http://localhost:11434 # Ollama server URL
OLLAMA_MODEL_PRIMARY=llama2            # Primarny model
OLLAMA_TEMPERATURE_PRIMARY=0.3         # Teplota
OLLAMA_MODEL_FALLBACK=                 # Fallback model (volitelne)
OLLAMA_TEMPERATURE_FALLBACK=0.0        # Fallback teplota

# ===== Confluence (pre scheduled/event-driven rezimy) =====
CONFLUENCE_BASE_URL=https://domain.atlassian.net
CONFLUENCE_EMAIL=user@domain.com
CONFLUENCE_API_TOKEN=your-api-token

# ===== Jira =====
JIRA_BASE_URL=https://domain.atlassian.net
JIRA_EMAIL=user@domain.com
JIRA_API_TOKEN=your-api-token
JIRA_PROJECT_KEY=PROJ

# ===== Vseobecne =====
NODE_ENV=development                   # development | production
PORT=3000                              # Port servera
LOG_LEVEL=info                         # silly | debug | verbose | info | warn | error
```

### Konfiguracne subory (config/)

#### execution-modes.json
Konfiguracia rezimov vykonavania. Minimalne jeden rezim musi byt aktivny.

```json
{
  "scheduled": {
    "enabled": false,
    "cron_expression": "0 */6 * * *",
    "description": "Run every 6 hours"
  },
  "event_driven": {
    "enabled": false,
    "webhook_secret": "change-this-secret-in-production"
  },
  "manual": {
    "enabled": true,
    "api_port": 3000,
    "cors": {
      "enabled": true,
      "origins": ["http://localhost:3000"]
    }
  }
}
```

#### confluence.json
Nastavenia pre monitorovanie Confluence priestorov.

```json
{
  "monitored_spaces": ["SPACE1", "SPACE2"],
  "polling_interval_minutes": 60,
  "page_filters": {
    "include_labels": ["qa-ready", "test-generation"],
    "exclude_labels": ["draft", "archived"]
  }
}
```

#### jira.json
Mapovanie Jira poloziek a custom fieldov.

```json
{
  "project_key": "PROJ",
  "test_issue_type": "Test Case Template",
  "custom_field_mappings": {
    "preconditions": "customfield_10001",
    "test_steps": "customfield_10002",
    "parent_issue_link": "customfield_10004",
    "automation_status": "customfield_10005",
    "test_repository_folder": "customfield_10006"
  },
  "default_priority": "Medium"
}
```

#### pricing.json
Cenove nastavenia LLM modelov pre sledovanie nakladov.

```json
{
  "sonnet": {
    "prompt_per_1k_tokens": 0.0,
    "completion_per_1k_tokens": 0.0,
    "last_updated": "2026-01-15",
    "note": "Corporate license - no per-token charges"
  }
}
```

#### chunking.json
Nastavenia pre chunking dokumentov.

```json
{
  "upload_limit_mb": 200,
  "max_context_tokens": 50000,
  "chunk_target_tokens": 3000,
  "chunk_max_tokens": 5000,
  "chunk_overlap_tokens": 200,
  "min_relevance_score": 0.1,
  "max_chunks_per_request": 20,
  "chars_per_token": 4
}
```

### Prikazy

```bash
npm run dev          # Vyvojovy rezim s hot reload (ts-node-dev)
npm run build        # Kompilacia TypeScript do dist/
npm start            # Produkcia (dist/index.js)
npm run lint         # ESLint validacia
npm run format       # Prettier formatovanie
```

---

## 5. Pouzivanie systemu (UI)

System ponuka webove rozhranie pristupne na `http://localhost:3000`. Vsetky stranky pouzivaju slovensky jazyk (sk-SK) a su responzivne pre mobilne zariadenia.

### 5.1 Dashboard (/)

Hlavna stranka zobrazujuca celkovy prehlad systemu.

**Zobrazuje:**
- Statisticke karty: celkovy pocet projektov, komponentov, stranok, testovacich scenarov
- Tabulka poslednych jobov (poslednych 5-10)
- Rychle odkazy na generovanie, review, joby, dokumenty

### 5.2 Generovanie testov (/generate)

Rozhranie pre AI generovanie testovacich scenarov s dvoma rezimami:

**Rezim 1: Jednoduche generovanie (Single)**
1. Zadajte URL Confluence stranky do textoveho pola
2. Kliknite "Generovat"
3. System vrati job_id a zacne spracovanie na pozadi
4. Zobrazi sa odkaz na sledovanie jobu

**Rezim 2: Hromadne generovanie (Batch)**
1. Prepnite na rezim "Batch"
2. Zadajte viacero Confluence URL (jeden na riadok, 2-20 URL)
3. Moznosti:
   - Generovat testy na urovni stranok (checkbox)
   - Generovat integracne testy na urovni modulov (checkbox)
4. Kliknite "Generovat"
5. Sledujte pokrok cez progress bar v realnom case
6. Po dokonceni vidite statistiky: pocet stranok, scenarovi, deduplikovanych testov

### 5.3 Review Desk (/review)

Centralne miesto pre recenziu a schvalovanie generovanych scenarov.

**Filtre:**
- Status: Vsetky / Needs Review / Validated / Dismissed
- Priorita: Vsetky / Critical / High / Medium / Low
- Klasifikacia: Vsetky / Happy Path / Negative / Edge Case
- Typ testu: Vsetky / Functional / Regression / Smoke
- Textove vyhladavanie: podla nazvu testu, job ID, Jira ID

**Akcie pre kazdy scenar:**
- **Akceptovat** - Oznaci ako validovany
- **Editovat** - Otvorte modal na upravu vsetkych poli:
  - Nazov testu, typ, klasifikacia, priorita
  - Popis, predpodmienky
  - Testovacie kroky (dynamicke pridavanie/odstranovanie)
  - Priecinok repozitara, stav automatizacie
  - Poznamky k validacii
- **Zamietnut** - Oznaci ako zamietnuty s volitelnou poznamkou
- **Vymazat** - Trvale odstrani scenar

**Hromadne akcie:**
- Oznacte viacero scenarov checkboxmi
- "Akceptovat vsetky" / "Zamietnut vsetky"

**Export:**
- Vyberte formaty: Excel (.xlsx) alebo PDF
- Vyberte statusy na zahrnutie: Validated, Needs Review, Dismissed
- Stiahne subor `test-scenarios-{datum}.{xlsx|pdf}`

### 5.4 Sprava jobov (/jobs)

Prehlad a sprava vsetkych generovacich uloh.

**Tabulka jobov:**
- Job ID, status, pocet scenarov, cas vytvorenia, cas dokoncenia
- Stavy: Processing (oranzova), Completed (zelena), Failed (cervena), Cancelled (siva)

**Akcie:**
- **Detail** - Zobrazenie detailnych informacii v modali
- **Zrusit** - Zrusenie spracovavaneho jobu
- **Opakovat** - Opakovanie neuspesneho jobu
- **Vymazat** - Odstranenie jobu

**Automaticky polling** - Kazdy 10 sekund aktualizuje stav spracovavanych jobov

**Paginacia** - 20 jobov na stranku s navigaciou

### 5.5 Projekty (/projects)

Sprava testovacich projektov.

**Prehlad:**
- Mriezka kariet projektov
- Kazdy projekt zobrazuje: nazov, popis, pocet komponentov/stranok/testov
- Kliknutie otvorí detail projektu

**Vytvorenie projektu:**
- Nazov (povinny) + popis (volitelny)
- Po vytvoreni presmerovanie na detail

### 5.6 Detail projektu (/project/{id})

Sprava projektu s tromi kartami:

**Karta 1: Komponenty**
- Mriezka kariet komponentov
- Kazdy komponent zobrazuje: nazov, popis, pocet stranok, pocet testov
- Tlacidlo "Vytvorit komponent"

**Karta 2: Medzmodulove testy**
- Testy pokryvajuce viacero komponentov/stranok
- Filtrovanie: status, klasifikacia, textove vyhladavanie
- "Generovat medzmodulove testy" - AI generuje testy na urovni celeho projektu
- Scenarove karty s akciami (akceptovat, editovat, zamietnut, vymazat)
- Historia jobov

**Karta 3: Prirucka/Manual**
- Nahranie referencnej prirucky (text alebo subor)
- Podpora: .docx, .pdf, .txt
- Automaticky chunking pre velke subory
- Prehlad nahranej prirucky s metadatami

### 5.7 Detail komponentu (/component/{id})

Sprava komponentu so styrmi kartami:

**Karta 1: Stranky**
- Mriezka kariet stranok
- Kazda stranka zobrazuje: nazov, zdroj (Confluence / dokument), pocet testov
- "Pridat stranku" - zadanie Confluence URL

**Karta 2: Integracne testy**
- Testy na urovni komponentu (integracia viacerych stranok)
- Filtrovanie a akcie ako pri medzmodulovych testach
- "Generovat vsetko" - generuje stranky aj integracne testy naraz
- **AI Chat panel** - Konverzacia s AI pre zlepsenie testov

**Karta 3: Zavislosti**
- Zavislosti na inych komponentoch
- Zavislosti medzi strankami

**Karta 4: Uprava komponentu**
- Nazov, popis, ulozenie/zrusenie

### 5.8 Detail stranky (/page/{id})

Sprava individuálnej stranky:

**Sekcie:**
1. **Zdrojovy dokument** - Ak stranka pochádza z dokumentu: nazov suboru, metadata, popis modulu
2. **Doplnkovy kontext** - Pridanie dalsieho kontextu pre generovanie (text, subor, Confluence odkaz)
3. **Generovanie testov** - Nastavenie max. poctu testov (1-20), tlacidlo generovat
4. **Testovacie scenare** - Filtrovanie a prehlad generovanych testov
5. **Historia jobov** - Tabulka predchadzajucich generovani
6. **Zavislosti** - Odkazy na zavisle stranky
7. **AI Refactor Chat** - Konverzacna AI pre zlepsenie existujucich testov

### 5.9 Dokumenty (/documents)

4-krokovy wizard pre vytvorenie testoveho projektu z Word dokumentov:

**Krok 1: Nahrat subory**
- Drag-and-drop zona pre .docx/.doc subory
- Podpora viacerych suborov (max 20)
- Prehlad vybranych suborov s velkostou

**Krok 2: Konfiguracia projektu**
- Nazov projektu (automaticky navrhnuty z nazvu suboru)
- Prehlad vybranych suborov

**Krok 3: Pridat prirucku (volitelne)**
- Zadanie textu alebo nahranie suboru (.docx/.pdf/.txt)
- Automaticky chunking pre velke subory (> 10MB)
- Moznost preskocit tento krok

**Krok 4: Generovanie a sumar**
- Realtimovy log spracovania s casovymi znackami
- Progress bar 0-100%
- Statusove spravy: nahrávanie, parsovanie, spracovanie prirucky, generovanie, dokoncenie
- Tlacidlo "Ist na projekt" po uspesnom dokonceni

### 5.10 Navigacia (Sidebar)

Hierarchicky navigacny strom viditelny na vsetkych strankach:

```
Projekty
├── Projekt A
│   ├── Komponent 1
│   │   ├── Stranka 1.1
│   │   └── Stranka 1.2
│   └── Komponent 2
│       └── Stranka 2.1
└── Projekt B
    └── ...
```

- Rozbalovacie uzly s animaciou
- Automaticke zvyraznenie aktualnej stranky
- Mobilne menu (hamburger) pod 900px
- Klavesnicova podpora (Enter/Space/Escape)

---

## 6. API referencia

### Generovanie testov

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/generate` | POST | Generovanie z jednej Confluence stranky |
| `/api/batch/generate` | POST | Hromadne generovanie z viacerych stranok |
| `/api/batch/status/:batchJobId` | GET | Stav hromadneho spracovania |
| `/api/pages/:pageId/generate` | POST | Generovanie testov pre stranku |
| `/api/components/:componentId/generate` | POST | Generovanie integracnych testov |
| `/api/projects/:projectId/generate` | POST | Generovanie medzmodulovych testov |

#### POST /api/generate

**Vstup (link-based):**
```json
{
  "link": "https://domain.atlassian.net/wiki/spaces/SPACE/pages/123456/Title"
}
```

**Vstup (manualne):**
```json
{
  "title": "User Login",
  "description": "Pouzivatel sa moze prihlasit emailom a heslom",
  "acceptance_criteria": "Platne udaje umoznia prihlasenie",
  "metadata": {
    "system_type": "web",
    "feature_priority": "high",
    "parent_jira_issue_id": "AUTH-123"
  }
}
```

**Odpoved (202 Accepted):**
```json
{
  "job_id": "job-550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "message": "Test scenario generation started",
  "created_at": "2026-02-13T10:00:00.000Z"
}
```

#### POST /api/batch/generate

**Vstup:**
```json
{
  "links": [
    "https://domain.atlassian.net/wiki/spaces/SPACE/pages/123",
    "https://domain.atlassian.net/wiki/spaces/SPACE/pages/456"
  ],
  "generate_page_level_tests": true,
  "generate_module_level_tests": true
}
```

### Sprava jobov

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/jobs` | GET | Zoznam jobov (paginovany) |
| `/api/jobs/:jobId` | GET | Detail jobu |
| `/api/jobs/:jobId` | DELETE | Odstranenie jobu |
| `/api/jobs/:jobId/cancel` | POST | Zrusenie spracovania |
| `/api/jobs/:jobId/retry` | POST | Opakovanie neuspesneho jobu |

#### GET /api/jobs

**Query parametre:**
- `status` - Filtrovanie: processing, completed, failed, cancelled
- `limit` - Maximálny pocet (default: 50, max: 200)
- `offset` - Posun (default: 0)
- `since` - Len joby od daneho casu (ISO 8601)

### Review a validacia

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/review` | GET | Zoznam scenarov na review |
| `/api/review/:jobId/:testId` | PATCH | Uprava scenara |
| `/api/review/bulk` | POST | Hromadna akcia (akceptovat/zamietnut) |
| `/api/review/clean` | DELETE | Odstranenie vsetkych needs_review |

#### PATCH /api/review/:jobId/:testId

**Editovatelne polia:**
```json
{
  "test_name": "Overenie prihlasenia",
  "test_type": "functional",
  "scenario_classification": "happy_path",
  "description": "Ciel: Overit spravnost prihlasovania...",
  "preconditions": ["Platne konto", "Pristup k systemu"],
  "test_steps": [
    {
      "step_number": 1,
      "action": "Navigovat na prihlasovaciu stranku",
      "input": "URL: https://portal.example.com/login",
      "expected_result": "Zobrazi sa prihlasovaci formular"
    }
  ],
  "priority": "high",
  "automation_status": "ready_for_automation",
  "test_repository_folder": "KIS2/Login",
  "validation_notes": "Manualne opravene kroky"
}
```

### Hierarchia

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/projects` | GET/POST | Zoznam/vytvorenie projektov |
| `/api/projects/:id` | GET/PATCH/DELETE | CRUD projektu |
| `/api/components/:id` | GET/PATCH/DELETE | CRUD komponentu |
| `/api/components/project/:projectId` | POST | Vytvorenie komponentu |
| `/api/pages/:id` | GET/PATCH/DELETE | CRUD stranky |
| `/api/pages/component/:componentId` | POST | Pridanie stranky |
| `/api/hierarchy` | GET | Cely navigacny strom |

### Dokumenty

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/documents/create-project` | POST | Upload + vytvorenie projektu |
| `/api/documents/:docId` | GET | Stav dokumentu |
| `/api/documents/:docId/request-manual` | POST | Prechod na manualne doplnenie |
| `/api/documents/:docId/manual/text` | POST | Nahranie textovej prirucky |
| `/api/documents/:docId/manual/file` | POST | Nahranie suborovej prirucky |
| `/api/documents/generate-batch` | POST | Spustenie generovania |

### Export

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/export/excel` | POST | Export do Excel (.xlsx) |
| `/api/export/pdf` | POST | Export do PDF |

### Chat

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/chat/component/:componentId` | POST | AI chat pre komponent |
| `/api/chat/page/:pageId` | POST | AI chat pre stranku |

### Dalsie

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/health` | GET | Health check |
| `/api/dashboard/stats` | GET | Statistiky dashboardu |
| `/api/webhook/confluence` | POST | Confluence webhook prijímac |

#### GET /api/health

**Odpoved:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime_seconds": 3600,
  "mode": {
    "manual": true,
    "scheduled": false,
    "event_driven": false
  }
}
```

---

## 7. Spracovatelsky pipeline

System spracovava specifikacie cez 6-krokovy sekvencny pipeline orchestrovany v `src/pipeline/pipeline-orchestrator.ts`. Kazdy krok je casovany a logovany.

### Krok 1: Normalizacia vstupu

**Subor:** `src/pipeline/normalizer.ts`

- Odstranenie HTML tagov z Confluence obsahu
- Deduplikacia viet a normalizacia medzier
- Overenie pritomnosti aspon jedneho pola (title, description, acceptance_criteria)
- Formatovanie do struktury:
  ```
  Feature: {nazov}

  Description: {popis}

  Acceptance Criteria: {kriteria}
  ```
- Pripojenie doplnkoveho kontextu (ak existuje)
- Predvolene hodnoty pre chybajuce metadata: system_type='web', feature_priority='medium'

### Krok 2: Planovanie scenarov

**Subor:** `src/pipeline/scenario-planner.ts`

System urcuje optimalny pocet a typy testovacich scenarov:

**AI-Based planovanie:**
- Jednoduche funkcie: 1-2 scenare
- Stredne funkcie: 2-4 scenare
- Komplexne funkcie: 3-6 scenarov
- Maximum: 6 scenarov

**Pouzivatelsky override:**
```json
{
  "scenario_override": {
    "count": 3,
    "types": ["happy_path", "negative", "edge_case"]
  }
}
```

**Navrh priecinku repozitara:**
- Extrakcia kluca projektu z parent Jira issue
- Extrakcia nazvu funkcie z prveho textu
- Format: `ProjektKey/NazovFunkcie`

### Krok 3: Zostrojenie promptu

**Subor:** `src/pipeline/prompt-builder.ts`

**Systemova sprava definuje:**
- Persona: Senior QA Test Designer s 15+ rocnymi skusenostami
- ISTQB Advanced Level principy
- TestFlo format kompatibilita

**Kriticke pravidla:**
1. **TestFlo format** - Kazdy krok musi mat:
   - `action`: Co tester robi (slovensky: "Navigovat na stranku")
   - `input`: Data/parametre (moze byt prazdny)
   - `expected_result`: Ocakavany vysledok tohto konkretneho kroku

2. **Popis** - Zacina s "Ciel:" (Goal)

3. **Predpodmienky** - Pole samostatnych poloziek

4. **SLOVENSKY JAZYK** - VSETKO MUSI BYT V SLOVENCINE
   - test_name MUSI byt slovensky: "Overenie prihlasenia" NIE "Login Verification"
   - popis, predpodmienky, akcie, vstupy, ocakavane vysledky - VSETKO SLOVENSKY

5. **Klasifikacie scenarov:**
   - `happy_path`: Hlavny business workflow, platne data, end-to-end
   - `negative`: Neplatne vstupy, chybove stavy, validacia
   - `edge_case`: Hranicne hodnoty, specialne znaky, alternativne toky

### Krok 4: LLM invokacie s fallbackom

**Subor:** `src/pipeline/llm-client-v2.ts`

**Primarny pokus:**
1. Vytvorenie LLM providera podla `LLM_PROVIDER`
2. Volanie s primarnym profilom (teplota 0.2 pre Claude, 0.3 pre Ollama)
3. Extrakcia scenarov z JSON odpovede

**LLM-level fallback** (ak je aktivny a primarny zlyhal):
1. Aktivacia: `VALIDATION_FALLBACK_ENABLED=true` A (primarny zlyhal ALEBO vratil 0 scenarov)
2. Pouzitie ineho providera cez `createFallbackProvider()`
3. Prisnejsie nastavenia: teplota=0.0, dodatok k promptu pre presnost
4. Pouzitie fallback scenarov ak su uspesne

**Normalizacia LLM vystupu:**
| Vstup od LLM | Normalizovany vystup |
|---------------|---------------------|
| "happy", "positive" | "happy_path" |
| "edge", "boundary" | "edge_case" |
| "error", "failure" | "negative" |
| "regress*" | "regression" |
| "function*" | "functional" |
| "p1", "highest" | "critical" |
| "p2" | "high" |
| "p3", "normal" | "medium" |
| "p4", "lowest" | "low" |

**Obohacovanie scenarov:**
- `test_id`: "test-{UUID}"
- `tags`: ['ai-generated', 'primary-attempt' alebo 'fallback-attempt']
- `traceability`: source_confluence_page_id, generated_at, llm_model
- `validation_status`: 'validated' (moze byt prepisany validatorom)

### Krok 5: Validacia s auto-korekciou

**Subor:** `src/pipeline/validator.ts`

**Validacne pravidla:**

**1. Povinne polia:**
- test_name, description - neprazdne
- test_type: functional | regression | smoke
- scenario_classification: happy_path | negative | edge_case
- preconditions: neprazdne pole
- test_steps: neprazdne pole TestStep objektov
- Kazdy TestStep: action + expected_result povinne
- priority: critical | high | medium | low

**2. Jasnost testovacich krokov:**
- Kazdy krok minimum 10 znakov
- Musi obsahovat akciove sloveso:
  - Anglicke: click, enter, select, verify, navigate, submit, open, close, check, type, fill, scroll, press...
  - Slovenske: kliknut, zadat, vybrat, otvorit, zatvorit, navigovat, overit, skontrolovat, odoslat, vyplnit, zvolit, stlacit...
- Ziadne placeholdery: TODO, TBD, [insert], [...], xxx, ___

**3. Detekcia novych konceptov:**
- Textova podobnost s prahom 0.3 (30%)
- Extrakcia klucovych slov zo specifikacie a testu
- Povolene testovace terminy (EN + SK)
- Povolene domenove terminy: portal, sprava, ciselnik, hierarchia, modul...
- Scenar s novymi konceptami oznaceny ako 'needs_review'

**4. Sledovatelnost:**
- parent_jira_issue_id: pritomny a zhodny so vstupom
- source_confluence_page_id: pritomny
- generated_at: platny ISO 8601 timestamp
- llm_model: pritomny

**Validacny-level fallback rozhodnutie:**

Ak existuju fallback scenare, validator spracuje OBE sady a vyberie lepsiu:

```
Pouzi fallback scenare AK:
  primary.needs_review > fallback.needs_review ALEBO
  primary.validated == 0 A fallback.validated > 0 ALEBO
  !primary.success A fallback.success
INAK:
  Pouzi primarne scenare
```

**Stavy validacie:**
- `validated` - Presiel vsetkymi kontrolami
- `needs_review` - Zlyhal v jednej alebo viacerych kontrolach
- `failed` - Kriticke chyby, neopravitelne
- `dismissed` - Manualne zamietnuty pouzivatelom

### Krok 6: Jira formatovanie

**Subor:** `src/pipeline/jira-formatter.ts`

- Filtruje iba scenare so statusom `validated`
- Pre kazdy scenar vytvori Jira API payload:
  - Projektovy kluc z konfiguracie
  - Typ issue, summary (nazov testu)
  - Popis: Ciel > Predpodmienky > Testovacie kroky (tabulka) > Ocakavany vysledok
  - Mapovanie priority: critical→Highest, high→High, medium→Medium, low→Low
  - Labels: ai-generated, klasifikacia, typ testu, stav automatizacie
  - Custom field mapovania z config/jira.json
- Ulozenie suborov:
  - `data/jira_payloads/{pageId}_{testId}.json` - Per-scenar payload
  - `data/jira_payloads/{pageId}_summary.json` - Sumarne info

---

## 8. Rezimy vykonavania

System podporuje 3 nezavisle rezimy vykonavania. Kazdy moze byt samostatne aktivny/neaktivny. Minimalne jeden musi byt aktivny.

### 8.1 Manualny rezim (REST API)

**Subor:** `src/modes/manual.ts`

Hlavny interaktivny rezim - spusta Express server na konfigurovanom porte.

**Tok spracovania:**
1. Pouzivatel posle POST `/api/generate` s odkazom alebo manualnym vstupom
2. Server vrati 202 Accepted s job_id okamzite
3. `processJobAsync()` bezi na pozadi:
   - Validacia Confluence URL
   - Extrakcia page ID
   - Stiahnutie obsahu z Confluence s retry logikou (3 pokusy, 2s oneskorenie, exponencialny backoff)
   - Vykonanie pipeline
   - Aktualizacia stavu jobu
4. Klient polluje GET `/api/jobs/:jobId` pre vysledky

### 8.2 Planovany rezim (Cron)

**Subor:** `src/modes/scheduled.ts`

Automaticke periodicke skenovanie Confluence na zaklade cron vyrazu.

**Tok spracovania:**
1. Cron uloha sa spusti podla `cron_expression` (napr. "0 */6 * * *" = kazdy 6 hodin)
2. Precita stav schedulera (posledny cas behu)
3. Vyhlada Confluence stranky aktualizovane od posledneho behu
4. Pre kazdu stranku: stiahne obsah → vytvori job → vykona pipeline
5. Ulozi stav schedulera s aktualnym casom

**Konfiguracia v execution-modes.json:**
```json
{
  "scheduled": {
    "enabled": true,
    "cron_expression": "0 */6 * * *"
  }
}
```

### 8.3 Event-driven rezim (Webhook)

**Subor:** `src/modes/event-driven.ts`

Spracovanie na zaklade Confluence webhook udalosti v realnom case.

**Tok spracovania:**
1. Confluence posle webhook na POST `/api/webhook/confluence`
2. System validuje HMAC-SHA256 podpis pomocou `webhook_secret`
3. Filtruje udalosti podla monitorovanych priestorov
4. Spracovava zodpovedajuce udalosti asynchronne (fire-and-forget)

**Vyzadovana konfiguracia:**
- `webhook_secret` v execution-modes.json
- Nastavenie webhooku v Confluence admin

---

## 9. LLM provideri

### 9.1 Provider Factory

**Subor:** `src/llm/provider-factory.ts`

Factory pattern pre dynamicke vytvaranie LLM providerov.

```typescript
// Primarny provider
const provider = createLlmProvider();      // Pouzije LLM_PROVIDER env var
const provider = createLlmProvider('claude'); // Explicitne

// Fallback provider
const fallback = createFallbackProvider(); // Pouzije LLM_FALLBACK_PROVIDER env var
```

**Logika:**
1. Precita nazov providera (parameter → env var → default 'ollama')
2. Overi dostupnost (napr. Claude CLI check)
3. Ak nedostupny: fallback na Ollama s warningom

### 9.2 Claude Provider

**Subor:** `src/llm/providers/claude-provider.ts`

Pouziva Claude CLI ako subprocess pre generovanie.

**Konfiguracne premenne:**
| Premenna | Default | Popis |
|----------|---------|-------|
| CLAUDE_CLI_PATH | claude | Cesta k CLI |
| CLAUDE_MODEL | sonnet | Primarny model |
| CLAUDE_TEMPERATURE | 0.2 | Primarny teplota |
| CLAUDE_MAX_TOKENS | 4096 | Max tokenov |
| CLAUDE_TIMEOUT_MS | 120000 | Timeout (2 min) |
| CLAUDE_MODEL_FALLBACK | haiku | Fallback model |
| CLAUDE_TEMPERATURE_FALLBACK | 0.0 | Fallback teplota |

**Vlastnosti:**
- Spawn Claude CLI procesu s piping stdin/stdout
- Retry logika (3 pokusy s exponencialnym backoffom)
- Sledovanie spotreby tokenov
- JSON repair logika (odstranenie textu pred/po JSON)
- Extrakcia z markdown blokov (```json ... ```)

### 9.3 Ollama Provider

**Subor:** `src/llm/providers/ollama-provider.ts`

Pouziva Ollama SDK pre lokalne LLM modely.

**Konfiguracne premenne:**
| Premenna | Default | Popis |
|----------|---------|-------|
| OLLAMA_BASE_URL | http://localhost:11434 | Ollama server |
| OLLAMA_MODEL_PRIMARY | llama2 | Primarny model |
| OLLAMA_TEMPERATURE_PRIMARY | 0.3 | Primarny teplota |
| OLLAMA_MODEL_FALLBACK | - | Fallback model |
| OLLAMA_TEMPERATURE_FALLBACK | 0.0 | Fallback teplota |

**Vlastnosti:**
- Ollama SDK v0.6.3
- JSON format enforcement
- JSON repair logika: oprava trailing commas, unquoted keys, unicode
- Ziadne sledovanie tokenov (Ollama neposkytuje tieto data)

### 9.4 LLM rozhranie

Vsetci provideri implementuju rozhranie `LlmProvider`:

```typescript
interface LlmProvider {
  name: string;
  generateCompletion(
    messages: ChatMessage[],
    options?: LlmGenerationOptions
  ): Promise<LlmResult>;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LlmResult {
  content: string;
  usage?: { prompt_tokens, completion_tokens, total_tokens };
  model?: string;
  temperature?: number;
}
```

### 9.5 Dvojuroven fallback strategia

```
┌─────────────────────────────────────────┐
│         UROVEN 1: LLM Fallback          │
│                                         │
│  Primarny provider (napr. Claude)       │
│         │ Zlyhanie/0 scenarov           │
│         ▼                               │
│  Fallback provider (napr. Ollama)       │
│  - teplota = 0.0                        │
│  - pridany precision suffix k promptu   │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│       UROVEN 2: Validacny Fallback      │
│                                         │
│  Validacia OBOCH sad scenarov           │
│         │                               │
│         ▼                               │
│  Vyber lepsej sady podla metrik:        │
│  - Menej needs_review → lepsie          │
│  - Viac validated → lepsie              │
│  - Fallback uspesny, primarny nie       │
└─────────────────────────────────────────┘
```

Obe urovne su riadene premennou `VALIDATION_FALLBACK_ENABLED`.

---

## 10. Hierarchia projektov

System pouziva 3-urovnovu hierarchiu pre organizaciu testov:

```
Projekt
├── Komponent A
│   ├── Stranka 1 (Confluence / dokument)
│   │   └── Testovacie scenare (page-level)
│   ├── Stranka 2
│   │   └── Testovacie scenare (page-level)
│   └── Integracne testy (component-level)
├── Komponent B
│   ├── Stranka 3
│   │   └── Testovacie scenare (page-level)
│   └── Integracne testy (component-level)
└── Medzmodulove testy (project-level)
```

### Projekt

**Model:** `src/models/project.ts`

Najvyssia uroven hierarchie.

- Obsahuje mnozinu komponentov
- Moze mat projektovy kontext (prirucka/manual)
- Projektove testy pokryvaju medzmodulove interakcie
- Metadata: Jira projekt kluc, system type, zdroj dat

### Komponent

**Model:** `src/models/component.ts`

Logicky modul v ramci projektu.

- Patri do jedneho projektu
- Obsahuje mnozinu stranok
- Integracne testy pokryvaju interakcie medzi strankami v ramci komponentu
- Podpora zavislosti na inych komponentoch

### Stranka (Page)

**Model:** `src/models/page.ts`

Najnizsia uroven - konkretny dokument/specifikacia.

- Patri do jedneho komponentu
- Zdrojovy typ: Confluence alebo nahraneny dokument
- Historia jobov (vsetky generovane)
- Cachovane sumarni testov (total, validated, needs_review)
- Podpora doplnkoveho kontextu
- Podpora zavislosti na inych strankach

### Urovne generovania testov

| Uroven | Zameranie | Generator |
|--------|-----------|-----------|
| **Page-level** | Jednotliva specifikacia, konkretne funkcie | Standardny pipeline |
| **Component-level (Integracne)** | Vzajomne posobenie stranok v ramci komponentu | module-test-generator |
| **Project-level (Medzmodulove)** | Medzkomponentove interakcie, E2E toky | project-test-generator |

---

## 11. Spracovanie dokumentov

### Podporovane formaty

- **Word dokumenty**: .docx, .doc (cez mammoth kniznica)
- **PDF subory**: .pdf (cez pdf-parse)
- **Textove subory**: .txt

### Workflow spracovania dokumentu

```
Upload .docx ──> Parsovanie ──> Detekcia stranok ──> (Volitelne) Pridat prirucku
                                                           │
                                                           ▼
                                                    Generovanie testov
                                                           │
                                                           ▼
                                              Projekt s hierarchiou
```

**Podrobne kroky:**

1. **Upload** - Nahranie suborov cez drag-and-drop alebo file input
2. **Vytvorenie projektu** - Automaticke vytvorenie projektu, komponentov, stranok
3. **Parsovanie** - Extrakcia textu z dokumentu, detekcia sekcii/modulov
4. **Chunking** - Pre velke dokumenty:
   - Cielova velkost chunku: 3000 tokenov
   - Maximalny chunk: 5000 tokenov
   - Prekrytie: 200 tokenov
   - Minimalne relevance skore: 0.1
5. **Prirucka** - Volitelne pridanie kontextu (manualu/handbook)
6. **Generovanie** - Batch generovanie testov pre vsetky detekovane stranky

### Chunking konfiguracia

Velke dokumenty su rozdelene na mensi casti (chunks) pre efektivne spracovanie LLM:

| Parameter | Hodnota | Popis |
|-----------|---------|-------|
| upload_limit_mb | 200 | Maximalny upload (MB) |
| max_context_tokens | 50000 | Max tokenov v kontexte |
| chunk_target_tokens | 3000 | Cielova velkost chunku |
| chunk_max_tokens | 5000 | Maximalny chunk |
| chunk_overlap_tokens | 200 | Prekrytie medzi chunkami |
| min_relevance_score | 0.1 | Min. relevancia pre zahrnutie |
| max_chunks_per_request | 20 | Max chunkov na request |
| chars_per_token | 4 | Odhadovany pomer znakov k tokenom |

---

## 12. Export a vystupy

### Excel export

**Generator:** `src/export/excel-generator.ts`

Generuje .xlsx subory pomocou ExcelJS s:
- Hlavickovou tabulkou
- Scenare zoskupene podla jobu
- Stlpce: nazov, typ, klasifikacia, priorita, popis, predpodmienky, kroky, ocakavany vysledok
- Formatovanie: farby podla priority a statusu

### PDF export

**Generator:** `src/export/pdf-generator.ts`

Generuje PDF dokumenty pomocou pdfmake s:
- Profesionalnym layoutom
- Tabulkami testovacich krokov
- Farebnym kódovanim podla priority
- Hlavickou a patickou

### Vystupne formaty

Oba formaty su dostupne cez:
- Review Desk - export filtrovaných scenarov
- Detail projektu - export medzmodulovych testov
- Detail komponentu - export integracnych testov
- Detail stranky - export strankovych testov

**API:**
```
POST /api/export/excel  - Telo: { scenarios: [...], title: "Nazov" }
POST /api/export/pdf    - Telo: { scenarios: [...], title: "Nazov" }
```

Odpoved: Binary blob suboru na stiahnutie.

---

## 13. Monitoring a naklady

### Sledovanie nakladov (Cost Tracking)

**Subor:** `src/monitoring/cost-tracker.ts`

- Kazde volanie LLM zaznamenava spotrebu tokenov
- Denne reporty generovane o polnoci (UTC)
- Reporty ulozene v `logs/cost-reports/`

**Format denneho reportu:**
```json
{
  "date": "2026-02-13",
  "model": "claude-sonnet",
  "total_requests": 42,
  "total_tokens": {
    "prompt": 125000,
    "completion": 85000,
    "total": 210000
  },
  "estimated_cost_usd": 0.0,
  "breakdown_by_mode": {
    "manual": { "requests": 30, "cost_usd": 0.0 },
    "scheduled": { "requests": 10, "cost_usd": 0.0 },
    "event_driven": { "requests": 2, "cost_usd": 0.0 }
  }
}
```

### Metricke data

**Subor:** `src/monitoring/metrics-collector.ts`

- Denne metriky vykonnosti
- Casovanie kazdeho kroku pipeline
- Pocet uspesnych/neuspesnych jobov
- Ulozene v `logs/metrics/`

### Logovanie

**Subor:** `src/utils/logger.ts`

Winston logger s dennymi rotaciami:

| Subor | Ucel | Retencia |
|-------|------|----------|
| `app-%DATE%.log` | Hlavny log (vsetky urovne) | 30 dni |
| `error-%DATE%.log` | Len chyby | 90 dni |
| `exceptions-%DATE%.log` | Nezachytene vynimky | 90 dni |
| `rejections-%DATE%.log` | Neosetrene promise rejection | 90 dni |
| Konzola | Farebny vystup (development) | - |

**Urovne logov:** silly < debug < verbose < info < warn < error

**Context Logger vzor:**
```typescript
const contextLogger = createContextLogger({
  step: 'normalization',
  job_id: jobId,
  confluence_page_id: pageId,
  parent_jira_issue_id: issueId
});
contextLogger.info('Normalizacia dokoncena', { duration_ms: 150 });
```

---

## 14. Bezpecnost

### HTTP hlavicky

- **Helmet** - Nastavenie bezpecnostnych HTTP hlaviciek na vsetkych odpovediach
- Content-Security-Policy, X-Content-Type-Options, Strict-Transport-Security, atd.

### Rate Limiting

- **express-rate-limit** - Ochrana pred zaplnenim API
- Konfigurovatelne limity podla endpointu

### CORS

- Konfigurovatelne origins v `execution-modes.json`
- Moze byt uplne deaktivovany

### Vstupna validacia

- **Joi** schema validacia na vsetkych API vstupoch
- Kontrola typu: system_type (web|api|mobile), feature_priority (critical|high|medium|low)
- Validacia URL formatu pre Confluence odkazy
- Maximalny upload limit: 200 MB

### Webhook autentifikacia

- HMAC-SHA256 overenie podpisu pre Confluence webhooky
- Webhook secret vyzadovany v konfiguraci

### Frontend bezpecnost

- HTML escaping pre vsetky uzivatelsky zobrazene data (XSS prevencia)
- `textContent` namiesto `innerHTML` pre dynamicky obsah
- Content-Type hlavicky na vsetkych API volaniach

### Doporucenia

- Nikdy necommitujte `.env` subor do Gitu
- Pouzivajte silne `webhook_secret` v produkcii
- Neposkytujte log subory verejne (obsahuju full API payloady)
- V produkcii nastavte `NODE_ENV=production` (skryje stack traces v chybovych odpovediach)

---

## 15. Datova struktura

### Suborovy storage

System pouziva suborovy JSON storage (bez databazy):

```
data/
├── jobs/                           # Job zaznamy
│   └── {jobId}.json
├── batch_jobs/                     # Batch job zaznamy
│   └── {batchJobId}.json
├── projects/                       # Projekt zaznamy
│   └── {projectId}.json
├── components/                     # Komponent zaznamy
│   └── {componentId}.json
├── pages/                          # Stranka zaznamy
│   └── {pageId}.json
├── documents/                      # Dokument zaznamy
│   └── {documentId}.json
├── chunks/                         # Dokument chunky
│   └── {chunkId}.json
├── generated/                      # Validovane scenare
│   └── {pageId}_{timestamp}.json
├── needs_review/                   # Scenare na review
│   └── {pageId}_{timestamp}.json
├── jira_payloads/                  # Jira API payloady
│   ├── {pageId}_{testId}.json     # Per-scenar
│   └── {pageId}_summary.json     # Sumar
├── metadata/                       # Metadata generovania
│   └── {pageId}_{timestamp}_metadata.json
├── uploads/                        # Nahrané dokumenty
└── scheduler_state.json            # Stav cronu
```

### Klucove datove modely

#### Job
```typescript
{
  job_id: "job-{uuid}",
  status: "processing" | "completed" | "failed" | "cancelled",
  input: SpecificationInput,
  created_at: "ISO 8601",
  completed_at?: "ISO 8601",
  results?: {
    total_scenarios: number,
    validated_scenarios: number,
    needs_review_scenarios: number,
    scenarios: GeneratedTestScenario[]
  },
  error?: string,
  project_id?: string,
  component_id?: string,
  page_id?: string
}
```

#### Generovany testovaci scenar
```typescript
{
  test_id: "test-{uuid}",
  test_name: "Overenie prihlasenia pouzivatela",
  description: "Ciel: Overit funkcionalitu prihlasovania...",
  test_type: "functional" | "regression" | "smoke",
  scenario_classification: "happy_path" | "negative" | "edge_case",
  preconditions: ["Platne konto", "Pristup k systemu"],
  test_steps: [
    {
      step_number: 1,
      action: "Navigovat na prihlasovaciu stranku",
      input: "URL: https://portal.example.com/login",
      expected_result: "Zobrazi sa prihlasovaci formular"
    }
  ],
  priority: "critical" | "high" | "medium" | "low",
  automation_status: "ready_for_automation" | "automation_not_needed",
  test_repository_folder: "KIS2/Login",
  tags: ["ai-generated", "primary-attempt"],
  parent_jira_issue_id: "AUTH-123",
  traceability: {
    source_confluence_page_id: "123456",
    source_specification_version: "3",
    generated_at: "2026-02-13T10:00:00.000Z",
    llm_model: "claude/sonnet"
  },
  validation_status: "validated" | "needs_review" | "failed" | "dismissed",
  validation_notes?: "Scenar presiel vsetkymi kontrolami"
}
```

---

## 16. Praca s logmi

### Prehlad logovacich suborov

```
logs/
├── app-2026-02-13.log              # Hlavny log (JSON format)
├── error-2026-02-13.log            # Len chyby (JSON format)
├── exceptions-2026-02-13.log       # Vynimky
├── rejections-2026-02-13.log       # Promise rejections
├── cost-reports/                    # Denne nakladove reporty
│   └── 2026-02-13_sonnet.json
└── metrics/                         # Denne metricke data
    └── 2026-02-13_metrics.json
```

### Format logovej spravy

```json
{
  "timestamp": "2026-02-13T10:00:00.000Z",
  "level": "info",
  "message": "Pipeline krok dokonceny",
  "step": "normalization",
  "job_id": "job-550e8400...",
  "confluence_page_id": "123456",
  "parent_jira_issue_id": "AUTH-123",
  "duration_ms": 150
}
```

### Ako citat logy

**Sledovanie konkretneho jobu:**
Vyhladajte logy podla `job_id` pre sledovanie celho zivotneho cyklu jobu.

**Sledovanie chyb:**
Otvorte `error-*.log` pre rýchly prehlad vsetkych chyb.

**Sledovanie fallback rozhodovania:**
Hladajte spravy obsahujuce "Validation-triggered fallback decision" pre informacie o tom, ktora sada scenarov bola pouzita.

---

## 17. Rozsirenie systemu

### Pridanie noveho LLM providera

1. Vytvorte `src/llm/providers/{provider}-provider.ts` implementujuc `LlmProvider` rozhranie
2. Pridajte do `src/llm/provider-factory.ts` switch statement
3. Pridajte env var validaciu do `src/index.ts` funkcie `validateConfigurations()`
4. Otestujte s primarnou aj fallback konfiguraciou

**Sablona:**
```typescript
import { LlmProvider, ChatMessage, LlmResult, LlmGenerationOptions } from '../types';

export class NewProvider implements LlmProvider {
  name = 'new-provider';

  async generateCompletion(
    messages: ChatMessage[],
    options?: LlmGenerationOptions
  ): Promise<LlmResult> {
    // Implementacia
    return { content: '...' };
  }
}
```

### Uprava validacnych pravidiel

Editujte `src/pipeline/validator.ts`:
- `validateRequiredFields()` - Pritomnost poli a enum validacia
- `validateTestStepsClarity()` - Kontrola kvality krokov (dlzka, slovesa, placeholdery)
- `validateNewFunctionality()` - Prah podobnosti (momentalne 0.3)
- `validateTraceability()` - Konzistencia metadat

### Pridanie noveho API endpointu

1. Vytvorte route subor v `src/api/routes/`
2. Zaregistrujte v `src/api/server.ts` funkcia `createExpressApp()`
3. Pridajte middleware ak treba v `src/api/middleware/`

### Zmena Jira vystupu

- Editujte `src/pipeline/jira-formatter.ts` funkcia `formatForJira()`
- Aktualizujte `custom_field_mappings` v `config/jira.json`
- Upravte mapovanie priorit v `buildJiraPayload()`

### Pridanie noveho UI view

1. Vytvorte `public/{nazov}.html` a `public/{nazov}.js`
2. Pridajte route v `src/api/server.ts` (napr. `app.get('/nazov', ...)`)
3. Pridajte navigacny odkaz do sidebaru ak treba
4. Pouzite existujuce zdielane komponenty: sidebar.js, toast.js, export-helper.js

---

## 18. Riesenie problemov

### Caste problemy

#### System sa nespusti

**Priciná:** Chybajuce premenne prostredia alebo konfiguracne subory.

**Riesenie:**
1. Overte existenciu `.env` suboru
2. Overte pritomnost vsetkych `config/*.json` suborov
3. Overte aspon jeden aktivny rezim v `execution-modes.json`
4. Skontrolujte logy v `logs/error-*.log`

#### Claude provider nie je dostupny

**Priciná:** Claude CLI nie je nainstalovany alebo nie je na PATH.

**Riesenie:**
1. Overte: `claude --version`
2. Nastavte CLAUDE_CLI_PATH na plnu cestu
3. System automaticky prepne na Ollama ako fallback

#### Ollama provider nereaguje

**Priciná:** Ollama server nebezi.

**Riesenie:**
1. Overte: `curl http://localhost:11434/api/tags`
2. Spustite Ollama server: `ollama serve`
3. Overte model: `ollama list`

#### LLM vracia neplatny JSON

**Priciná:** LLM model generuje text mimo JSON formatu.

**Riesenie:**
System ma vstavaný JSON repair:
- Odstranenie textu pred/po JSON
- Oprava trailing commas
- Oprava unquoted keys
- Extrakcia z markdown blokov

Ak to nepomaha:
- Pouzite model s lepsim JSON adherence
- Znizite teplotu (CLAUDE_TEMPERATURE=0.0)
- Aktivujte fallback (VALIDATION_FALLBACK_ENABLED=true)

#### Testovacie kroky nie su po slovensky

**Priciná:** LLM ignoroval jazykovu instrukciu.

**Riesenie:**
- Prompt obsahuje 5+ opakovani slovenskeho jazyka
- Aktivujte fallback pre prisnejsi prompt (teplota=0.0)
- Skontrolujte ci sa pouziva spravny prompt-builder

#### Scenare stale v stave "needs_review"

**Priciná:** Validacia oznacila scenare ako problematicke.

**Riesenie:**
1. Otvorte Review Desk (/review)
2. Pozrite validation_notes pre dôvod
3. Editujte a opravte scenar manualne
4. Akceptujte opraveny scenar

### Health check

```bash
curl http://localhost:3000/api/health
```

Ocakavana odpoved:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime_seconds": 3600,
  "mode": {
    "manual": true,
    "scheduled": false,
    "event_driven": false
  }
}
```

### Diagnosticke kroky

1. **Skontrolujte zdravie:** `GET /api/health`
2. **Skontrolujte logy:** `logs/app-{datum}.log` a `logs/error-{datum}.log`
3. **Overte LLM providera:** Pozorovanie logov s tagom `step: 'llm-invocation'`
4. **Overte Confluence pristup:** Skontrolujte logy s tagom `step: 'confluence-fetch'`
5. **Overte Jira pristup:** Skontrolujte logy s tagom `step: 'jira-format'`

---

*Generovane pre AI Orchestrator Module 4.1 - Verzia 1.0.0*
*Posledna aktualizacia: 2026-02-13*
