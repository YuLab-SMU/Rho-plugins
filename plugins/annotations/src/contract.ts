// Exact retained annotation source/message profile.
const annotationSchemas: Record<string, any> = {
  "message": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "author": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "at": {
        "type": "string",
        "format": "date-time"
      },
      "draft": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "source": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "kind": {
                "const": "buffer"
              },
              "documentId": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "version": {
                "type": "integer",
                "minimum": 1
              },
              "path": {
                "type": "string",
                "minLength": 1,
                "maxLength": 4096
              },
              "dirty": {
                "type": "boolean"
              }
            },
            "required": [
              "kind",
              "documentId",
              "version",
              "path",
              "dirty"
            ]
          },
          "sha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "text": {
            "type": "string",
            "maxLength": 1048576
          }
        },
        "required": [
          "source",
          "sha256",
          "text"
        ]
      },
      "replyTo": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      }
    },
    "required": [
      "id",
      "author",
      "at",
      "draft"
    ]
  },
  "thread": {
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
      },
      "anchor": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "kind": {
                "const": "document"
              },
              "documentId": {
                "type": "string",
                "minLength": 1
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
              "kind",
              "documentId",
              "version",
              "from",
              "to"
            ]
          },
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "kind": {
                "const": "table"
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
                "minItems": 1,
                "maxItems": 1024,
                "uniqueItems": true,
                "items": {
                  "type": "string",
                  "minLength": 1
                }
              }
            },
            "required": [
              "kind",
              "resource",
              "entities"
            ]
          }
        ]
      },
      "source": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "kind": {
                "const": "table"
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
              "namespace": {
                "type": "string",
                "minLength": 1,
                "maxLength": 128
              },
              "entityKey": {
                "type": "string",
                "minLength": 1,
                "maxLength": 128
              },
              "rows": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": {
                    "type": [
                      "string",
                      "number",
                      "boolean",
                      "null"
                    ]
                  }
                },
                "maxItems": 1024,
                "minItems": 1
              }
            },
            "required": [
              "kind",
              "resource",
              "namespace",
              "entityKey",
              "rows"
            ]
          },
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "kind": {
                "const": "document"
              },
              "source": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "kind": {
                    "const": "buffer"
                  },
                  "documentId": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{64}$"
                  },
                  "version": {
                    "type": "integer",
                    "minimum": 1
                  },
                  "path": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 4096
                  },
                  "dirty": {
                    "type": "boolean"
                  }
                },
                "required": [
                  "kind",
                  "documentId",
                  "version",
                  "path",
                  "dirty"
                ]
              },
              "sha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "from": {
                "type": "integer",
                "minimum": 0
              },
              "to": {
                "type": "integer",
                "minimum": 0
              },
              "text": {
                "type": "string",
                "maxLength": 1048576
              }
            },
            "required": [
              "kind",
              "source",
              "sha256",
              "from",
              "to",
              "text"
            ]
          }
        ]
      },
      "messages": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            },
            "author": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "at": {
              "type": "string",
              "format": "date-time"
            },
            "draft": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "source": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "kind": {
                      "const": "buffer"
                    },
                    "documentId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{64}$"
                    },
                    "version": {
                      "type": "integer",
                      "minimum": 1
                    },
                    "path": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 4096
                    },
                    "dirty": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "kind",
                    "documentId",
                    "version",
                    "path",
                    "dirty"
                  ]
                },
                "sha256": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{64}$"
                },
                "text": {
                  "type": "string",
                  "maxLength": 1048576
                }
              },
              "required": [
                "source",
                "sha256",
                "text"
              ]
            },
            "replyTo": {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            }
          },
          "required": [
            "id",
            "author",
            "at",
            "draft"
          ]
        },
        "maxItems": 256,
        "minItems": 1
      },
      "receipts": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "changeId": {
              "type": "string",
              "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
            },
            "requestDigest": {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            },
            "author": {
              "type": "string",
              "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
            },
            "version": {
              "type": "integer",
              "minimum": 1
            },
            "at": {
              "type": "string",
              "format": "date-time"
            }
          },
          "required": [
            "changeId",
            "requestDigest",
            "author",
            "version",
            "at"
          ]
        },
        "maxItems": 256,
        "minItems": 1
      },
      "receipt": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "changeId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
          },
          "requestDigest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "author": {
            "type": "string",
            "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
          },
          "version": {
            "type": "integer",
            "minimum": 1
          },
          "at": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "changeId",
          "requestDigest",
          "author",
          "version",
          "at"
        ]
      },
      "retainedFromVersion": {
        "type": "integer",
        "minimum": 1
      },
      "sourceStatus": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "state": {
                "enum": [
                  "same-version",
                  "version-differs"
                ]
              },
              "currentVersion": {
                "type": "integer",
                "minimum": 1
              },
              "anchoredVersion": {
                "type": "integer",
                "minimum": 1
              }
            },
            "required": [
              "state",
              "currentVersion",
              "anchoredVersion"
            ]
          },
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "state": {
                "const": "same-version"
              }
            },
            "required": [
              "state"
            ]
          },
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "state": {
                "const": "snapshot-retained"
              }
            },
            "required": [
              "state"
            ]
          },
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "state": {
                "const": "source-unavailable"
              },
              "snapshot": {
                "const": "retained"
              }
            },
            "required": [
              "state",
              "snapshot"
            ]
          }
        ]
      }
    },
    "required": [
      "annotationId",
      "version",
      "anchor",
      "source",
      "messages",
      "receipts",
      "retainedFromVersion"
    ]
  }
};

