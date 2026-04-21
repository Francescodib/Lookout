# Lookout

> Automated monitor for Italy's Registro Nazionale Aiuti di Stato (RNA) with Telegram notifications.

---

## Obiettivo

Lookout è un tool Node.js che interroga periodicamente l'API pubblica del portale RNA (`rna.gov.it`) per una o più partite IVA, rileva nuovi aiuti di Stato concessi e invia notifiche via Telegram Bot.

---

## Findings dall'analisi del portale

### API Endpoint scoperto

```
POST https://www.rna.gov.it/rna/oracle/query/trasparenza/aiuti
Content-Type: application/json
```

**Response format** (confermato):
```json
{
  "recordsTotal": 0,
  "recordsFiltered": 0,
  "data": [],
  "sleep": 30
}
```

- L'endpoint è pubblico, non richiede autenticazione.
- Risponde JSON.
- Il campo `sleep` (30) suggerisce un rate limit: probabilmente max 1 request ogni 30 secondi.
- Il frontend usa **DataTables server-side processing**.

### Payload: da investigare

Il payload esatto non è stato ancora determinato. Test con nomi campo semplici (`cfBeneficiario`, `codiceFiscale`, `partitaIva`, ecc.) restituiscono `recordsTotal: 0`.

**Ipotesi forte**: il frontend DataTables invia i parametri nel formato standard server-side:

```json
{
  "draw": 1,
  "start": 0,
  "length": 100,
  "columns": [
    { "data": 0, "name": "", "searchable": true, "orderable": true, "search": { "value": "", "regex": false } },
    ...
    { "data": 8, "name": "", "searchable": true, "orderable": true, "search": { "value": "12345678901", "regex": false } }
  ],
  "order": [{ "column": 7, "dir": "desc" }],
  "search": { "value": "", "regex": false }
}
```

**Strategia per scoprire il payload corretto** (in ordine di priorità):

1. **Ispezionare il bundle JS della pagina** -- cercare la configurazione DataTables (`ajax`, `columns`, `serverSide`). L'URL della pagina è `https://www.rna.gov.it/trasparenza/aiuti`. Il JS è probabilmente in un file sotto `/sites/rna.mise.gov.it/themes/custom/rna/build/`.

2. **Intercettare via DevTools manualmente** -- aprire la pagina in Chrome, F12 > Network > filtrare per `oracle`, compilare C.F. Beneficiario con `12345678901` (mock), cliccare "Avvia ricerca", copiare la request come "Copy as fetch" o "Copy as cURL".

