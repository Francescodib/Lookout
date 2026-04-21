#!/usr/bin/env node
import { config } from './config.js';
import { RnaClient } from './rna-client.js';
import { Store } from './store.js';
import { diff } from './diff-engine.js';
import { TelegramNotifier } from './telegram-notifier.js';
import { TelegramBot } from './telegram-bot.js';
import { logger, setLogLevel } from './logger.js';
import cron from 'node-cron';

setLogLevel(config.logLevel);

const store = new Store(config.dataDir);
const rnaClient = new RnaClient(config.rna.apiUrl, config.rna.requestDelayMs);
const telegram = new TelegramNotifier(config.telegram.botToken, config.telegram.chatId);
const bot = new TelegramBot(store, rnaClient, telegram, config.dryRun);

/** Run a check for CFs from .env (legacy/CLI mode). */
async function runEnvCheck(): Promise<void> {
  if (config.watchCf.length === 0) return;

  logger.info(`--- Check cycle (env CFs: ${config.watchCf.length}) ---`);
  for (const cf of config.watchCf) {
    try {
      const aiuti = await rnaClient.queryByCf(cf);
      const result = diff(store, cf, aiuti);

      if (result.newAiuti.length > 0) {
        logger.info(`CF ${cf}: ${result.newAiuti.length} new (${result.total} total)`);
        if (!config.dryRun && config.telegram.chatId) {
          await telegram.notifyNew(result.newAiuti);
          store.markNotified(result.newAiuti.map(a => a.cor));
        } else {
          logger.info('[DRY RUN] Would notify:', result.newAiuti.map(a => `COR=${a.cor} ${a.titolo}`));
        }
      } else {
        logger.info(`CF ${cf}: no new aiuti (${result.total} total)`);
      }
    } catch (err) {
      logger.error(`Error checking CF ${cf}:`, err);
    }
  }
}

/** CLI: show current state for a CF. */
function showStatus(cf: string) {
  const aiuti = store.getAiuti(cf);
  if (aiuti.length === 0) {
    console.log(`No stored aiuti for CF ${cf}`);
    return;
  }
  console.log(`\nStored aiuti for CF ${cf} (${aiuti.length} total):\n`);
  for (const a of aiuti) {
    console.log(`  COR=${a.cor} | ${a.data} | ${a.importo.toFixed(2)} | ${a.titolo.substring(0, 70)}`);
  }
}

// --- CLI routing ---
const args = process.argv.slice(2);
const command = args[0];

if (command === 'check') {
  const targetCf = args[1];
  if (targetCf) {
    (config as { watchCf: string[] }).watchCf = [targetCf];
  }
  runEnvCheck().then(() => store.close()).catch(err => {
    logger.error('Fatal error:', err);
    store.close();
    process.exit(1);
  });
} else if (command === 'status') {
  const targetCf = args[1] || config.watchCf[0];
  if (!targetCf) {
    console.error('Usage: lookout status <CF>');
    process.exit(1);
  }
  showStatus(targetCf);
  store.close();
} else {
  // Default: start bot + scheduler
  logger.info('Lookout starting');
  logger.info(`Schedule: ${config.cron} | Dry run: ${config.dryRun}`);
  if (config.watchCf.length > 0) {
    logger.info(`Env CFs: ${config.watchCf.join(', ')}`);
  }

  // Start Telegram bot (long polling for commands)
  bot.start();

  // Initial check for env-configured CFs
  runEnvCheck().catch(err => logger.error('Initial check failed:', err));

  // Scheduled checks: both env CFs and bot-registered watches
  cron.schedule(config.cron, async () => {
    try {
      await runEnvCheck();
      await bot.runScheduledCheck();
    } catch (err) {
      logger.error('Scheduled check failed:', err);
    }
  });

  // Graceful shutdown
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      logger.info(`Received ${sig}, shutting down...`);
      bot.stop();
      store.close();
      process.exit(0);
    });
  }
}
