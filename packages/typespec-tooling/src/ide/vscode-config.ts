export interface VsCodeRecommendedExtensions {
  recommendations: string[]
  unwantedRecommendations?: string[]
}

export interface VsCodeSettings {
  '[typespec]'?: {
    'editor.defaultFormatter'?: string
    'editor.formatOnSave'?: boolean
    'editor.tabSize'?: number
  }
  'files.associations'?: Record<string, string>
  [key: string]: unknown
}

export function createDefaultVsCodeExtensions(): VsCodeRecommendedExtensions {
  return {
    recommendations: [
      'typespec.typespec-vscode',
    ],
  }
}

export function createDefaultVsCodeSettings(): VsCodeSettings {
  return {
    '[typespec]': {
      'editor.defaultFormatter': 'typespec.typespec-vscode',
      'editor.formatOnSave': true,
      'editor.tabSize': 2,
    },
    'files.associations': {
      '*.tsp': 'typespec',
    },
  }
}
