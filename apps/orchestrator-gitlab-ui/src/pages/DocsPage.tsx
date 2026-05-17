import { translate, type Locale } from '../i18n/index.js'
import { DocumentEditorPage } from './DocumentEditorPage.js'
import { DocsIndexPage } from './DocsIndexPage.js'
import {
  docsData,
  documentIdFromPathname,
} from './docs-model.js'

export interface DocsPageProps {
  readonly locale: Locale
  readonly pathname: string
  readonly onNavigate: (path: string) => void
}

export function DocsPage({ locale, onNavigate, pathname }: DocsPageProps) {
  const routeDocumentId = documentIdFromPathname(pathname)
  const selectedDocument = docsData.find(item => item.id === routeDocumentId)
  const isEditorPage = routeDocumentId !== undefined

  if (isEditorPage && selectedDocument === undefined) {
    return <DocumentNotFound locale={locale} onNavigate={onNavigate} />
  }

  if (selectedDocument !== undefined) {
    return <DocumentEditorPage document={selectedDocument} locale={locale} onNavigate={onNavigate} />
  }

  return <DocsIndexPage locale={locale} onNavigate={onNavigate} />
}

function DocumentNotFound({ locale, onNavigate }: Pick<DocsPageProps, 'locale' | 'onNavigate'>) {
  return (
    <section className="panel">
      <h2>{translate(locale, 'docs.notFoundTitle')}</h2>
      <p className="run-meta">{translate(locale, 'docs.notFoundDescription')}</p>
      <button className="button" type="button" onClick={() => onNavigate('/docs')}>
        {translate(locale, 'docs.backToDocs')}
      </button>
    </section>
  )
}
