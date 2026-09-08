import { config } from "../config";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export const logger = {
  debug: (...args: unknown[]) => { if (LEVELS.debug >= LEVELS[config.LOG_LEVEL]) console.debug("[debug]", ...args); },
  info: (...args: unknown[]) => { if (LEVELS.info >= LEVELS[config.LOG_LEVEL]) console.log("[info]", ...args); },
  warn: (...args: unknown[]) => { if (LEVELS.warn >= LEVELS[config.LOG_LEVEL]) console.warn("[warn]", ...args); },
  error: (...args: unknown[]) => { if (LEVELS.error >= LEVELS[config.LOG_LEVEL]) console.error("[error]", ...args); },
};
