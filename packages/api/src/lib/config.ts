import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import webpush from 'web-push'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface ConfigFile {
  jwtSecret: string
  vapidPublicKey: string
  vapidPrivateKey: string
}

export interface AppConfig extends ConfigFile {
  databaseUrl: string
}

let _config: AppConfig | null = null

function getDataDir(): string {
  // In production container, use /data. In dev, use ./data relative to the repo root.
  if (process.env.NODE_ENV === 'production') {
    return '/data'
  }
  // Repo root is 3 levels up from packages/api/src/lib/
  return join(__dirname, '../../../../data')
}

export async function initConfig(): Promise<AppConfig> {
  if (_config) return _config

  const dataDir = getDataDir()
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  // Set DATABASE_URL before PrismaClient is ever imported
  const defaultDb = process.env.NODE_ENV === 'production'
    ? 'file:/data/departarr.db'
    : `file:${join(dataDir, 'departarr.db')}`
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = defaultDb
  }

  // Load or create persisted config.json
  const configPath = join(dataDir, 'config.json')
  let file: Partial<ConfigFile> = {}
  if (existsSync(configPath)) {
    try {
      file = JSON.parse(readFileSync(configPath, 'utf-8')) as Partial<ConfigFile>
    } catch {
      console.warn('Failed to parse config.json, regenerating secrets')
    }
  }

  let changed = false

  if (!file.jwtSecret) {
    file.jwtSecret = randomBytes(32).toString('hex')
    changed = true
  }

  if (!file.vapidPublicKey || !file.vapidPrivateKey) {
    const keys = webpush.generateVAPIDKeys()
    file.vapidPublicKey = keys.publicKey
    file.vapidPrivateKey = keys.privateKey
    changed = true
  }

  if (changed) {
    writeFileSync(configPath, JSON.stringify(file, null, 2), 'utf-8')
    console.log(`Config written to ${configPath}`)
  }

  // Env vars override persisted values for power users
  const jwtSecret = process.env.JWT_SECRET ?? file.jwtSecret!
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? file.vapidPublicKey!
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? file.vapidPrivateKey!
  const databaseUrl = process.env.DATABASE_URL

  _config = {
    jwtSecret,
    vapidPublicKey,
    vapidPrivateKey,
    databaseUrl: databaseUrl!,
  }

  return _config
}

export function getConfig(): AppConfig {
  if (!_config) throw new Error('Config not initialized — call initConfig() first')
  return _config
}
