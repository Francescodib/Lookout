import type { Store } from './store.js';
import type { RnaClient } from './rna-client.js';
import type { TelegramNotifier } from './telegram-notifier.js';
import { diff } from './diff-engine.js';
import { logger } from './logger.js';

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    from?: { first_name?: string };
  };
}

interface TgUpdatesResponse {
  ok: boolean;
  result: TgUpdate[];
}

const CF_RE = /^\d{11}$|^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/i;

function isValidCf(s: string): boolean {
  return CF_RE.test(s);
}

export class TelegramBot {
  private offset = 0;
  private running = false;
  private store: Store;
  private rnaClient: RnaClient;
  private notifier: TelegramNotifier;
  private dryRun: boolean;

  constructor(store: Store, rnaClient: RnaClient, notifier: TelegramNotifier, dryRun: boolean) {
    this.store = store;
    this.rnaClient = rnaClient;
    this.notifier = notifier;
    this.dryRun = dryRun;
  }

  async start(): Promise<void> {
    this.running = true;
    logger.info('Telegram bot polling started');
    while (this.running) {
      try {
        await this.poll();
      } catch (err) {
        logger.error('Bot polling error:', err);
        await sleep(5000);
      }
    }
  }

  stop() {
    this.running = false;
  }

  private async poll(): Promise<void> {
    const url = `${this.notifier.apiBaseUrl}/getUpdates?offset=${this.offset}&timeout=30`;
    const res = await fetch(url);
    if (!res.ok) {
      logger.error(`getUpdates failed: ${res.status}`);
      await sleep(3000);
      return;
    }

    const data = (await res.json()) as TgUpdatesResponse;
    if (!data.ok || !data.result.length) return;

    for (const update of data.result) {
      this.offset = update.update_id + 1;
      if (update.message?.text) {
        await this.handleMessage(update.message);
      }
    }
  }

  private async handleMessage(msg: { chat: { id: number }; text?: string; from?: { first_name?: string } }) {
    const chatId = String(msg.chat.id);
    const text = (msg.text ?? '').trim();

    if (!text.startsWith('/')) return;

    // Handle /detail_COR shorthand (from clickable links in /status)
    const detailMatch = text.match(/^\/detail_(\d+)/);
    if (detailMatch) {
      logger.info(`Bot command: /detail ${detailMatch[1]} (chat=${chatId})`);
      await this.cmdDetail(chatId, detailMatch[1]!);
      return;
    }

    const [cmd, ...args] = text.split(/\s+/);
    const arg = args.join(' ').trim();

    logger.info(`Bot command: ${cmd} ${arg} (chat=${chatId})`);

    switch (cmd.split('@')[0]) {  // strip @botname suffix
      case '/start':
        await this.cmdStart(chatId, msg.from?.first_name);
        break;
      case '/help':
        await this.cmdHelp(chatId);
        break;
      case '/watch':
        await this.cmdWatch(chatId, arg);
        break;
      case '/unwatch':
        await this.cmdUnwatch(chatId, arg);
        break;
      case '/list':
        await this.cmdList(chatId);
        break;
      case '/check':
        await this.cmdCheck(chatId, arg);
        break;
      case '/status':
        await this.cmdStatus(chatId, arg);
        break;
      case '/detail':
        await this.cmdDetail(chatId, arg);
        break;
      default:
        await this.reply(chatId, `Comando non riconosciuto. Usa /help per la lista comandi.`);
    }
  }

  private async cmdStart(chatId: string, firstName?: string) {
    const name = firstName ? ` ${firstName}` : '';
    const text = [
      `\u{1F44B} Ciao${name}! Sono *Lookout*, il tuo monitor per gli Aiuti di Stato italiani.`,
      ``,
      `Interrogo il portale RNA (rna.gov.it) e ti notifico quando vengono registrati nuovi aiuti per i codici fiscali o le partite IVA che scegli di monitorare.`,
      ``,
      `\u{1F680} *Per iniziare:*`,
      `Inviami una P.IVA o un codice fiscale con il comando /watch`,
      ``,
      `Esempio: \`/watch 12345678901\``,
      ``,
      `Digita /help per la lista completa dei comandi.`,
    ].join('\n');
    await this.replyMarkdown(chatId, text);
  }

