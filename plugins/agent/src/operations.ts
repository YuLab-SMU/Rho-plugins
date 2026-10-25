import { feedbackSchemas } from './feedback-contract.js';
import { nativeSchemas } from './contract.js';
// Owner business contracts. Application project/authentication fields are separate.
const legacyOperationContracts = {
  "context.create": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "document": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "documentId": {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            },
            "version": {
              "type": "integer",
              "minimum": 1
            },
            "from": {
              "type": "integer",
              "minimum": 0
            },
            "to": {
              "type": "integer",
              "minimum": 0
            }
          },
          "required": [
            "documentId",
            "version"
          ]
        },
        "resource": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "id": {
              "type": "string",
              "minLength": 1
            },
            "version": {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            }
          },
          "required": [
            "id",
            "version"
          ]
        },
        "entities": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          },
          "maxItems": 1000
        },
        "annotations": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "annotationId": {
                "type": "string",
                "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
              },
              "version": {
                "type": "integer",
                "minimum": 1
              }
            },
            "required": [
              "annotationId",
              "version"
            ]
          },
          "minItems": 1,
          "maxItems": 128
        },
        "run": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "operationId": {
              "type": "string",
              "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
            }
          },
          "required": [
            "operationId"
          ]
        },
        "changeId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
        },
        "expectedVersion": {
          "const": 0
        },
        "region": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "page": {
              "type": "integer",
              "minimum": 1
            },
            "x": {
              "type": "number",
              "minimum": 0
            },
            "y": {
              "type": "number",
              "minimum": 0
            },
            "width": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "height": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "units": {
              "enum": [
                "pixels",
                "points"
              ]
            }
          },
          "required": [
            "page",
            "x",
            "y",
            "width",
            "height",
            "units"
          ]
        }
      },
      "required": []
    },
    "outputSchema": {
      "type": "object"
    },
    "requires": [],
    "effect": "metadata"
  },
  "context.read": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "contextId": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      },
      "required": [
        "contextId"
      ]
    },
    "outputSchema": {
      "type": "object"
    },
    "requires": [],
    "effect": "read"
  },
  "binding.list": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {},
      "required": []
    },
    "outputSchema": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "projectId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
          },
          "principal": {
            "type": "string",
            "minLength": 1
          },
          "externalSessionId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
          },
          "adapter": {
            "const": "claude-code-mcp"
          },
          "status": {
            "enum": [
              "connected",
              "disconnected"
            ]
          },
          "at": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "id",
          "projectId",
          "principal",
          "externalSessionId",
          "adapter",
          "status",
          "at"
        ],
        "additionalProperties": true
      }
    },
    "requires": [],
    "effect": "read"
  },
  "binding.activity": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {},
      "required": []
    },
    "outputSchema": {
      "type": "object",
      "properties": {
        "cursor": {
          "type": "integer",
          "minimum": 0
        },
        "retainedFrom": {
          "type": "integer",
          "minimum": 1
        },
        "entries": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "cursor": {
                "type": "integer",
                "minimum": 1
              },
              "principal": {
                "type": "string",
                "minLength": 1
              },
              "method": {
                "type": "string",
                "minLength": 1
              },
              "at": {
                "type": "string",
                "minLength": 1
              },
              "outcome": {
                "enum": [
                  "returned",
                  "rejected"
                ]
              }
            },
            "required": [
              "cursor",
              "principal",
              "method",
              "at",
              "outcome"
            ],
            "additionalProperties": true
          }
        }
      },
      "required": [
        "cursor",
        "retainedFrom",
        "entries"
      ],
      "additionalProperties": true
    },
    "requires": [],
    "effect": "read"
  },
  "binding.open": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "externalSessionId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
        },
        "adapter": {
          "const": "claude-code-mcp"
        }
      },
      "required": [
        "externalSessionId",
        "adapter"
      ]
    },
    "outputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "projectId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
        },
        "principal": {
          "type": "string",
          "minLength": 1
        },
        "externalSessionId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
        },
        "adapter": {
          "const": "claude-code-mcp"
        },
        "status": {
          "enum": [
            "connected",
            "disconnected"
          ]
        },
        "at": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "id",
        "projectId",
        "principal",
        "externalSessionId",
        "adapter",
        "status",
        "at"
      ],
      "additionalProperties": true
    },
    "requires": [],
    "effect": "metadata"
  },
  "binding.close": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "externalSessionId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
        }
      },
      "required": [
        "externalSessionId"
      ]
    },
    "outputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "projectId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
        },
        "principal": {
          "type": "string",
          "minLength": 1
        },
        "externalSessionId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
        },
        "adapter": {
          "const": "claude-code-mcp"
        },
        "status": {
          "enum": [
            "connected",
            "disconnected"
          ]
        },
        "at": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "id",
        "projectId",
        "principal",
        "externalSessionId",
        "adapter",
        "status",
        "at"
      ],
      "additionalProperties": true
    },
    "requires": [],
    "effect": "metadata"
  }
} as const;

const business = (schema: any) => structuredClone(schema);
export const operationContracts = {
  ...legacyOperationContracts,
  'feedback.submit': { inputSchema: feedbackSchemas.FeedbackSubmitInput, outputSchema: feedbackSchemas.SubmissionRecord, requires: ['documents', 'annotations'], effect: 'metadata' as const },
  'feedback.read': { inputSchema: feedbackSchemas.FeedbackReadInput, outputSchema: feedbackSchemas.FeedbackReadOutput, requires: ['annotations'], effect: 'metadata' as const },
  'feedback.status': { inputSchema: feedbackSchemas.DeliveryStatusInput, outputSchema: feedbackSchemas.DeliveryStatusOutput, requires: [], effect: 'read' as const },
  'binding.open': { ...legacyOperationContracts['binding.open'], inputSchema: business(nativeSchemas.BindingOpenExtended), outputSchema: { anyOf: [legacyOperationContracts['binding.open'].outputSchema, nativeSchemas.BindingRecordExtension] } },
  'binding.activity': { ...legacyOperationContracts['binding.activity'], inputSchema: { ...nativeSchemas.NativeActivityReadInput, required: [], allOf: [{ if: { required: ['source'] }, then: { required: ['source', 'taskId', 'query'] }, else: { not: { anyOf: [{ required: ['taskId'] }, { required: ['query'] }] } } }] }, outputSchema: { anyOf: [legacyOperationContracts['binding.activity'].outputSchema, nativeSchemas.NativeActivityReadOutput] } },
  'binding.activity.append': { inputSchema: business(nativeSchemas.ActivityAppendInput), outputSchema: nativeSchemas.ActivityAppendOutput, requires: [], effect: 'metadata' as const },
};
