import {
  capabilities,
  contextSearchResults,
  dryRunSemantics,
  issueQueue,
  kpi,
  operationalWarnings,
  pipelineRuns,
} from '../data/dashboard.js'
import { ContextSearchResults } from '../components/ContextSearchResults.js'
import { DryRunSemanticsPanel } from '../components/DryRunSemanticsPanel.js'
import { IssueQueue } from '../components/IssueQueue.js'
import { SummaryStrip, type SummaryStripMetric } from '../components/SummaryStrip.js'
import { WarningsCapabilitiesPanel } from '../components/WarningsCapabilitiesPanel.js'
import { translate, type Locale } from '../i18n/index.js'

export interface PageProps {
  locale: Locale
}

function summaryMetrics(locale: Locale): SummaryStripMetric[] {
  return [
    {
      id: 'active',
      label: translate(locale, 'summary.activePipelines'),
      value: kpi.activePipelines,
      detail: `${kpi.openMRs} ${translate(locale, 'summary.mrsPending')}`,
    },
    {
      id: 'blocked',
      label: translate(locale, 'summary.blockedPipelines'),
      value: kpi.blockedPipelines,
      detail: translate(locale, 'summary.requiresAction'),
    },
    {
      id: 'success',
      label: translate(locale, 'summary.successRate'),
      value: `${kpi.successRate}%`,
      detail: translate(locale, 'summary.rollingTarget'),
    },
    {
      id: 'lead',
      label: translate(locale, 'summary.leadTime'),
      value: `${kpi.avgLeadTimeHours}h`,
      detail: translate(locale, 'summary.requestToDone'),
    },
  ]
}

export function commonIssueLabels(locale: Locale) {
  return {
    title: translate(locale, 'issues.issueQueue'),
    project: translate(locale, 'issues.project'),
    owner: translate(locale, 'issues.owner'),
    estimate: translate(locale, 'issues.estimate'),
    remaining: translate(locale, 'issues.remaining'),
    queuePosition: translate(locale, 'issues.queuePosition'),
    notAvailable: translate(locale, 'empty.notAvailable'),
  }
}

export function commonContextLabels(locale: Locale) {
  return {
    title: translate(locale, 'context.results'),
    project: translate(locale, 'issues.project'),
    source: translate(locale, 'context.source'),
    confidence: translate(locale, 'context.confidence'),
    updated: translate(locale, 'context.updated'),
    minutesAgo: (minutes: number) => translate(locale, 'time.minutesAgo', { minutes }),
    hoursMinutesAgo: (hours: number, minutes: number) =>
      translate(locale, 'time.hoursMinutesAgo', { hours, minutes }),
  }
}

export function commonWarningLabels(locale: Locale) {
  return {
    warningsTitle: translate(locale, 'panel.operationalWarnings'),
    capabilitiesTitle: translate(locale, 'panel.capabilities'),
    owner: translate(locale, 'panel.owner'),
  }
}

export function commonDryRunLabels(locale: Locale) {
  return {
    title: translate(locale, 'panel.dryRun'),
    description: translate(locale, 'panel.dryRunDescription'),
  }
}

export function OverviewPage({ locale }: PageProps) {
  return (
    <>
      <SummaryStrip
        metrics={summaryMetrics(locale)}
        pipelineStatesLabel={translate(locale, 'summary.pipelineStates')}
        pipelines={pipelineRuns}
      />

      <section className="panel-grid">
        <IssueQueue issues={issueQueue} labels={commonIssueLabels(locale)} />
        <ContextSearchResults results={contextSearchResults} labels={commonContextLabels(locale)} />
      </section>

      <WarningsCapabilitiesPanel
        warnings={operationalWarnings}
        capabilities={capabilities}
        labels={commonWarningLabels(locale)}
      />

      <DryRunSemanticsPanel steps={dryRunSemantics} labels={commonDryRunLabels(locale)} />
    </>
  )
}
