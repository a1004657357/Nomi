import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MODEL_ACCESS_CAPABILITIES, MODEL_ACCESS_REQUIRED_PROFILES } from '../../../electron/shared/contracts/modelAccessCapabilities.ts'
import { MODEL_ACCESS_JOURNEYS, STABLE_ROUNDTRIP_JOURNEYS } from './manifest.mjs'
import { JOURNEY_ENTRY_COMPONENTS, IGNORED_DRAWER_COMPONENTS } from './harnessContract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function coveredValues(dimension) {
  return new Set(STABLE_ROUNDTRIP_JOURNEYS.flatMap((journey) => journey.covers[dimension] || []))
}

function expectCovered(dimension, required = MODEL_ACCESS_CAPABILITIES[dimension]) {
  const covered = coveredValues(dimension)
  expect(required.filter((value) => !covered.has(value)), `${dimension} missing stable UI roundtrip`).toEqual([])
}

describe('model access journey manifest', () => {
  it('owns the WebBridge card with an executable component journey, not a claimed generation roundtrip', () => {
    const journey = MODEL_ACCESS_JOURNEYS.find(item => item.id === 'J17')
    expect(journey).toMatchObject({ mode: 'stable', level: 'component', profiles: [], covers: {} })
    expect(journey.profiles).toEqual([])
    expect(journey.covers).toEqual({})
    expect(JOURNEY_ENTRY_COMPONENTS.J17).toEqual(['WebBridgeConnectionCard'])
    expect(IGNORED_DRAWER_COMPONENTS).not.toHaveProperty('WebBridgeConnectionCard')
    expect(STABLE_ROUNDTRIP_JOURNEYS).not.toContain(journey)
    const script = path.join(repoRoot, journey.script)
    expect(fs.existsSync(script)).toBe(true)
    expect(fs.readFileSync(script, 'utf8')).not.toMatch(/launchNomiApp|_launchApp/)
  })

  it('uses unique journey ids and only known dimension values', () => {
    expect(new Set(MODEL_ACCESS_JOURNEYS.map((journey) => journey.id)).size).toBe(MODEL_ACCESS_JOURNEYS.length)
    for (const journey of MODEL_ACCESS_JOURNEYS) {
      for (const [dimension, values] of Object.entries(journey.covers)) {
        expect(Object.hasOwn(MODEL_ACCESS_CAPABILITIES, dimension), `${journey.id}.${dimension}`).toBe(true)
        for (const value of values) {
          expect(MODEL_ACCESS_CAPABILITIES[dimension], `${journey.id}.${dimension}.${value}`).toContain(value)
        }
      }
    }
  })

  it('uses the enumerable production capability registry as the only required universe', () => {
    for (const [dimension, required] of Object.entries(MODEL_ACCESS_CAPABILITIES)) {
      expect(required.length, dimension).toBeGreaterThan(0)
      expect(new Set(required).size, `${dimension} duplicate production capability`).toBe(required.length)
    }
  })

  it('covers every declared dimension with stable real-UI roundtrips', () => {
    for (const dimension of Object.keys(MODEL_ACCESS_CAPABILITIES)) expectCovered(dimension)
  })

  it('covers required cross-dimensional profiles inside one owning journey', () => {
    const profileOwners = new Map()
    for (const journey of STABLE_ROUNDTRIP_JOURNEYS) {
      for (const profileId of journey.profiles || []) {
        const owners = profileOwners.get(profileId) || []
        owners.push(journey)
        profileOwners.set(profileId, owners)
      }
    }
    for (const profile of MODEL_ACCESS_REQUIRED_PROFILES) {
      const owners = profileOwners.get(profile.id) || []
      expect(owners.map((journey) => journey.id), `${profile.id} must have one stable owner`).toHaveLength(1)
      const journey = owners[0]
      for (const [dimension, required] of Object.entries(profile.requires)) {
        const covered = new Set(journey.covers[dimension] || [])
        expect(required.filter((value) => !covered.has(value)), `${profile.id}.${dimension}`).toEqual([])
      }
      expect(profile.resultProof, `${profile.id} has rendered-result proof`).toBeTruthy()
    }
    const requiredIds = new Set(MODEL_ACCESS_REQUIRED_PROFILES.map((profile) => profile.id))
    expect([...profileOwners.keys()].filter((id) => !requiredIds.has(id)), 'unknown profile ids').toEqual([])
  })

  it('points every stable roundtrip at an executable journey script', () => {
    for (const journey of STABLE_ROUNDTRIP_JOURNEYS) {
      const file = path.join(repoRoot, journey.script)
      expect(fs.existsSync(file), `${journey.id}: ${journey.script}`).toBe(true)
      if (fs.existsSync(file)) expect(fs.statSync(file).size, `${journey.id}: empty script`).toBeGreaterThan(0)
    }
  })
})
