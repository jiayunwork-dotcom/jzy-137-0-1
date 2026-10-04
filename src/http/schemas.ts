/** JSON Schemas for Fastify route validation (coarse shape only — the
 *  handlers add domain checks with more specific error messages). */

export const MAX_BLOCK_POINTS = 200_000

export const createJobBodySchema = {
  type: 'object',
  required: ['material', 'snCurve', 'meanStressCorrection'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', maxLength: 200 },
    material: { type: 'string', minLength: 1, maxLength: 200 },
    snCurve: {
      type: 'object',
      required: ['C', 'm'],
      additionalProperties: false,
      properties: {
        C: { type: 'number', exclusiveMinimum: 0 },
        m: { type: 'number', exclusiveMinimum: 0 },
      },
    },
    meanStressCorrection: { enum: ['none', 'goodman'] },
    ultimateStrength: { type: 'number', exclusiveMinimum: 0 },
    hysteresisGate: { type: 'number', minimum: 0 },
  },
} as const

export const blockBodySchema = {
  type: 'object',
  required: ['seq', 'points'],
  additionalProperties: false,
  properties: {
    seq: { type: 'integer', minimum: 1 },
    points: { type: 'array' },
  },
} as const

export const resultQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    offset: { type: 'integer', minimum: 0, default: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 1_000_000 },
  },
} as const
