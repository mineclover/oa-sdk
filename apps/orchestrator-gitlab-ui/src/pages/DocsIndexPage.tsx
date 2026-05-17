import type { MouseEvent } from 'react'
import { translate, type Locale } from '../i18n/index.js'
import {
  defaultDocument,
  docsByType,
  docsFromScope,
  documentEditPath,
  documentStorageLocation,
  documentationStatusClass,
  itemCountByScope,
  topIssueLikeContext,
} from './docs-model.js'

export interface DocsIndexPageProps {
  readonly locale: Locale
  readonly onNavigate: (path: string) => void
}

export function DocsIndexPage({ locale, onNavigate }: DocsIndexPageProps) {
  function handleOpenEditor(event: MouseEvent<HTMLAnchorElement>, documentId: string) {
    event.preventDefault()
    onNavigate(documentEditPath(documentId))
  }

  return (
    <>
      <section className="panel document-workspace">
        <div>
          <h2>{translate(locale, 'docs.workspaceTitle')}</h2>
          <p className="run-meta">{translate(locale, 'docs.workspaceDescription')}</p>
          <p className="run-meta">
            {translate(locale, 'docs.editorRouteHint')}: <code>{documentEditPath(defaultDocument.id)}</code>
          </p>
        </div>
        <a
          className="document-edit-link document-edit-link-primary"
          href={documentEditPath(defaultDocument.id)}
          onClick={event => handleOpenEditor(event, defaultDocument.id)}
        >
          {translate(locale, 'docs.openFirstEditor')}
        </a>
      </section>

      <section className="summary-strip">
        {docsByType.map(group => (
          <article className="summary-strip-item" key={group.scope}>
            <p className="summary-strip-label">{translate(locale, group.titleKey)}</p>
            <p className="summary-strip-value">{itemCountByScope(group.scope)}</p>
            <p className="summary-strip-sub">{translate(locale, 'docs.lastSynced')}</p>
          </article>
        ))}
      </section>

      <section className="panel-grid">
        {docsByType.map(group => {
          const items = docsFromScope(group.scope)
          return (
            <section className="panel" key={group.scope}>
              <h2>{translate(locale, group.titleKey)}</h2>
              <ul className="run-list">
                {items.map(item => (
                  <li className="run-card" key={item.id}>
                    <div className="run-title">
                      <strong>{item.title}</strong>
                      <span className={documentationStatusClass(item.status)}>{item.status}</span>
                    </div>
                    <p className="run-meta">{translate(locale, 'docs.project')}: {item.project}</p>
                    <p className="run-meta">{item.path}</p>
                    <p className="run-meta">{translate(locale, 'docs.owner')}: {item.owner}</p>
                    <p className="run-meta">{translate(locale, 'docs.editorRoute')}: {documentEditPath(item.id)}</p>
                    <p className="run-meta">{translate(locale, 'docs.autosaveLocation')}: {documentStorageLocation(item.id)}</p>
                    <a
                      className="document-edit-link"
                      href={documentEditPath(item.id)}
                      onClick={event => handleOpenEditor(event, item.id)}
                    >
                      {translate(locale, 'docs.openEditor')}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </section>

      <section className="panel">
        <h2>{translate(locale, 'docs.referenceLookup')}</h2>
        <p className="run-meta">{translate(locale, 'docs.referenceDescription')}</p>
        <ul className="run-list">
          {topIssueLikeContext().map(context => (
            <li className="run-card" key={context.id}>
              <div className="run-title">
                <strong>{context.query}</strong>
                <span className="badge badge-info">{context.contextType}</span>
              </div>
              <p className="run-meta">{context.snippet}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
