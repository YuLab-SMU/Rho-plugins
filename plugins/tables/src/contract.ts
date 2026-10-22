import { objectSchema as obj, text } from '@rho-workspace/plugin-contracts';
export interface Column { name: string; type: 'string' | 'number' | 'boolean'; nullValues: string[] }
export interface TableFormat { encoding: 'csv' | 'json-rows'; columns: Column[]; key: { column: string; namespace: string } | null }
export const columnSchema = obj({ name: text, type: { enum: ['string', 'number', 'boolean'] }, nullValues: { type: 'array', items: { type: 'string' }, maxItems: 16 } });
export const tableFormatSchema = obj({ encoding: { enum: ['csv', 'json-rows'] }, columns: { type: 'array', items: columnSchema, minItems: 1, maxItems: 256 }, key: { anyOf: [obj({ column: text, namespace: text }), { type: 'null' }] } });
export const declarationSchema = obj({ path: text, kind: { const: 'table' }, format: tableFormatSchema });

// Exact DOM coverage profile. It reports renderer evidence, not human perception.
export const tableDomCoverageSchema = {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "kind": {
      "const": "table-dom"
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
    "query": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "offset": {
          "type": "integer",
          "minimum": 0
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000
        },
        "sort": {
          "anyOf": [
            {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "column": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
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
            {
              "type": "null"
            }
          ]
        },
        "filter": {
          "anyOf": [
            {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "column": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
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
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "offset",
        "limit",
        "sort",
        "filter"
      ]
    },
    "loadedRows": {
      "type": "integer",
      "minimum": 0
    },
    "visibleRows": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "entityKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "columns": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "maxItems": 256,
            "minItems": 1
          }
        },
        "required": [
          "entityKey",
          "columns"
        ]
      },
      "maxItems": 1000,
      "minItems": 0
    },
    "namespace": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "rowValuesDigest": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$"
    },
    "documentVisible": {
      "type": "boolean"
    },
    "panelWithinViewport": {
      "type": "boolean"
    },
    "keyCellsWithinViewport": {
      "type": "boolean"
    },
    "framesAfterData": {
      "type": "integer",
      "minimum": 2,
      "maximum": 10
    },
    "occlusion": {
      "enum": [
        "not-verified",
        "element-hit-tested"
      ]
    }
  },
  "required": [
    "kind",
    "resource",
    "query",
    "loadedRows",
    "visibleRows",
    "namespace",
    "rowValuesDigest",
    "documentVisible",
    "panelWithinViewport",
    "keyCellsWithinViewport",
    "framesAfterData",
    "occlusion"
  ]
};
