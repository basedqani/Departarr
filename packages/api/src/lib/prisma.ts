import { PrismaClient } from '@prisma/client'

// DATABASE_URL is set by initConfig() before this module is used.
export const prisma = new PrismaClient()
