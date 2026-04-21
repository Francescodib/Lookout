import 'dotenv/config';

export const config = {
  telegram: {
    botToken: env('TELEGRAM_BOT_TOKEN'),
    chatId: env('TELEGRAM_CHAT_ID', ''),  // optional: used as default for CLI mode
  },
  watchCf: env('WATCH_CF', '').split(',').map(s => s.trim()).filter(Boolean),
  cron: env('CRON_SCHEDULE', '0 */6 * * *'),
  rna: {
    apiUrl: env('RNA_API_URL', 'https://www.rna.gov.it/rna/oracle/query/trasparenza/aiuti'),
    requestDelayMs: Number(env('RNA_REQUEST_DELAY_MS', '31000')),
  },
  logLevel: env('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
  dryRun: env('DRY_RUN', 'false') === 'true',
  dataDir: env('DATA_DIR', 'data'),
} as const;

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return val;
}
