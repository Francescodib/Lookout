# Lookout

Automated monitor for Italy's **Registro Nazionale Aiuti di Stato** (RNA) with interactive Telegram bot.

Lookout queries the public RNA portal (`rna.gov.it`) for one or more Codici Fiscali / Partite IVA, detects newly granted state aid, and sends real-time Telegram alerts.

## Features

- **Interactive Telegram bot**: add/remove monitored CFs directly from chat
- **Detail view**: full aid breakdown with beneficiary, amounts, legal basis, and RNA link
- Detects new aid grants by comparing against local SQLite state
- Sends rich Telegram notifications with aid details
- Respects RNA rate limits (30s between requests)
- Cron-based scheduler (default: every 6 hours)
- Dry-run mode for testing
- CLI for manual queries

## Quick start

### Prerequisites

- Node.js 20+
- A Telegram bot token (see [Telegram setup](#telegram-setup))

### Install

```bash
git clone https://github.com/Francescodib/Lookout.git
cd Lookout
npm install
```

### Configure

```bash
cp .env.example .env
```

The only required variable is the bot token:

```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
```

### Run

```bash
# Start the bot + scheduler
npm run dev
```

Then open Telegram, find your bot, and send `/watch 12345678901` to start monitoring.

### CLI (optional)

```bash
# One-shot check for a specific CF (no bot needed)
npx tsx src/index.ts check 12345678901

# Show stored aids
npx tsx src/index.ts status 12345678901
```

### Build (production)

```bash
npm run build
npm start
```

## Bot commands

| Command | Description |
|---|---|
| `/watch <CF>` | Start monitoring a CF/P.IVA |
| `/unwatch <CF>` | Stop monitoring |
| `/list` | Show all your monitored CFs |
| `/check <CF>` | Run a manual check now |
| `/status <CF>` | Show stored aids history (with clickable details) |
| `/detail <COR>` | Full detail card for a specific aid |
| `/help` | Show available commands |

### Example session

```
You:  /watch 12345678901
Bot:  ✅ Monitoraggio attivato per 12345678901

Bot:  ✅ Nessun nuovo aiuto per 12345678901 (2 totali su RNA)

You:  /status 12345678901
Bot:  📊 Aiuti per 12345678901 (2 totali):

      • 2025-10-20 | €32.500,00
        Incentivi fiscali per investimenti...
        👉 /detail_99999001

      • 2025-09-18 | €0,00
        Incentivi fiscali per investimenti...
        👉 /detail_99999002

You:  /detail_99999001
Bot:  📄 Dettaglio Aiuto

      🏢 Beneficiario
      ACME S.R.L.
      C.F.: 12345678901
      Regione: Lombardia

      📋 Misura
      Incentivi fiscali per investimenti in start up e PMI innovative
      Tipo: Regime di aiuti
      CAR: 00000

      💰 Concessione
      Importo: € 32.500,00
      Data: 2025-10-20
      COR: 99999001

      🔗 Vedi su RNA
```

## Telegram setup

### 1. Create a bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a name (e.g., "Lookout RNA") and a username (e.g., `lookout_rna_bot`)
4. BotFather will reply with your **bot token** — copy it

### 2. Configure

Set the token in your `.env` file:

```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
```

That's it. The bot handles everything else — just start Lookout and send `/watch <CF>` in your chat with the bot.

### Optional: pre-configure CFs via .env

You can also set CFs and a chat ID in `.env` for monitoring without the bot interface:

```env
TELEGRAM_CHAT_ID=-1001234567890
WATCH_CF=12345678901,OTHER_CF_HERE
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Telegram Bot API token from BotFather |
| `TELEGRAM_CHAT_ID` | No | — | Default chat ID for .env-based monitoring |
| `WATCH_CF` | No | — | Comma-separated CFs for .env-based monitoring |
| `CRON_SCHEDULE` | No | `0 */6 * * *` | Cron expression for check schedule |
| `RNA_REQUEST_DELAY_MS` | No | `31000` | Minimum ms between RNA API requests |
| `DRY_RUN` | No | `false` | If `true`, log notifications instead of sending |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |
| `DATA_DIR` | No | `data` | Directory for SQLite database |

## Deploy

### Raspberry Pi / any Linux server

```bash
git clone https://github.com/Francescodib/Lookout.git
cd Lookout
npm install
npm run build
cp .env.example .env
# edit .env with your bot token

# Run with systemd (recommended)
sudo cp lookout.service /etc/systemd/system/
sudo systemctl enable lookout
sudo systemctl start lookout
```

### Docker

```bash
docker build -t lookout .
docker run -d --name lookout --restart unless-stopped \
  -e TELEGRAM_BOT_TOKEN=your-token \
  -v lookout-data:/app/data \
  lookout
```

### Free cloud options

- **Oracle Cloud Free Tier**: always-free ARM VM (4 CPU, 24GB RAM) — best free option
- **Fly.io**: free tier with 3 shared VMs
- **Railway.app**: $5 free credit/month, enough for this workload
- **Render**: free tier with spin-down (bot restarts on message, slight delay)

## How it works

```
1. Bot listens for Telegram commands (/watch, /unwatch, etc.)
2. Scheduler triggers every 6h (configurable)
3. For each watched CF/P.IVA:
   a. POST to RNA public API with form-encoded search
   b. Parse JSON response with aid records
   c. Compare COR codes against SQLite database
   d. If new records found → notify all subscribed chats
4. Rate limit: 31s between RNA requests
```

### Data source

Lookout uses the same public API that powers the [RNA Transparency Portal](https://www.rna.gov.it/trasparenza/aiuti) search form. The RNA also publishes [Open Data XML dumps](https://www.rna.gov.it/open-data/aiuti) updated weekly under CC BY 4.0 license.

## Legal

The RNA data is **public by law**. Italian D.M. 115/2017 and EU Regulation 651/2014 (Art. 9) mandate the publication of state aid data for transparency purposes. The Open Data section is published under [Creative Commons 4.0](https://creativecommons.org/licenses/by/4.0/) license. This tool queries the same public endpoint used by the portal's search form, respecting the server-indicated rate limits.

## License

ISC
