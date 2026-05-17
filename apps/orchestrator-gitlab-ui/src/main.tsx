import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import '@oa-sdk/markdown-editor/themes/base.css'
import '@oa-sdk/markdown-editor/themes/gitlab.css'
import './styles.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Missing #root')

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
