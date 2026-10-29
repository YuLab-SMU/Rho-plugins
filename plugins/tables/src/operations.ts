// Owner business contracts. Application project/authentication fields are separate.
const legacyContracts = {
  "data.page": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
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
        "offset": {
          "type": "integer",
          "minimum": 0
        },
        "limit": {
          "type": "integer",
          "minimum": 1
        },
        "sort": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "column": {
              "type": "string",
              "minLength": 1
            },
            "direction": {
              "enum": [
                "asc",
                "desc"
              ]
            }
          },
          "required": [
            "column",
            "direction"
          ]
        },
        "filter": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "column": {
              "type": "string",
              "minLength": 1
            },
            "op": {
              "enum": [
                "eq",
                "lt",
                "gt",
                "isNull"
              ]
            },
            "value": {
              "type": [
                "string",
                "number",
                "boolean",
                "null"
              ]
            }
          },
          "required": [
            "column",
            "op"
          ]
        }
      },
      "required": [
        "resource",
        "offset",
        "limit"
      ]
    },
    "outputSchema": {
      "type": "object",
      "properties": {
        "resource": {
          "type": "object",
          "additionalProperties": true,
          "properties": {
            "id": {
              "type": "string",
              "minLength": 1
            },
            "version": {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            },
            "projectId": {
              "type": "string",
              "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
            },
            "owner": {
              "type": "string",
              "minLength": 1
            },
            "kind": {
              "enum": [
                "file",
                "table",
                "media",
                "object",
                "plot",
                "model"
              ]
            },
            "path": {
              "type": "string",
              "minLength": 1
            },
            "bytes": {
              "type": "integer",
              "minimum": 0
            },
            "provenance": {
              "type": "object"
            },
            "coverage": {
              "type": "object"
            },
            "availability": {
              "enum": [
                "available",
                "partial",
                "missing",
                "unknown"
              ]
            },
            "format": {
              "anyOf": [
                {
                  "type": "object"
                },
                {
                  "type": "string"
                }
              ]
            }
          },
          "required": [
            "id",
            "version",
            "projectId",
            "owner",
            "kind",
            "path",
            "bytes",
            "provenance",
            "coverage",
            "availability"
          ]
        },
        "columns": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "minLength": 1
              },
              "type": {
                "enum": [
                  "number",
                  "string",
                  "boolean"
                ]
              }
            },
            "required": [
              "name",
              "type"
            ],
            "additionalProperties": true
          }
        },
        "total": {
          "type": "integer",
          "minimum": 0
        },
        "filtered": {
          "type": "integer",
          "minimum": 0
        },
        "offset": {
          "type": "integer",
          "minimum": 0
        },
        "nextOffset": {
          "type": "integer",
          "minimum": 0
        },
        "more": {
          "type": "boolean"
        },
        "rows": {
          "type": "array",
          "items": {
            "type": "object"
          }
        },
        "entityKey": {
          "type": [
            "string",
            "null"
          ]
        },
        "namespace": {
          "type": [
            "string",
            "null"
          ]
        }
      },
      "required": [
        "resource",
        "columns",
        "total",
        "filtered",
        "offset",
        "nextOffset",
        "more",
        "rows",
        "entityKey"
      ],
      "additionalProperties": true
    },
    "requires": [
      "files"
    ],
    "effect": "read"
  },
  "data.compare": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "left": {
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
        "right": {
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
        "options": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "leftKey": {
              "type": "string",
              "minLength": 1
            },
            "rightKey": {
              "type": "string",
              "minLength": 1
            },
            "leftNamespace": {
              "type": "string",
              "minLength": 1
            },
            "rightNamespace": {
              "type": "string",
              "minLength": 1
            },
            "mapping": {
              "const": "equal-string"
            },
            "leftField": {
              "type": "string",
              "minLength": 1
            },
            "rightField": {
              "type": "string",
              "minLength": 1
            },
            "join": {
              "enum": [
                "left",
                "inner",
                "full"
              ]
            }
          },
          "required": [
            "leftKey",
            "rightKey",
            "leftNamespace",
            "rightNamespace",
            "mapping",
            "leftField",
            "rightField",
            "join"
          ]
        }
      },
      "required": [
        "left",
        "right",
        "options"
      ]
    },
    "outputSchema": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "version": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "projectId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
        },
        "owner": {
          "type": "string",
          "minLength": 1
        },
        "kind": {
          "enum": [
            "file",
            "table",
            "media",
            "object",
            "plot",
            "model"
          ]
        },
        "path": {
          "type": "string",
          "minLength": 1
        },
        "bytes": {
          "type": "integer",
          "minimum": 0
        },
        "provenance": {
          "type": "object"
        },
        "coverage": {
          "type": "object"
        },
        "availability": {
          "enum": [
            "available",
            "partial",
            "missing",
            "unknown"
          ]
        },
        "format": {
          "anyOf": [
            {
              "type": "object"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "version",
        "projectId",
        "owner",
        "kind",
        "path",
        "bytes",
        "provenance",
        "coverage",
        "availability"
      ]
    },
    "requires": [
      "files"
    ],
    "effect": "metadata"
  }
} as const;

const comparisonOptions: any = structuredClone(legacyContracts['data.compare'].inputSchema.properties.options);
comparisonOptions.properties.fields = { type: 'array', minItems: 1, maxItems: 16, items: { type: 'object', additionalProperties: false, properties: { leftField: { type: 'string', minLength: 1 }, rightField: { type: 'string', minLength: 1 } }, required: ['leftField', 'rightField'] } };
comparisonOptions.required = comparisonOptions.required.filter((f: string) => !['leftField', 'rightField'].includes(f));
comparisonOptions.oneOf = [{ required: ['leftField', 'rightField'], not: { required: ['fields'] } }, { required: ['fields'], not: { anyOf: [{ required: ['leftField'] }, { required: ['rightField'] }] } }];
export const operationContracts = { ...legacyContracts, 'data.compare': { ...legacyContracts['data.compare'], inputSchema: { ...legacyContracts['data.compare'].inputSchema, properties: { ...legacyContracts['data.compare'].inputSchema.properties, options: comparisonOptions } } } };
