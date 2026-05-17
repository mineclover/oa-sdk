import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  ItalicPlugin,
  StrikethroughPlugin,
} from '@platejs/basic-nodes/react'
import { IndentPlugin } from '@platejs/indent/react'
import { LinkPlugin } from '@platejs/link/react'
import { ListPlugin } from '@platejs/list/react'
import {
  PlateElement,
  type PlateElementProps,
} from 'platejs/react'

export interface GitLabPlatePresetClassNames {
  readonly heading?: string
  readonly heading1?: string
  readonly heading2?: string
  readonly heading3?: string
  readonly heading4?: string
  readonly heading5?: string
  readonly heading6?: string
  readonly blockquote?: string
}

export interface GitLabPlatePresetOptions {
  readonly classNames?: GitLabPlatePresetClassNames
}

const defaultClassNames = {
  blockquote: 'plate-blockquote',
  heading: 'plate-heading',
  heading1: 'plate-heading-1',
  heading2: 'plate-heading-2',
  heading3: 'plate-heading-3',
  heading4: 'plate-heading-4',
  heading5: 'plate-heading-5',
  heading6: 'plate-heading-6',
} as const satisfies Required<GitLabPlatePresetClassNames>

function classNameFor(...classNames: Array<string | undefined>): string {
  return classNames.filter(Boolean).join(' ')
}

function resolvePresetClassNames(options: GitLabPlatePresetOptions = {}): Required<GitLabPlatePresetClassNames> {
  return {
    ...defaultClassNames,
    ...options.classNames,
  }
}

export function createGitLabPlatePlugins(options: GitLabPlatePresetOptions = {}) {
  const classNames = resolvePresetClassNames(options)

  function H1Element(props: PlateElementProps) {
    return <PlateElement as="h1" className={classNameFor(classNames.heading, classNames.heading1)} {...props} />
  }

  function H2Element(props: PlateElementProps) {
    return <PlateElement as="h2" className={classNameFor(classNames.heading, classNames.heading2)} {...props} />
  }

  function H3Element(props: PlateElementProps) {
    return <PlateElement as="h3" className={classNameFor(classNames.heading, classNames.heading3)} {...props} />
  }

  function H4Element(props: PlateElementProps) {
    return <PlateElement as="h4" className={classNameFor(classNames.heading, classNames.heading4)} {...props} />
  }

  function H5Element(props: PlateElementProps) {
    return <PlateElement as="h5" className={classNameFor(classNames.heading, classNames.heading5)} {...props} />
  }

  function H6Element(props: PlateElementProps) {
    return <PlateElement as="h6" className={classNameFor(classNames.heading, classNames.heading6)} {...props} />
  }

  function BlockquoteElement(props: PlateElementProps) {
    return <PlateElement as="blockquote" className={classNames.blockquote} {...props} />
  }

  return [
    BoldPlugin,
    ItalicPlugin,
    CodePlugin,
    StrikethroughPlugin,
    LinkPlugin,
    IndentPlugin,
    ListPlugin,
    H1Plugin.withComponent(H1Element),
    H2Plugin.withComponent(H2Element),
    H3Plugin.withComponent(H3Element),
    H4Plugin.withComponent(H4Element),
    H5Plugin.withComponent(H5Element),
    H6Plugin.withComponent(H6Element),
    BlockquotePlugin.withComponent(BlockquoteElement),
  ]
}