3. **Formato DataTables standard** -- provare il formato DataTables con `columns[n][search][value]` dove `n` corrisponde alla colonna C.F. Beneficiario (probabile indice 8, confermato dall'ordine delle colonne nella tabella risultati).

### Struttura della pagina

La pagina `https://www.rna.gov.it/trasparenza/aiuti` (sezione "Aiuti individuali") ha:

**Form di ricerca** con questi campi:
| Campo | Tipo | Note |
|---|---|---|
| Numero di riferimento della misura di aiuto (CE) | text | |
| CAR | text | Codice Aiuto Registrato |
| Tutte le versioni | checkbox | |
| Autorità che concede l'aiuto (soggetto concedente) | text | |
| COR | text | Codice identificativo dell'Aiuto |
| **C.F. Beneficiario** | **text** | **Campo chiave per la ricerca** |
| Data concessione (da) | date | |
| Data concessione (a) | date | |
| Tipo Procedimento | select | Notifica / Esenzione / De Minimis |

**Ricerca avanzata** (campi aggiuntivi):
| Campo | Tipo |
|---|---|
| Titolo Progetto | text |
| Denominazione Beneficiario | text |
| Regolamento/comunicazione | select |
| Regione | select |
| Importo | select (range) |
| Regime quadro | select (Sì/No) |

**Tabella risultati** -- colonne:
1. Codice CAR
2. Codice CE
3. Titolo Misura
4. Tipo Misura
5. COR
6. Titolo Progetto
7. Data Concessione
8. Denominazione Beneficiario
9. C.F. Beneficiario
10. Regione
11. Elemento Aiuto
12. Dettaglio

La tabella supporta export **XLSX** e **CSV** (link presenti nella pagina: `Scarica XLSX`, `Scarica CSV`).

### Note tecniche

- Il sito usa **Drupal** come CMS con tema custom.
- La sezione trasparenza è un'app **server-side rendered** con DataTables jQuery.
- È presente **reCAPTCHA** (elemento `ref_357` nella pagina) -- potrebbe attivarsi con troppe request.
- Cookie consent banner con opzioni Accetta/Rifiuta.
- Il portale menziona esplicitamente una sezione **Open Data** (`/open-data`) che potrebbe avere bulk download alternativi.
- Esiste un sottodominio `dsantf.rna.gov.it` che sembra un frontend alternativo per la trasparenza.

---

## Architettura proposta

```
lookout/
├── src/
│   ├── index.ts              # Entry point, scheduler
│   ├── config.ts             # Configuration loader (.env)
│   ├── rna-client.ts         # RNA API client
│   ├── diff-engine.ts        # Compares current vs stored state
│   ├── telegram-notifier.ts  # Telegram Bot API integration
│   └── store.ts              # SQLite persistence layer
├── data/
│   └── lookout.db            # SQLite database (auto-created)
├── .env.example
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

### Stack

- **Runtime**: Node.js + TypeScript
- **HTTP client**: `undici` (built-in) o `node-fetch`
- **Storage**: `better-sqlite3` per lo stato degli aiuti
- **Scheduler**: `node-cron`
- **Telegram**: chiamate HTTP dirette alla Bot API (no lib esterne necessarie)
- **Config**: `dotenv`

### Flusso

```
1. [Cron job ogni N minuti]
2. Per ogni P.IVA configurata:
   a. POST all'endpoint RNA con il payload corretto
   b. Parse della response JSON
   c. Confronto con lo stato in SQLite (chiave: COR - Codice identificativo Aiuto)
   d. Se ci sono nuovi record (COR non presenti nel DB):
      - Salva in SQLite
      - Invia notifica Telegram con riepilogo
3. Log dell'esecuzione
```

### Notifica Telegram (formato proposto)

```
🔔 *Lookout* — Nuovo aiuto rilevato

*Beneficiario*: NOME AZIENDA
*P.IVA*: 12345678901
*Titolo Misura*: ...
*Tipo*: De Minimis
*Data Concessione*: 2025-03-15
*Importo*: €XX.XXX
*COR*: XXXXXXX
*Regione*: Emilia-Romagna
```

---

## Configurazione (.env)

```env
# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC-DEF
TELEGRAM_CHAT_ID=-1001234567890

# Monitoring targets (comma-separated P.IVA list)
WATCH_PIVA=12345678901,XXXXXXXXXXX

# Schedule (cron expression, default: every 6 hours)
CRON_SCHEDULE=0 */6 * * *

# RNA API
RNA_API_URL=https://www.rna.gov.it/rna/oracle/query/trasparenza/aiuti
RNA_REQUEST_DELAY_MS=30000

# Optional
LOG_LEVEL=info
```

---

## Task per Claude Code

### Fase 1: Reverse engineering del payload (PRIORITÀ MASSIMA)

1. Scaricare e analizzare il JS bundle della pagina `https://www.rna.gov.it/trasparenza/aiuti` per trovare la configurazione DataTables e il mapping esatto dei parametri POST.
2. Se il JS è offuscato/minificato, provare il formato DataTables server-side standard con le 12 colonne nell'ordine elencato sopra, con `columns[8][search][value]` = P.IVA.
3. Validare con un test fetch diretto che `recordsTotal > 0` per una P.IVA di test (es. `12345678901`).

### Fase 2: Scaffold del progetto

1. Inizializzare il progetto Node.js + TypeScript.
2. Implementare `rna-client.ts` con il payload corretto.
3. Implementare `store.ts` con schema SQLite.
4. Implementare `diff-engine.ts`.
5. Implementare `telegram-notifier.ts`.
6. Collegare tutto in `index.ts` con `node-cron`.

### Fase 3: Testing e hardening

1. Gestione errori (network timeout, rate limit, reCAPTCHA block).
2. Retry con exponential backoff.
3. Logging strutturato.
4. Dry-run mode (no Telegram, solo log).
5. Comando CLI per query manuale: `npx lookout check 12345678901`.

### Fase 4: Nice-to-have

- Dashboard web minimale (Express + HTML) per visualizzare lo storico aiuti.
- Export CSV/XLSX dello storico.
- Supporto multiple chat Telegram per P.IVA diverse.
- Docker image per deploy su VPS/Raspberry Pi.

---

## Note importanti

- Rispettare il rate limit suggerito dal campo `sleep: 30` nella response (almeno 30s tra le request).
- Il reCAPTCHA potrebbe attivarsi: prevedere un fallback o alert se la response non è JSON valido.
- I dati del portale RNA sono pubblici per legge (Legge 115/2015) e accessibili senza restrizioni.
- Il portale Open Data potrebbe offrire alternative meno fragili all'API diretta: valutare `https://www.rna.gov.it/open-data` come fallback.
