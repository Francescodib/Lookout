import { logger } from './logger.js';

/** Shape of a single aid record returned by the RNA DataTables API. */
export interface RnaAiuto {
  cor: string;
  car: string;
  ce: string;
  titolo: string;           // titolo misura
  tipo: string;             // tipo misura
  progetto: string;         // titolo progetto
  data: string;             // data concessione (DD/MM/YYYY)
  beneficiario: string;     // denominazione beneficiario
  cf: string;               // codice fiscale beneficiario
  regione: string;
  elementoAiuto: string;    // formatted "€ 1.234,56"
  importo: number;          // parsed numeric amount
  idConcessione: string;
}

interface ApiRecord {
  cor: string;
  car: string;
  ce: string;
  titolo: string;
  tipo: string;
  progetto: string;
  data: string;
  beneficiario: string;
  cf: string;
  regione: string;
  elemento_aiuto: string;
  id_concessione: string;
  xml: {
    COR: string;
    IMPORTO_AGEVOLAZIONE: string;
    [key: string]: string;
  };
}

interface ApiResponse {
  recordsTotal: number;
  recordsFiltered: number;
  data: ApiRecord[];
  sleep?: number;
}

/** Parse "€ 1.234,56" or "1234.56" into a number. */
function parseImporto(raw: string): number {
  // The xml.IMPORTO_AGEVOLAZIONE is already numeric-ish ("165000.00")
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
}

/** Normalise a DD/MM/YYYY date to YYYY-MM-DD. */
export function normDate(ddmmyyyy: string): string {
  const parts = ddmmyyyy.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return ddmmyyyy; // already ISO or unknown format
}

export class RnaClient {
  private apiUrl: string;
  private delayMs: number;
  private lastRequestAt = 0;

  constructor(apiUrl: string, delayMs: number) {
    this.apiUrl = apiUrl;
    this.delayMs = delayMs;
  }

  /** Query RNA for all aids matching a given Codice Fiscale / P.IVA. */
  async queryByCf(cf: string): Promise<RnaAiuto[]> {
    await this.respectRateLimit();

    const body = new URLSearchParams();
    body.set('values[cfBen]', cf);
    body.set('values[count]', '1');
    // Send empty values for all other fields (the API expects them)
    for (const key of ['ce', 'car', 'autc', 'cor', 'annoc', 'annoc2', 'tipp', 'titpr', 'denom', 'rc', 'reg', 'imp', 'regq']) {
      body.set(`values[${key}]`, '');
    }

    logger.debug(`POST ${this.apiUrl} cfBen=${cf}`);

    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': 'https://www.rna.gov.it',
        'Referer': 'https://www.rna.gov.it/trasparenza/aiuti',
      },
      body: body.toString(),
    });

    this.lastRequestAt = Date.now();

    if (!res.ok) {
      throw new Error(`RNA API error: ${res.status} ${res.statusText}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      // Likely reCAPTCHA or HTML error page
      throw new Error(`RNA API returned non-JSON (possible reCAPTCHA): ${text.substring(0, 200)}`);
    }

    const json = (await res.json()) as ApiResponse;

    if (json.sleep) {
      // Server hints at rate limit interval — respect it
      this.delayMs = Math.max(this.delayMs, json.sleep * 1000);
    }

    logger.info(`RNA query cf=${cf}: ${json.recordsTotal} results`);

    return json.data.map((r): RnaAiuto => ({
      cor: r.cor,
      car: r.car,
      ce: r.ce,
      titolo: r.titolo,
      tipo: r.tipo,
      progetto: r.progetto?.trim(),
      data: normDate(r.data),
      beneficiario: r.beneficiario,
      cf: r.cf,
      regione: r.regione,
      elementoAiuto: r.elemento_aiuto,
      importo: parseImporto(r.xml?.IMPORTO_AGEVOLAZIONE ?? '0'),
      idConcessione: r.id_concessione,
    }));
  }

  private async respectRateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.delayMs) {
      const wait = this.delayMs - elapsed;
      logger.debug(`Rate limit: waiting ${wait}ms`);
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
}
