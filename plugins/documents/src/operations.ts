// Owner business contracts. Application project/authentication fields are separate.
export const operationContracts = {
  "document.open": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "path"
      ]
    },
    "outputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "path": {
          "type": "string",
          "minLength": 1
        },
        "version": {
          "type": "integer",
          "minimum": 1
        },
        "content": {
          "type": "string"
        },
        "diskDigest": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "dirty": {
          "type": "boolean"
        },
        "author": {
          "type": "string",
          "minLength": 1
        },
        "acknowledgedAt": {
          "type": "string",
          "minLength": 1
        },
        "undo": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "content": {
                "type": "string"
              },
              "group": {
                "type": "string",
                "minLength": 1
              },
              "author": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "content",
              "group",
              "author"
            ]
          }
        }
      },
      "required": [
        "id",
        "path",
        "version",
        "content",
        "diskDigest",
        "dirty",
        "author",
        "acknowledgedAt",
        "undo"
      ]
    },
    "requires": [],
    "effect": "document"
  },
  "document.read": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "documentId": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      },
      "required": [
        "documentId"
      ]
    },
    "outputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "path": {
          "type": "string",
          "minLength": 1
        },
        "version": {
          "type": "integer",
          "minimum": 1
        },
        "content": {
          "type": "string"
        },
        "diskDigest": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "dirty": {
          "type": "boolean"
        },
        "author": {
          "type": "string",
          "minLength": 1
        },
        "acknowledgedAt": {
          "type": "string",
          "minLength": 1
        },
        "undo": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "content": {
                "type": "string"
              },
              "group": {
                "type": "string",
                "minLength": 1
              },
              "author": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "content",
              "group",
              "author"
            ]
          }
        }
      },
      "required": [
        "id",
        "path",
        "version",
        "content",
        "diskDigest",
        "dirty",
        "author",
        "acknowledgedAt",
        "undo"
      ]
    },
    "requires": [],
    "effect": "read"
  },
  "document.edit": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "documentId": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 1
        },
        "edits": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "from": {
                "type": "integer",
                "minimum": 0
              },
              "to": {
                "type": "integer",
                "minimum": 0
              },
              "insert": {
                "type": "string"
              }
            },
            "required": [
              "from",
              "to",
              "insert"
            ]
          },
          "minItems": 1,
          "maxItems": 1000
        },
        "undoGroup": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
        }
      },
      "required": [
        "documentId",
        "expectedVersion",
        "edits",
        "undoGroup"
      ]
    },
    "outputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "path": {
          "type": "string",
          "minLength": 1
        },
        "version": {
          "type": "integer",
          "minimum": 1
        },
        "content": {
          "type": "string"
        },
        "diskDigest": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "dirty": {
          "type": "boolean"
        },
        "author": {
          "type": "string",
          "minLength": 1
        },
        "acknowledgedAt": {
          "type": "string",
          "minLength": 1
        },
        "undo": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "content": {
                "type": "string"
              },
              "group": {
                "type": "string",
                "minLength": 1
              },
              "author": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "content",
              "group",
              "author"
            ]
          }
        }
      },
      "required": [
        "id",
        "path",
        "version",
        "content",
        "diskDigest",
        "dirty",
        "author",
        "acknowledgedAt",
        "undo"
      ]
    },
    "requires": [],
    "effect": "document"
  },
  "document.undo": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "documentId": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 1
        }
      },
      "required": [
        "documentId",
        "expectedVersion"
      ]
    },
    "outputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "path": {
          "type": "string",
          "minLength": 1
        },
        "version": {
          "type": "integer",
          "minimum": 1
        },
        "content": {
          "type": "string"
        },
        "diskDigest": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "dirty": {
          "type": "boolean"
        },
        "author": {
          "type": "string",
          "minLength": 1
        },
        "acknowledgedAt": {
          "type": "string",
          "minLength": 1
        },
        "undo": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "content": {
                "type": "string"
              },
              "group": {
                "type": "string",
                "minLength": 1
              },
              "author": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "content",
              "group",
              "author"
            ]
          }
        }
      },
      "required": [
        "id",
        "path",
        "version",
        "content",
        "diskDigest",
        "dirty",
        "author",
        "acknowledgedAt",
        "undo"
      ]
    },
    "requires": [],
    "effect": "document"
  },
  "document.save": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "documentId": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 1
        },
        "expectedDiskDigest": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "documentId",
        "expectedVersion",
        "expectedDiskDigest"
      ]
    },
    "outputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "path": {
          "type": "string",
          "minLength": 1
        },
        "version": {
          "type": "integer",
          "minimum": 1
        },
        "content": {
          "type": "string"
        },
        "diskDigest": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "dirty": {
          "type": "boolean"
        },
        "author": {
          "type": "string",
          "minLength": 1
        },
        "acknowledgedAt": {
          "type": "string",
          "minLength": 1
        },
        "undo": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "content": {
                "type": "string"
              },
              "group": {
                "type": "string",
                "minLength": 1
              },
              "author": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "content",
              "group",
              "author"
            ]
          }
        }
      },
      "required": [
        "id",
        "path",
        "version",
        "content",
        "diskDigest",
        "dirty",
        "author",
        "acknowledgedAt",
        "undo"
      ]
    },
    "requires": [],
    "effect": "document"
  }
} as const;
