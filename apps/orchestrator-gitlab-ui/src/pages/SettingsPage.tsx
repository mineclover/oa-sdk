import {
  capabilities,
  dryRunSemantics,
  operationalWarnings,
  type Capability,
} from '../data/dashboard.js'
import { DryRunSemanticsPanel } from '../components/DryRunSemanticsPanel.js'
import { WarningsCapabilitiesPanel } from '../components/WarningsCapabilitiesPanel.js'
import { translate, type Locale } from '../i18n/index.js'
import { commonDryRunLabels, commonWarningLabels } from './OverviewPage.js'

type TokenState = 'enabled' | 'read-only' | 'expired'

interface TokenPolicy {
  readonly id: string
  readonly service: string
  readonly tokenState: TokenState
  readonly scope: string
  readonly expiresAt: string
}

const tokenPolicies: ReadonlyArray<TokenPolicy> = [
  {
    id: 'tok-platform',
    service: 'Platform API',
    tokenState: 'enabled',
    scope: 'read_api + write_repository',
    expiresAt: '2026-06-14',
  },
  {
    id: 'tok-release',
    service: 'Release API',
    tokenState: 'read-only',
    scope: 'read_api + read_repository',
    expiresAt: '2026-06-01',
  },
  {
    id: 'tok-alert',
    service: 'Observability',
    tokenState: 'expired',
    scope: 'read_api + read_mrs',
    expiresAt: '2026-04-30',
  },
]

function tokenStateClass(state: TokenState): string {
  if (state === 'enabled') return 'status status-running'
  if (state === 'read-only') return 'badge badge-info'
  return 'badge badge-critical'
}

function byOwner(capabilitiesInput: ReadonlyArray<Capability>): Record<string, number> {
  return capabilitiesInput.reduce(
    (acc, capability) => {
      acc[capability.owner] = (acc[capability.owner] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )
}

export function SettingsPage({ locale }: { locale: Locale }) {
  const capabilityOwners = byOwner(capabilities)

  return (
    <>
      <section className="panel-grid">
        <section className="panel">
          <h2>{translate(locale, 'settings.tokenInventory')}</h2>
          <ul className="run-list">
            {tokenPolicies.map(token => (
              <li className="run-card" key={token.id}>
                <div className="run-title">
                  <strong>{token.service}</strong>
                  <span className={tokenStateClass(token.tokenState)}>{token.tokenState}</span>
                </div>
                <p className="run-meta">{translate(locale, 'settings.scope')}: {token.scope}</p>
                <p className="run-meta">{translate(locale, 'settings.expires')}: {token.expiresAt}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>{translate(locale, 'settings.capabilityOwners')}</h2>
          <ul className="run-list">
            {Object.entries(capabilityOwners).map(([owner, count]) => (
              <li className="run-card" key={owner}>
                <div className="run-title">
                  <strong>{owner}</strong>
                  <span className="badge badge-info">{count}</span>
                </div>
                <p className="run-meta">{translate(locale, 'settings.capabilityOwnerDescription')}</p>
              </li>
            ))}
          </ul>
        </section>
      </section>

      <section className="panel-grid">
        <WarningsCapabilitiesPanel
          warnings={operationalWarnings}
          capabilities={capabilities}
          labels={commonWarningLabels(locale)}
        />
        <DryRunSemanticsPanel steps={dryRunSemantics} labels={commonDryRunLabels(locale)} />
      </section>
    </>
  )
}
