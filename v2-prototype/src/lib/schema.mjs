export const STATUS = ['none', 'required', 'preferred', 'unknown'];

export const extractionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['postingType', 'recruitmentUnits', 'warnings'],
  properties: {
    postingType: { type: 'string', enum: ['recruitment', 'preannouncement', 'result', 'executive', 'unknown'] },
    recruitmentUnits: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['unitName','headcount','employmentType','workplaces','requirements','evidence'],
        properties: {
          unitName: { type: 'string' },
          headcount: { type: ['integer','null'] },
          employmentType: { type: 'string' },
          workplaces: { type: 'array', items: { type: 'string' } },
          requirements: {
            type: 'object', additionalProperties: false,
            required: ['education','experience','licenses','age','majorJob','region','legalOther'],
            properties: Object.fromEntries(['education','experience','licenses','age','majorJob','region','legalOther'].map(k => [k, requirementSchema()])),
          },
          evidence: { type: 'array', items: evidenceSchema() }
        }
      }
    },
    warnings: { type: 'array', items: { type: 'string' } }
  }
};

function requirementSchema() {
  return {
    type: 'object', additionalProperties: false,
    required: ['status','value','logic','evidenceIds'],
    properties: {
      status: { type: 'string', enum: STATUS },
      value: { type: ['string','null'] },
      logic: { type: 'string', enum: ['none','and','or','mixed','unknown'] },
      evidenceIds: { type: 'array', items: { type: 'string' } }
    }
  };
}
function evidenceSchema() {
  return {
    type: 'object', additionalProperties: false,
    required: ['id','sourceType','sourceRef','quote'],
    properties: {
      id: { type: 'string' },
      sourceType: { type: 'string', enum: ['api','web','attachment'] },
      sourceRef: { type: 'string' },
      quote: { type: 'string' }
    }
  };
}

export function emptyRequirement(status='unknown') {
  return { status, value: null, logic: 'unknown', evidenceIds: [] };
}
