import { describe, expect, it } from 'vitest'
import { APP_BAR_ACTION_GROUPS } from './appBarActionGroups'

describe('app bar action groups', () => {
  it('keeps onboarding and browser in the assist group', () => {
    expect(APP_BAR_ACTION_GROUPS.assist).toEqual(['onboarding', 'browser'])
  })

  it('keeps settings beside model access instead of browser', () => {
    expect(APP_BAR_ACTION_GROUPS.config).toEqual(['settings', 'modelAccess'])
    expect(APP_BAR_ACTION_GROUPS.assist).not.toContain('settings')
  })

  it('reserves the primary group for producing the film', () => {
    expect(APP_BAR_ACTION_GROUPS.primary).toEqual(['goToProduce'])
  })
})
