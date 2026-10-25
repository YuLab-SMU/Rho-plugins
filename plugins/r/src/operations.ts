// Owner business contracts. Application project/authentication fields are separate.
export const operationContracts = {
  "object.read": {
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
        }
      },
      "required": [
        "resource"
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
        "observation": {
          "const": "exported-snapshot"
        },
        "value": {}
      },
      "required": [
        "resource",
        "observation",
        "value"
      ],
      "additionalProperties": true
    },
    "requires": [
      "files"
    ],
    "effect": "read"
  },
  "action.submit": {
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "operationId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
        },
        "action": {
          "const": "r.execute"
        },
        "actionVersion": {
          "const": "0.2.0"
        },
        "repairOf": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:@-]{1,128}$"
        },
        "input": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "script": {
              "oneOf": [
                {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "kind": {
                      "const": "disk"
                    },
                    "path": {
                      "type": "string",
                      "minLength": 1
                    },
                    "digest": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{64}$"
                    }
                  },
                  "required": [
                    "kind",
                    "path",
                    "digest"
                  ]
                },
                {
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
                    }
                  },
                  "required": [
                    "kind",
                    "documentId",
                    "version"
                  ]
                }
              ]
            },
            "args": {
              "type": "array",
              "maxItems": 64,
              "items": {
                "oneOf": [
                  {
                    "type": "string",
                    "maxLength": 4096
                  },
                  {
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
                      }
                    },
                    "required": [
                      "resource"
                    ]
                  }
                ]
              }
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
            },
            "artifacts": {
              "type": "array",
              "items": {
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
              "maxItems": 128
            },
            "completion": {
              "anyOf": [
                {
                  "type": "string",
                  "minLength": 1
                },
                {
                  "type": "null"
                }
              ]
            }
          },
          "required": [
            "script",
            "args",
            "requirements",
            "artifacts",
            "completion"
          ]
        }
      },
      "required": [
        "operationId",
        "action",
        "actionVersion",
        "input"
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
        },
        "repairOf": {
          "type": "string",
          "minLength": 1
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
    "requires": [
      "files",
      "requirements"
    ],
    "effect": "native"
  }
} as const;