  private async cmdHelp(chatId: string) {
    const cfs = this.store.getWatchesForChat(chatId);
    const watchCount = cfs.length;

    const text = [
      `\u{1F50D} *Lookout* \u2014 Comandi disponibili`,
      ``,
      `\u{1F4E1} *Monitoraggio*`,
      `/watch \`<CF>\` \u2014 Attiva monitoraggio`,
      `/unwatch \`<CF>\` \u2014 Disattiva monitoraggio`,
      `/list \u2014 Elenco CF monitorati`,
      ``,
      `\u{1F50E} *Consultazione*`,
      `/check \`<CF>\` \u2014 Controllo immediato su RNA`,
      `/status \`<CF>\` \u2014 Storico aiuti salvati`,
      `/detail \`<COR>\` \u2014 Scheda completa di un aiuto`,
      ``,
      `\u{2139}\uFE0F *Info*`,
      `/help \u2014 Questo messaggio`,
      ``,
      `\u{1F4CB} *Stai monitorando ${watchCount} CF/P\\.IVA*`,
      `\u{23F0} Controllo automatico ogni 6 ore`,
      ``,
      `_CF \\= Codice Fiscale \\(16 car\\.\\) o P\\.IVA \\(11 cifre\\)_`,
    ].join('\n');
    await this.replyMarkdown(chatId, text);
  }

  private async cmdWatch(chatId: string, cf: string) {
    if (!cf) {
      await this.reply(chatId, `Uso: /watch <CF o P.IVA>\nEsempio: /watch 12345678901`);
      return;
    }
    cf = cf.toUpperCase();
    if (!isValidCf(cf)) {
      await this.reply(chatId, `"${cf}" non sembra un codice fiscale o P.IVA valido (11 cifre o 16 caratteri alfanumerici).`);
      return;
    }

    const added = this.store.addWatch(chatId, cf);
    if (added) {
      await this.reply(chatId, `\u2705 Monitoraggio attivato per ${cf}\nRiceverai notifiche quando vengono rilevati nuovi aiuti.\nUsa /check ${cf} per un controllo immediato.`);
      // Do an initial check
      await this.doCheck(chatId, cf);
    } else {
      await this.reply(chatId, `${cf} è già monitorato.`);
    }
  }

  private async cmdUnwatch(chatId: string, cf: string) {
    if (!cf) {
      await this.reply(chatId, `Uso: /unwatch <CF o P.IVA>`);
      return;
    }
    cf = cf.toUpperCase();
    const removed = this.store.removeWatch(chatId, cf);
    if (removed) {
      await this.reply(chatId, `\u274C Monitoraggio interrotto per ${cf}`);
    } else {
      await this.reply(chatId, `${cf} non era monitorato.`);
    }
  }

  private async cmdList(chatId: string) {
    const cfs = this.store.getWatchesForChat(chatId);
    if (cfs.length === 0) {
      await this.reply(chatId, `Nessun CF monitorato.\nUsa /watch <CF> per iniziare.`);
      return;
    }
    const lines = cfs.map((cf, i) => `${i + 1}. \`${cf}\``);
    await this.reply(chatId, `\u{1F4CB} CF monitorati (${cfs.length}):\n\n${lines.join('\n')}`);
  }

  private async cmdCheck(chatId: string, cf: string) {
    if (!cf) {
      await this.reply(chatId, `Uso: /check <CF o P.IVA>`);
      return;
    }
    cf = cf.toUpperCase();
    if (!isValidCf(cf)) {
      await this.reply(chatId, `"${cf}" non sembra un CF/P.IVA valido.`);
      return;
    }
    await this.reply(chatId, `\u{23F3} Controllo in corso per ${cf}...`);
    await this.doCheck(chatId, cf);
  }

  private async cmdStatus(chatId: string, cf: string) {
    if (!cf) {
      const cfs = this.store.getWatchesForChat(chatId);
      if (cfs.length === 0) {
        await this.reply(chatId, `Nessun CF monitorato. Uso: /status <CF>`);
        return;
      }
      cf = cfs[0]!;
    }
    cf = cf.toUpperCase();

    const aiuti = this.store.getAiuti(cf);
    if (aiuti.length === 0) {
      await this.reply(chatId, `Nessun aiuto memorizzato per ${cf}`);
      return;
    }

    const lines = aiuti.slice(0, 15).map(a => {
      const importo = `\u20AC${a.importo.toLocaleString('it-IT', { minimumFractionDigits: 2 })}`;
      const titolo = a.titolo.substring(0, 40) + (a.titolo.length > 40 ? '...' : '');
      return `\u2022 ${a.data} | ${importo}\n   ${titolo}\n   \u{1F449} /detail_${a.cor}`;
    });

    let msg = `\u{1F4CA} Aiuti per ${cf} (${aiuti.length} totali):\n\n${lines.join('\n\n')}`;
    if (aiuti.length > 15) {
      msg += `\n\n... e altri ${aiuti.length - 15}`;
    }
    await this.reply(chatId, msg);
  }

