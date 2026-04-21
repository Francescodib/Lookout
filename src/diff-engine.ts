import type { RnaAiuto } from './rna-client.js';
import type { Store } from './store.js';
import { logger } from './logger.js';

export interface DiffResult {
  cf: string;
  total: number;
  newAiuti: RnaAiuto[];
}

/** Compare fetched aiuti against stored state, persist new ones. */
export function diff(store: Store, cf: string, fetched: RnaAiuto[]): DiffResult {
  const known = store.knownCors(cf);
  const newAiuti = fetched.filter(a => !known.has(a.cor));

  if (newAiuti.length > 0) {
    const inserted = store.insertNew(newAiuti);
    logger.info(`CF ${cf}: ${inserted.length} new aiuti detected`);
  }

  store.logCheck(cf, fetched.length, newAiuti.length);

  return {
    cf,
    total: fetched.length,
    newAiuti,
  };
}
