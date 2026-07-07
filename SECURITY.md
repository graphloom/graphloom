# Security Policy

## Supported versions

GraphLoom is pre-alpha; no versions are supported for production use yet.
From `1.0.0` onward, the latest minor of the most recent major will receive
security fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately via one of:

- GitHub private vulnerability reporting on the affected repository
  (Security → Report a vulnerability), or
- Email: **bhanutej.pothireddy@gmail.com** with subject `[SECURITY] GraphLoom`.

Include: affected package(s) and version, a description, reproduction steps or
proof of concept, and impact assessment if you have one.

You can expect an acknowledgment within 72 hours and a status update within
7 days. Please allow a reasonable disclosure window for a fix before
publishing details.

## Scope notes

- GraphLoom renders user-supplied documents (node labels, arbitrary JSON
  properties, imported SQL/DBML/etc.). Injection via document content —
  e.g. script execution through labels, SVG export payloads, or malicious
  import files — is squarely in scope and treated as high severity.
- Supply-chain integrity: releases are published from CI with npm provenance.
  Report any published artifact that does not match its source.
