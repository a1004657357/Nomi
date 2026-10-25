import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  clearInstanceAdvertisement,
  readLiveInstance,
  writeInstanceAdvertisement,
  type InstanceAdvertisement,
} from './lockfile'
import { instanceAdvertFileName } from './instanceAdvert'
import { CAPABILITY_DIR_ENV } from './security'

let root = ''

function advertisement(pid: number, projectsRoot = root): InstanceAdvertisement {
  return {
    pid,
    port: 61426,
    token: 'test-token',
    startedAt: 1,
    version: 2,
    projectsRoot,
    heartbeatAt: Date.now(),
    appVersion: '0.21.0',
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
    writeInstanceAdvertisement(advertisement(84877), true)

    expect(clearInstanceAdvertisement(root, true, 21732)).toBe(false)
    expect(JSON.parse(fs.readFileSync(instancePath(), 'utf8')).pid).toBe(84877)
  })

  it('removes the advertisement when the owner pid matches', () => {
    writeInstanceAdvertisement(advertisement(84877), true)

    expect(clearInstanceAdvertisement(root, true, 84877)).toBe(true)
    expect(fs.existsSync(instancePath())).toBe(false)
  })

  it('keeps library namespaces separate while enforcing the owner pid', () => {
    const otherLibrary = path.join(root, 'isolated-library')
    const isolatedPath = path.join(root, instanceAdvertFileName(otherLibrary, false))
    writeInstanceAdvertisement(advertisement(process.pid), true)
    writeInstanceAdvertisement(advertisement(84877, otherLibrary), false)

    expect(clearInstanceAdvertisement(otherLibrary, false, process.pid)).toBe(false)
    expect(fs.existsSync(isolatedPath)).toBe(true)
    expect(clearInstanceAdvertisement(otherLibrary, false, 84877)).toBe(true)
    expect(fs.existsSync(isolatedPath)).toBe(false)
    expect(readLiveInstance()).toMatchObject({ pid: process.pid, version: 2, projectsRoot: root })
  })

  it('cleans only the stale library advert and leaves a live default instance alone', () => {
    const otherLibrary = path.join(root, 'stale-library')
    const isolatedPath = path.join(root, instanceAdvertFileName(otherLibrary, false))
    writeInstanceAdvertisement(advertisement(process.pid), true)
    writeInstanceAdvertisement(advertisement(2_147_483_647, otherLibrary), false)

    expect(readLiveInstance({ projectsRoot: otherLibrary, isDefault: false })).toBeNull()
    expect(fs.existsSync(isolatedPath)).toBe(false)
    expect(fs.existsSync(instancePath())).toBe(true)
  })
})
