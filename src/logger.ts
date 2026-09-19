import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { LOGS_DIR } from './config/defaults.js';

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const today = new Date().toISOString().split('T')[0];
const logFilePath = path.join(LOGS_DIR, `yupmanga-${today}.log`);

const transport = pino.transport({
  targets: [
    {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname',
      },
      level: 'info',
    },
    {
      target: 'pino/file',
      options: {
        destination: logFilePath,
        mkdir: true,
      },
      level: 'debug',
    },
  ],
});

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    base: undefined,
  },
  transport
);