  private async cmdDetail(chatId: string, corArg: string) {
    if (!corArg) {
      await this.reply(chatId, `Uso: /detail <COR>\nOppure clicca su un COR dalla lista /status`);
      return;
    }

    const aiuto = this.store.getAiutoByCor(corArg);
    if (!aiuto) {
      await this.reply(chatId, `Nessun aiuto trovato con COR ${corArg}`);
      return;
    }

    const importo = `\u20AC ${aiuto.importo.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const lines = [
      `\u{1F4C4} *Dettaglio Aiuto*`,
      ``,
      `\u{1F3E2} *Beneficiario*`,
      `${esc(aiuto.beneficiario)}`,
      `C\\.F\\.: \`${esc(aiuto.cf)}\``,
      `Regione: ${esc(aiuto.regione || '\u2014')}`,
      ``,
      `\u{1F4CB} *Misura*`,
      `${esc(aiuto.titolo)}`,
      `Tipo: ${esc(aiuto.tipo)}`,
      `CAR: \`${esc(aiuto.car)}\``,
      aiuto.ce ? `CE: \`${esc(aiuto.ce)}\`` : null,
      ``,
      `\u{1F4B0} *Concessione*`,
      `Importo: *${esc(importo)}*`,
      `Data: ${esc(aiuto.data)}`,
      `COR: \`${esc(aiuto.cor)}\``,
      aiuto.progetto ? `\nProgetto: ${esc(aiuto.progetto)}` : null,
      ``,
      `\u{1F517} [Vedi su RNA](https://www.rna.gov.it/trasparenza/aiuti/${esc(aiuto.idConcessione)})`,
    ].filter(Boolean).join('\n');

    await this.replyMarkdown(chatId, lines);
  }

  private async doCheck(chatId: string, cf: string) {
    try {
      const aiuti = await this.rnaClient.queryByCf(cf);
      const result = diff(this.store, cf, aiuti);

      if (result.newAiuti.length > 0) {
        if (!this.dryRun) {
          await this.notifier.notifyNew(result.newAiuti, chatId);
          this.store.markNotified(result.newAiuti.map(a => a.cor));
        } else {
          await this.reply(chatId, `[DRY RUN] ${result.newAiuti.length} nuovi aiuti trovati.`);
        }
      } else {
        await this.reply(chatId, `\u2705 Nessun nuovo aiuto per ${cf} (${result.total} totali su RNA)`);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Check failed for ${cf}:`, err);
      await this.reply(chatId, `\u26A0\uFE0F Errore durante il controllo: ${errMsg}`);
    }
  }

  /** Run scheduled check for all watched CFs, notifying each subscriber. */
  async runScheduledCheck(): Promise<void> {
    const allCfs = this.store.getAllWatchedCfs();
    if (allCfs.length === 0) {
      logger.info('Scheduled check: no CFs to monitor');
      return;
    }

    logger.info(`--- Scheduled check: ${allCfs.length} CFs ---`);

    for (const cf of allCfs) {
      try {
        const aiuti = await this.rnaClient.queryByCf(cf);
        const result = diff(this.store, cf, aiuti);

        if (result.newAiuti.length > 0) {
          const chatIds = this.store.getChatIdsForCf(cf);
          for (const chatId of chatIds) {
            if (!this.dryRun) {
              await this.notifier.notifyNew(result.newAiuti, chatId);
            }
          }
          this.store.markNotified(result.newAiuti.map(a => a.cor));
          logger.info(`CF ${cf}: ${result.newAiuti.length} new, notified ${chatIds.length} chats`);
        } else {
          logger.info(`CF ${cf}: no new (${result.total} total)`);
        }
      } catch (err) {
        logger.error(`Scheduled check failed for CF ${cf}:`, err);
      }
    }

    logger.info('--- Scheduled check complete ---');
  }

  private async reply(chatId: string, text: string) {
    await this.notifier.sendStatus(text, chatId);
  }

  private async replyMarkdown(chatId: string, text: string) {
    const url = `${this.notifier.apiBaseUrl}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      logger.error(`replyMarkdown failed: ${res.status}`, err);
      // Fallback to plain text
      await this.reply(chatId, text.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, ''));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function esc(s: string): string {
  return s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
