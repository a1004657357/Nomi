import { describe, expect, it } from 'vitest'

import { extractHostResponse } from './nomiClient.mjs'

describe('extractHostResponse', () => {
  it('parses the host JSON when Electron writes logs before and after it', () => {
    const output = [
      '[electron] startup log',
      '{"ok":true,"result":{"status":"succeeded","message":"brace } inside string"}}',
      '[electron] shutdown log',
    ].join('\n')

    expect(extractHostResponse(output)).toEqual({
      ok: true,
      result: { status: 'succeeded', message: 'brace } inside string' },
    })
  })

  it('selects the last complete host response and ignores unrelated JSON logs', () => {
    const output = [
      '{"level":"info","message":"ready"}',
      '{"ok":false,"error":"older"}',
      '{"ok":true,"result":{"nodeId":"node-1"}}',
    ].join('\n')

    expect(extractHostResponse(output)).toEqual({ ok: true, result: { nodeId: 'node-1' } })
  })

  it('returns null for truncated or unrelated output', () => {
    expect(extractHostResponse('log only {"ok":true')).toBeNull()
    expect(extractHostResponse('{"level":"info"}')).toBeNull()
  })
})
