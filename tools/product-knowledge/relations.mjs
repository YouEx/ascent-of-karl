import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import ts from "typescript";

import { stableJson } from "./schema.mjs";

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
]);

const RESOLVE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".css",
  ".json",
  "/index.ts",
  "/index.tsx",
  "/index.mjs",
];

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function slug(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export function repoPath(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

export function makeNode(id, type, label, attributes = {}) {
  return { id, type, label, ...attributes };
}

export function makeEdge(
  source,
  target,
  relation,
  provenance,
  attributes = {},
) {
  return { source, target, relation, provenance, ...attributes };
}

export function edgeSignature(edge) {
  return `${edge.source}|${edge.relation}|${edge.target}|${edge.provenance}`;
}

export function addNode(nodeMap, node) {
  const existing = nodeMap.get(node.id);
  if (!existing) {
    nodeMap.set(node.id, node);
    return;
  }
  if (stableJson(existing) !== stableJson(node)) {
    throw new Error(`conflicting duplicate node ${node.id}`);
  }
}

export function addEdge(edgeMap, edge) {
  const signature = edgeSignature(edge);
  const existing = edgeMap.get(signature);
  if (!existing) {
    edgeMap.set(signature, edge);
    return;
  }
  if (stableJson(existing) !== stableJson(edge)) {
    throw new Error(`conflicting duplicate edge ${signature}`);
  }
}

function walk(directory, files) {
  if (!existsSync(directory)) return;
  for (const name of readdirSync(directory).sort()) {
    const full = path.join(directory, name);
    const stats = lstatSync(full);
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) {
      if (
        [
          "node_modules",
          "dist",
          ".git",
          ".judge",
          ".wrangler",
          "generated",
          "graphify-out",
        ].includes(name)
      ) {
        continue;
      }
      walk(full, files);
    } else if (CODE_EXTENSIONS.has(path.extname(name))) {
      files.push(full);
    }
  }
}

export function collectCodeFiles(root) {
  const files = [];
  for (const relative of ["src", "tests", "worker/src", "tools"]) {
    walk(path.join(root, relative), files);
  }
  return files.sort();
}

export function importsIn(source, fileName = "source.ts") {
  const specifiers = new Set();
  const extension = path.extname(fileName);
  const scriptKind =
    extension === ".tsx"
      ? ts.ScriptKind.TSX
      : extension === ".jsx"
        ? ts.ScriptKind.JSX
        : extension === ".js" || extension === ".mjs"
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return [...specifiers].sort();
}

function resolveRelativeImport(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(importer), specifier);
  for (const suffix of RESOLVE_EXTENSIONS) {
    const candidate = `${base}${suffix}`;
    if (!existsSync(candidate)) continue;
    const stats = lstatSync(candidate);
    if (!stats.isSymbolicLink() && stats.isFile()) return candidate;
  }
  return null;
}

export function scanImportGraph(root) {
  const files = collectCodeFiles(root);
  const edges = [];
  for (const importer of files) {
    const source = readFileSync(importer, "utf8");
    for (const specifier of importsIn(source, importer)) {
      const target = resolveRelativeImport(importer, specifier);
      if (!target) continue;
      edges.push({
        source: repoPath(root, importer),
        target: repoPath(root, target),
        specifier,
      });
    }
  }
  return { files: files.map((file) => repoPath(root, file)), edges };
}
