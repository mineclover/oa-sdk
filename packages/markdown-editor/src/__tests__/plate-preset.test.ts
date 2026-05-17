import { describe, expect, it } from 'vitest'
import { createGitLabPlatePlugins } from '../plate/index.js'

describe('GitLab Plate preset', () => {
  it('creates the supported plugin set', () => {
    expect(createGitLabPlatePlugins()).toHaveLength(15)
  })

  it('accepts host class name overrides', () => {
    expect(
      createGitLabPlatePlugins({
        classNames: {
          blockquote: 'host-blockquote',
          heading: 'host-heading',
          heading1: 'host-heading-1',
        },
      }),
    ).toHaveLength(15)
  })

  it('can disable Markdown import/export integration for minimal hosts', () => {
    expect(createGitLabPlatePlugins({ markdown: false })).toHaveLength(14)
  })
})
