// Usage: HA_URL=http://<vm> (HA_USER + HA_PASSWORD, or HA_TOKEN) bun supervisor.ts <get|post> <endpoint> [json]
const [method, endpoint, data] = process.argv.slice(2)
const haUrl = process.env['HA_URL']
if (!haUrl || !method || !endpoint) throw new Error('Usage: HA_URL=... bun supervisor.ts <get|post> <endpoint> [json]')

async function logIn(): Promise<string> {
  const clientId = `${haUrl}/`
  const post = async (path: string, body: object, form = false) =>
    (await fetch(`${haUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body as Record<string, string>) : JSON.stringify(body),
    })).json() as Promise<Record<string, string>>
  const flow = await post('/auth/login_flow', { client_id: clientId, handler: ['homeassistant', null], redirect_uri: clientId })
  const step = await post(`/auth/login_flow/${flow['flow_id']}`, {
    client_id: clientId, username: process.env['HA_USER'], password: process.env['HA_PASSWORD'],
  })
  if (!step['result']) throw new Error(`Login failed: ${JSON.stringify(step)}`)
  const tokens = await post('/auth/token', { grant_type: 'authorization_code', code: step['result'], client_id: clientId }, true)
  return tokens['access_token']!
}

const token = process.env['HA_TOKEN'] ?? (await logIn())
const ws = new WebSocket(`${haUrl.replace(/^http/, 'ws')}/api/websocket`)
ws.onmessage = (event) => {
  const message = JSON.parse(String(event.data))
  if (message.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }))
  else if (message.type === 'auth_invalid') throw new Error(message.message)
  else if (message.type === 'auth_ok')
    ws.send(JSON.stringify({ id: 1, type: 'supervisor/api', endpoint, method, timeout: null, ...(data ? { data: JSON.parse(data) } : {}) }))
  else if (message.id === 1) {
    console.log(JSON.stringify(message.success ? message.result : message.error, null, 2))
    process.exit(message.success ? 0 : 1)
  }
}
