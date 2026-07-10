import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PathAvailabilityNotice } from '../components/PathAvailabilityNotice.js'

describe('PathAvailabilityNotice', () => {
  it('renders TypeSpec provenance unavailability as status instead of an empty path table', () => {
    const html = renderToStaticMarkup(
      <PathAvailabilityNotice message="TypeSpec output-pointer provenance is unavailable." />,
    )

    expect(html).toContain('role="status"')
    expect(html).toContain('data-path-provenance-status="unavailable"')
    expect(html).toContain('TypeSpec output-pointer provenance is unavailable.')
  })
})
