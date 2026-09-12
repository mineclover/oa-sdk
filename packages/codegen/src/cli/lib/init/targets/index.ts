import { FastifyTargetProfile } from './fastify.js'
import { ElysiaTargetProfile } from './elysia.js'
import { HonoTargetProfile } from './hono.js'
import { ExpressTargetProfile } from './express.js'
import { NestJSTargetProfile } from './nestjs.js'
import { GenericTargetProfile } from './generic.js'
import type { TargetFrameworkId, TargetProfile } from '../types.js'

export {
  FastifyTargetProfile,
  ElysiaTargetProfile,
  HonoTargetProfile,
  ExpressTargetProfile,
  NestJSTargetProfile,
  GenericTargetProfile,
}

export const TARGET_PROFILES: Record<TargetFrameworkId, TargetProfile> = {
  fastify: new FastifyTargetProfile(),
  elysia: new ElysiaTargetProfile(),
  hono: new HonoTargetProfile(),
  express: new ExpressTargetProfile(),
  nestjs: new NestJSTargetProfile(),
  generic: new GenericTargetProfile(),
}

export function getTargetProfile(id: TargetFrameworkId): TargetProfile {
  const target = TARGET_PROFILES[id]
  if (!target) {
    throw new Error(`Unknown target framework: ${id}. Supported targets: ${Object.keys(TARGET_PROFILES).join(', ')}`)
  }
  return target
}

export async function detectTargetProfile(cwd: string): Promise<{ profile: TargetProfile; confidence: number }> {
  let highestConfidence = 0.0
  let matchedProfile: TargetProfile = TARGET_PROFILES.generic

  for (const profile of Object.values(TARGET_PROFILES)) {
    if (profile.id === 'generic') continue
    const det = await profile.detect(cwd)
    if (det.confidence > highestConfidence) {
      highestConfidence = det.confidence
      matchedProfile = profile
    }
  }

  if (highestConfidence < 0.5) {
    return { profile: TARGET_PROFILES.generic, confidence: highestConfidence }
  }

  return { profile: matchedProfile, confidence: highestConfidence }
}
