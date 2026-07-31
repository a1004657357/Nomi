import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  clearInstanceAdvertisement,
  writeInstanceAdvertisement,
  type InstanceAdvertisement,
} from './lockfile'
import { CAPABILITY_DIR_ENV } from './security'

let root = ''

function advertisement(pid: number): InstanceAdvertisement {
  return {
    pid,
    port: 61426,
    token: 'test-token',
    startedAt: 1,
    version: '0.16.6',
  }
}

function instancePath(): string {
  return path.join(root, 'instance.json')
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-capability-lockfile-'))
  process.env[CAPABILITY_DIR_ENV] = root
})

afterEach(() => {
  delete process.env[CAPABILITY_DIR_ENV]
  fs.rmSync(root, { recursive: true, force: true })
})

describe('capabilityCore/lockfile', () => {
  it('does not remove an advertisement owned by another live app instance', () => {
    writeInstanceAdvertisement(advertisement(84877))

    expect(clearInstanceAdvertisement(21732)).toBe(false)
    expect(JSON.parse(fs.readFileSync(instancePath(), 'utf8')).pid).toBe(84877)
  })

  it('removes the advertisement when the owner pid matches', () => {
    writeInstanceAdvertisement(advertisement(84877))

    expect(clearInstanceAdvertisement(84877)).toBe(true)
    expect(fs.existsSync(instancePath())).toBe(false)
  })
})
