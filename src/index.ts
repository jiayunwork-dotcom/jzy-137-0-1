import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { buildApp } from './http/app.js'

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'
const dbPath = process.env.DB_PATH ?? './data/rainflow.db'

mkdirSync(dirname(dbPath), { recursive: true })

const app = buildApp({ dbPath, logger: true })

app.listen({ port, host }).catch((err) => {
  console.error(err)
  process.exit(1)
})
