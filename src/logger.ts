const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

let currentLevel: keyof typeof LEVELS = 'info';

export function setLogLevel(level: keyof typeof LEVELS) {
  currentLevel = level;
}

function log(level: keyof typeof LEVELS, msg: string, data?: unknown) {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${msg}`, data);
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

export const logger = {
  debug: (msg: string, data?: unknown) => log('debug', msg, data),
  info: (msg: string, data?: unknown) => log('info', msg, data),
  warn: (msg: string, data?: unknown) => log('warn', msg, data),
  error: (msg: string, data?: unknown) => log('error', msg, data),
};
