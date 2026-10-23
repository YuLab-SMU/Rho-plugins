// Exact expanded phase0-0.1 profiles. Inert metadata; no implementation import.
export const layeredSchemas: Record<string, any> = {
  "McpIndexInput": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "cursor": {
        "anyOf": [
          {
            "type": "string",
            "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
          },
          {
            "type": "null"
          }
        ]
      },
      "maxBytes": {
        "type": "integer",
        "minimum": 1024,
        "maximum": 65536
      }
    },
    "required": [
      "cursor",
      "maxBytes"
    ]
  },
  "McpResolveInput": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "catalogRef": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "selected": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "maxItems": 16,
        "minItems": 1
      },
      "knownRefs": {
        "type": "array",
        "items": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "maxItems": 128,
        "minItems": 0
      },
      "cursor": {
        "anyOf": [
          {
            "type": "string",
            "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
          },
          {
            "type": "null"
          }
        ]
      },
      "maxBytes": {
        "type": "integer",
        "minimum": 1024,
        "maximum": 65536
      }
    },
    "required": [
      "catalogRef",
      "selected",
      "knownRefs",
      "cursor",
      "maxBytes"
    ]
  },
  "McpCallInput": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "operation": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "contractRef": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "input": {
        "type": "object",
        "maxProperties": 64
      }
    },
    "required": [
      "operation",
      "contractRef",
      "input"
    ]
  },
  "AgentNoteProps": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "text": {
        "type": "string",
        "minLength": 1,
        "maxLength": 600
      },
      "authorBindingId": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "basisWitnessId": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "label": {
        "const": "Agent note"
      }
    },
    "required": [
      "text",
      "authorBindingId",
      "basisWitnessId",
      "label"
    ]
  }
};

Object.assign(layeredSchemas.McpIndexInput.properties, {
  owner: { type: 'string', minLength: 1, maxLength: 128 },
  search: { type: 'string', minLength: 1, maxLength: 128 }
});
layeredSchemas.McpIndexInput.required = [];
layeredSchemas.McpResolveInput.required = ['catalogRef', 'selected'];
layeredSchemas.McpCallInput.properties.maxBytes = { type: 'integer', minimum: 1024, maximum: 65536 };
layeredSchemas.McpReadInput = {
  type: 'object', additionalProperties: false,
  properties: {
    ref: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    path: { type: 'string', maxLength: 1024 },
    offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    maxBytes: { type: 'integer', minimum: 1024, maximum: 65536 },
    release: { type: 'boolean' }
  }, required: ['ref']
};
