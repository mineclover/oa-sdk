export const DPM_JOB_KIND = 'dpm.job.v1' as const

export type DpmJobOperation = 'compile' | 'dry_run'
export type DpmJobStatus = 'accepted' | 'completed' | 'failed'
