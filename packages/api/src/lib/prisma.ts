import { PrismaClient } from '@prisma/client'
import { getDefaultDatabaseUrl } from './config.js'

// ESM hoists static imports, so this module can load before initConfig() runs
// in index.ts — the default must be set here or the client may bind to an
// undefined DATABASE_URL.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = getDefaultDatabaseUrl()
}

export const prisma = new PrismaClient()
