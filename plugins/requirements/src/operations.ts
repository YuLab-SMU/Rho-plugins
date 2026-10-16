// Owner business contracts. Application project/authentication fields are separate.
export const operationContracts = {
  "requirements.check": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "requirements": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "package": {
                "type": "string",
                "pattern": "^[A-Za-z][A-Za-z0-9.]*$"
              },
              "source": {
                "enum": [
                  "cran",
                  "bioconductor"
                ]
              },
              "minimumVersion": {
                "type": "string",
                "pattern": "^[0-9]+([.-][0-9]+)*$"
              }
            },
            "required": [
              "package",
              "source"
            ]
          },
          "maxItems": 64,
          "uniqueItems": true
        }
      },
      "required": [
        "requirements"
      ]
    },
    "outputSchema": {
      "type": "object",
      "properties": {
        "requirements": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "package": {
                "type": "string",
                "pattern": "^[A-Za-z][A-Za-z0-9.]*$"
              },
              "source": {
                "enum": [
                  "cran",
                  "bioconductor"
                ]
              },
              "minimumVersion": {
                "type": "string",
                "pattern": "^[0-9]+([.-][0-9]+)*$"
              }
            },
            "required": [
              "package",
              "source"
            ]
          },
          "maxItems": 64,
          "uniqueItems": true
        },
        "checkedAt": {
          "type": "string",
          "minLength": 1
        },
        "environment": {
          "type": "object"
        },
        "native": {
          "type": "object"
        },
        "status": {
          "enum": [
            "present",
            "missing",
            "unknown"
          ]
        },
        "checkId": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      },
      "required": [
        "requirements",
        "checkedAt",
        "environment",
        "native",
        "status",
        "checkId"
      ],
      "additionalProperties": true
    },
    "requires": [],
    "effect": "read"
  },
  "requirements.prepare": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "operationId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
        },
        "requirements": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "package": {
                "type": "string",
                "pattern": "^[A-Za-z][A-Za-z0-9.]*$"
              },
              "source": {
                "enum": [
                  "cran",
                  "bioconductor"
                ]
              },
              "minimumVersion": {
                "type": "string",
                "pattern": "^[0-9]+([.-][0-9]+)*$"
              }
            },
            "required": [
              "package",
              "source"
            ]
          },
          "maxItems": 64,
          "uniqueItems": true
        }
      },
      "required": [
        "operationId",
        "requirements"
      ]
    },
    "outputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "operationId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
        },
        "principal": {
          "type": "string",
          "minLength": 1
        },
        "projectId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
        },
        "requestDigest": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "request": {
          "type": "object"
        },
        "action": {
          "type": "string",
          "minLength": 1
        },
        "actionVersion": {
          "type": "string",
          "minLength": 1
        },
        "acceptedAt": {
          "type": "string",
          "minLength": 1
        },
        "core": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "caller": {
              "type": "string",
              "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
            },
            "requestId": {
              "type": "string",
              "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
            }
          },
          "required": [
            "caller",
            "requestId"
          ]
        },
        "delivery": {
          "enum": [
            "not-sent",
            "sending",
            "answered",
            "not-delivered",
            "unknown"
          ]
        },
        "execution": {
          "enum": [
            "unobserved",
            "active",
            "completed",
            "failed",
            "unknown"
          ]
        },
        "native": {},
        "integrity": {
          "type": "object"
        },
        "domain": {
          "type": "object"
        },
        "interpretation": {
          "type": "object"
        },
        "plan": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "args": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "source": {
              "type": "object"
            },
            "output": {
              "type": [
                "string",
                "null"
              ]
            },
            "codeDigest": {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            },
            "completion": {
              "type": [
                "string",
                "null"
              ]
            }
          },
          "required": [
            "args",
            "source",
            "output",
            "codeDigest"
          ]
        },
        "lastCli": {
          "type": "object"
        },
        "checks": {
          "type": "object"
        },
        "cancellation": {
          "type": "object"
        }
      },
      "required": [
        "operationId",
        "principal",
        "projectId",
        "requestDigest",
        "action",
        "actionVersion",
        "acceptedAt",
        "core",
        "delivery",
        "execution",
        "native",
        "integrity",
        "domain",
        "interpretation",
        "request",
        "plan"
      ]
    },
    "requires": [],
    "effect": "native"
  }
} as const;
