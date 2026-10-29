// Owner business contracts. Application project/authentication fields are separate.
const legacyContracts = {
  "resource.list": {
    "inputSchema": {
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
    "outputSchema": {
      "type": "object",
      "properties": {
        "integrity": {
          "type": "object"
        },
        "domain": {
          "type": "object"
        },
        "resources": {
          "type": "array",
          "items": {
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
          }
        }
      },
      "required": [
        "integrity",
        "domain"
      ],
      "additionalProperties": true
    },
    "requires": [],
    "effect": "read"
  },
  "resource.read": {
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
        "maxBytes": {
          "type": "integer",
          "minimum": 1
        }
      },
      "required": [
        "resource",
        "offset"
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
        "encoding": {
          "const": "base64"
        },
        "data": {
          "type": "string"
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
        }
      },
      "required": [
        "resource",
        "encoding",
        "data",
        "offset",
        "nextOffset",
        "more"
      ],
      "additionalProperties": true
    },
    "requires": [],
    "effect": "read"
  },
  "resource.register": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "declaration": {
          "oneOf": [
            {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "path": {
                  "type": "string",
                  "minLength": 1
                },
                "kind": {
                  "const": "file"
                },
                "format": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "mimeType": {
                      "type": "string",
                      "minLength": 1
                    }
                  },
                  "required": [
                    "mimeType"
                  ]
                }
              },
              "required": [
                "path",
                "kind",
                "format"
              ]
            },
            {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "path": {
                  "type": "string",
                  "minLength": 1
                },
                "kind": {
                  "const": "table"
                },
                "format": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "encoding": {
                      "enum": [
                        "csv",
                        "json-rows"
                      ]
                    },
                    "columns": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                          "name": {
                            "type": "string",
                            "minLength": 1
                          },
                          "type": {
                            "enum": [
                              "string",
                              "number",
                              "boolean"
                            ]
                          },
                          "nullValues": {
                            "type": "array",
                            "items": {
                              "type": "string"
                            },
                            "maxItems": 16
                          }
                        },
                        "required": [
                          "name",
                          "type",
                          "nullValues"
                        ]
                      },
                      "minItems": 1,
                      "maxItems": 256
                    },
                    "key": {
                      "anyOf": [
                        {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "column": {
                              "type": "string",
                              "minLength": 1
                            },
                            "namespace": {
                              "type": "string",
                              "minLength": 1
                            }
                          },
                          "required": [
                            "column",
                            "namespace"
                          ]
                        },
                        {
                          "type": "null"
                        }
                      ]
                    }
                  },
                  "required": [
                    "encoding",
                    "columns",
                    "key"
                  ]
                }
              },
              "required": [
                "path",
                "kind",
                "format"
              ]
            },
            {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "path": {
                  "type": "string",
                  "minLength": 1
                },
                "kind": {
                  "const": "media"
                },
                "format": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "mimeType": {
                      "enum": [
                        "image/png",
                        "image/jpeg",
                        "image/svg+xml",
                        "application/pdf"
                      ]
                    },
                    "pages": {
                      "type": "integer",
                      "minimum": 1
                    },
                    "width": {
                      "type": "number",
                      "exclusiveMinimum": 0
                    },
                    "height": {
                      "type": "number",
                      "exclusiveMinimum": 0
                    }
                  },
                  "required": [
                    "mimeType"
                  ]
                }
              },
              "required": [
                "path",
                "kind",
                "format"
              ]
            },
            {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "path": {
                  "type": "string",
                  "minLength": 1
                },
                "kind": {
                  "const": "object"
                },
                "format": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "encoding": {
                      "const": "json"
                    },
                    "observation": {
                      "const": "exported-snapshot"
                    },
                    "classes": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "minLength": 1
                      },
                      "maxItems": 32
                    }
                  },
                  "required": [
                    "encoding",
                    "observation",
                    "classes"
                  ]
                }
              },
              "required": [
                "path",
                "kind",
                "format"
              ]
            }
          ]
        },
        "expectedDigest": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      },
      "required": [
        "declaration",
        "expectedDigest"
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
    "requires": [],
    "effect": "metadata"
  },
  "artifact.check": {
    "inputSchema": {
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
    "outputSchema": {
      "type": "object",
      "properties": {
        "integrity": {
          "type": "object"
        },
        "domain": {
          "type": "object"
        },
        "resources": {
          "type": "array",
          "items": {
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
          }
        }
      },
      "required": [
        "integrity",
        "domain"
      ],
      "additionalProperties": true
    },
    "requires": [],
    "effect": "metadata"
  }
} as const;

import { objectSchema as obj, text, refSchema } from '@rho-workspace/plugin-contracts';
export const operationContracts = { ...legacyContracts,
  'resource.capture': {
    inputSchema: { ...obj({ path: text, document: obj({ documentId: text, version: { type: 'integer', minimum: 1 } }), expectedDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' }, declaration: legacyContracts['resource.register'].inputSchema.properties.declaration }, []), oneOf: [{ required: ['path'], not: { required: ['document'] } }, { required: ['document'], not: { required: ['path'] } }] },
    outputSchema: legacyContracts['resource.register'].outputSchema, requires: [] as string[], effect: 'metadata' as const
  }
};