import { objectSchema as obj, text, refSchema as ref } from '@rho-workspace/plugin-contracts';
const version = { type: 'integer', minimum: 1 };
const integer = { type: 'integer', minimum: 0 };
const changeId = { type: 'string', pattern: '^[A-Za-z0-9._:@-]{1,128}$' };
const replyResources = { type: 'array', maxItems: 16, uniqueItems: true, items: ref };
annotationSchemas.message.properties.resources = replyResources;
annotationSchemas.thread.properties.messages.items.properties.resources = replyResources;
export const draftSchema = obj({ documentId: text, version });
export const anchorSchema = { oneOf: [
  obj({ kind: { const: 'document' }, documentId: text, version, from: integer, to: integer }),
  obj({ kind: { const: 'table' }, resource: ref, entities: { type: 'array', minItems: 1, maxItems: 1024, uniqueItems: true, items: text } })
] };
const wholeResourceAnchor = obj({ kind: { const: 'resource' }, resource: ref });
anchorSchema.oneOf.push(wholeResourceAnchor as any);
annotationSchemas.thread.properties.anchor.oneOf.push(wholeResourceAnchor as any);
annotationSchemas.thread.properties.source.oneOf.push(obj({ kind: { const: 'resource' }, resource: ref, metadata: { type: 'object' } }) as any);
const decision = obj({ id: text, author: text, at: { type: 'string' }, version, targetMessageId: text, resources: replyResources,
  status: { enum: ['accepted', 'needs-changes', 'withdrawn'] }, reason: { type: 'string' }, supersedes: text,
  draft: { type: 'object' } }, ['id', 'author', 'at', 'version', 'targetMessageId', 'resources', 'status', 'reason']);
(annotationSchemas.thread.properties as any).decisions = { type: 'array', maxItems: 256, items: decision };
export const inputs = {
  'annotation.create': obj({ annotationId: changeId, expectedVersion: { const: 0 }, changeId, anchor: anchorSchema, draft: draftSchema }),
  'annotation.reply': obj({ annotationId: changeId, expectedVersion: version, changeId, replyTo: text, draft: draftSchema, resources: replyResources }, ['annotationId', 'expectedVersion', 'changeId', 'replyTo', 'draft']),
  'annotation.decide': obj({ annotationId: changeId, expectedVersion: version, changeId, targetMessageId: text, resources: { ...replyResources, minItems: 1 }, status: { enum: ['accepted', 'needs-changes', 'withdrawn'] }, draft: draftSchema, supersedes: text }, ['annotationId', 'expectedVersion', 'changeId', 'targetMessageId', 'resources', 'status']),
  'annotation.read': obj({ annotationId: changeId }),
  'annotation.list': obj({})
};
export const outputs = { 'annotation.decide': annotationSchemas.thread, 'annotation.create': annotationSchemas.thread, 'annotation.reply': annotationSchemas.thread, 'annotation.read': annotationSchemas.thread, 'annotation.list': { type: 'array', items: annotationSchemas.thread } };

export const feedbackComposerPropsSchema = {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 80
    },
    "taskId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
    },
    "sourceSelectionScope": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "kind": {
          "const": "shared"
        },
        "id": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
        }
      },
      "required": [
        "kind",
        "id"
      ]
    }
  },
  "required": [
    "title",
    "taskId",
    "sourceSelectionScope"
  ]
};
