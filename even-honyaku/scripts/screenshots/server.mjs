// Serves the production build on :5173 (where `npm run simulator` points) with a test harness injected. NOT part of the app:
// it is only used by capture.py to take the store screenshots. See store-assets/README.md.
import http from 'node:http'
import { readFile, appendFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const DIST = process.argv[2]
const PRESET = process.argv[3] ?? 'standard'
const HERE = new URL('.', import.meta.url).pathname
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }
let queue = []

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/__poll') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(queue))
      queue = []
      return
    }
    if (url.pathname === '/__cmd' && req.method === 'POST') {
      let body = ''
      for await (const c of req) body += c
      queue.push(JSON.parse(body))
      res.end('ok')
      return
    }
    if (url.pathname === '/__log' && req.method === 'POST') {
      let body = ''
      for await (const c of req) body += c
      await appendFile(join(HERE, 'harness.log'), body + '\n')
      res.end('ok')
      return
    }
    if (url.pathname === '/__harness.js') {
      const js = (await readFile(join(HERE, 'harness.js'), 'utf8')).replace('__PRESET__', JSON.stringify(PRESET))
      res.setHeader('content-type', 'text/javascript')
      res.setHeader('cache-control', 'no-store')
      res.end(js)
      return
    }
    let path = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '')
    if (path === '/' || path === '') path = '/index.html'
    try {
      let data = await readFile(join(DIST, path))
      if (path === '/index.html') data = Buffer.from(data.toString().replace('<head>', '<head><script src="/__harness.js"></script>'))
      res.setHeader('content-type', types[extname(path)] ?? 'application/octet-stream')
      res.setHeader('cache-control', 'no-store')
      res.end(data)
    } catch {
      res.statusCode = 404
      res.end('not found')
    }
  })
  .listen(5173, '127.0.0.1', () => process.stdout.write(`harness on 5173 (${PRESET})\n`))
