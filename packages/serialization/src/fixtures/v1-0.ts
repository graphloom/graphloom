// FROZEN (P10-T02 acceptance) — a permanent test loads this exact text
// through the pipeline. Never edit it; add a new fixture file for a future
// format version instead (see migrations.ts's registry comment).
export const V1_0_FIXTURE = `{
  "graphloom": "1.0",
  "generator": "@graphloom/serialization@0.0.1",
  "metadata": {
    "id": "fixture-v1",
    "name": "Migration fixture v1.0",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "modifiedAt": "2026-01-01T00:00:00.000Z"
  },
  "graph": {
    "nodes": [
      {
        "id": "alice",
        "type": "person",
        "position": { "x": 0, "y": 0 },
        "size": { "width": 120, "height": 48 },
        "rotation": 0,
        "zIndex": 0,
        "locked": false,
        "hidden": false,
        "style": "accent",
        "ports": [{ "id": "out", "side": "right", "offset": 0.5, "data": {} }],
        "data": { "label": "Alice" }
      },
      {
        "id": "bob",
        "type": "person",
        "position": { "x": 200, "y": 0 },
        "size": { "width": 120, "height": 48 },
        "rotation": 0,
        "zIndex": 0,
        "locked": false,
        "hidden": false,
        "ports": [{ "id": "in", "side": "left", "offset": 0.5, "data": {} }],
        "data": { "label": "Bob" }
      },
      {
        "id": "carol",
        "type": "person",
        "position": { "x": 400, "y": 0 },
        "size": { "width": 120, "height": 48 },
        "rotation": 0,
        "zIndex": 0,
        "locked": false,
        "hidden": false,
        "ports": [],
        "data": { "label": "Carol" }
      }
    ],
    "edges": [
      {
        "id": "alice-bob",
        "type": "default",
        "source": "alice",
        "target": "bob",
        "sourcePort": "out",
        "targetPort": "in",
        "routing": "straight",
        "labels": [{ "text": "reports to", "position": 0.5 }],
        "zIndex": 0,
        "hidden": false,
        "data": {}
      },
      {
        "id": "bob-carol",
        "type": "default",
        "source": "bob",
        "target": "carol",
        "routing": "orthogonal",
        "labels": [],
        "zIndex": 0,
        "hidden": false,
        "data": {}
      }
    ],
    "groups": [
      {
        "id": "team",
        "members": ["alice", "bob"],
        "collapsed": false,
        "label": "Leadership",
        "data": {}
      }
    ]
  },
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "extensions": {
    "theme": { "mode": "dark" }
  }
}
`;
