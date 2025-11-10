import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const standaloneDir = path.join(projectRoot, '.next', 'standalone')

function copyDir(source, destination) {
  if (!fs.existsSync(source)) {
    return
  }

  fs.mkdirSync(destination, { recursive: true })
  fs.cpSync(source, destination, { recursive: true })
}

function copyFile(source, destination) {
  if (!fs.existsSync(source)) {
    return
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
}

if (!fs.existsSync(standaloneDir)) {
  process.exit(0)
}

copyDir(path.join(projectRoot, 'public'), path.join(standaloneDir, 'public'))
copyDir(path.join(projectRoot, '.next', 'static'), path.join(standaloneDir, '.next', 'static'))
copyDir(path.join(projectRoot, 'credentials'), path.join(standaloneDir, 'credentials'))
copyFile(path.join(projectRoot, '.env'), path.join(standaloneDir, '.env'))
copyFile(path.join(projectRoot, '.env.local'), path.join(standaloneDir, '.env.local'))
copyFile(path.join(projectRoot, '.env.production'), path.join(standaloneDir, '.env.production'))
copyFile(path.join(projectRoot, '.env.production.local'), path.join(standaloneDir, '.env.production.local'))
