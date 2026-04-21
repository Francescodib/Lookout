import type { RnaAiuto } from './rna-client.js';
import { logger } from './logger.js';

export class TelegramNotifier {
  private botToken: string;
  private chatId: string;
  private apiBase: string;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.apiBase = `https://api.telegram.org/bot${botToken}`;
  }

  /** Format and send notifications for new aiuti to a specific chat. */
  async notifyNew(aiuti: RnaAiuto[], chatId?: string): Promise<void> {
    for (const a of aiuti) {
      const msg = this.formatMessage(a);
      await this.sendMessage(msg, chatId);
    }
  }

  private formatMessage(a: RnaAiuto): string {
    const lines = [
      `\u{1F514} *Lookout* — Nuovo aiuto rilevato`,
      ``,
      `*Beneficiario*: ${esc(a.beneficiario)}`,
      `*C\\.F\\.*: \`${esc(a.cf)}\``,
      `*Titolo Misura*: ${esc(a.titolo)}`,
      `*Tipo*: ${esc(a.tipo)}`,
      `*Progetto*: ${esc(a.progetto || '—')}`,
      `*Data Concessione*: ${esc(a.data)}`,
      `*Importo*: ${esc(a.elementoAiuto || formatEur(a.importo))}`,
      `*COR*: \`${esc(a.cor)}\``,
      `*CAR*: ${esc(a.car)}`,
      `*Regione*: ${esc(a.regione || '—')}`,
    ];
    return lines.join('\n');
  }

  private async sendMessage(text: string, chatId?: string): Promise<void> {
    const url = `${this.apiBase}/sendMessage`;
    const body = {
      chat_id: chatId || this.chatId,
      text,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
    };

    logger.debug('Telegram sendMessage', { chat_id: this.chatId, text_length: text.length });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      logger.error(`Telegram API error: ${res.status}`, errBody);
      throw new Error(`Telegram API error: ${res.status} — ${errBody}`);
    }

    logger.info('Telegram notification sent');
  }

  /** Send a plain text status message. */
  async sendStatus(text: string, chatId?: string): Promise<void> {
    const targetChat = chatId || this.chatId;
    if (!targetChat) return;
    const url = `${this.apiBase}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChat,
        text,
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      logger.error(`Telegram API error: ${res.status}`, errBody);
    }
  }

  get apiBaseUrl(): string {
    return this.apiBase;
  }
}

/** Escape MarkdownV2 special characters. */
function esc(s: string): string {
  return s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function formatEur(n: number): string {
  return `\u20AC ${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
