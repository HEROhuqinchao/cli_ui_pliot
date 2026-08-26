#!/usr/bin/env node

import fs from 'node:fs';

const [mainPath, tagPath] = process.argv.slice(2);
if (!mainPath || !tagPath) {
  throw new Error('Usage: node scripts/verify-github-update-rulesets.mjs <main-ruleset.json> <tag-ruleset.json>');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function verifyRuleset(ruleset, expected) {
  if (!ruleset || typeof ruleset !== 'object') throw new Error(`${expected.label} ruleset is not an object`);
  if (ruleset.target !== expected.target) {
    throw new Error(`${expected.label} ruleset target ${ruleset.target} != ${expected.target}`);
  }
  if (ruleset.enforcement !== 'active') {
    throw new Error(`${expected.label} ruleset must be active, found ${ruleset.enforcement}`);
  }
  const includes = ruleset.conditions?.ref_name?.include;
  if (!Array.isArray(includes) || !expected.refPatterns.some((pattern) => includes.includes(pattern))) {
    throw new Error(`${expected.label} ruleset does not include ${expected.refPatterns.join(' or ')}`);
  }
  const excludes = ruleset.conditions?.ref_name?.exclude;
  if (!Array.isArray(excludes)) {
    throw new Error(`${expected.label} ruleset response does not expose excluded refs`);
  }
  if (excludes.length > 0) {
    throw new Error(`${expected.label} ruleset must not exclude protected refs`);
  }
  const ruleTypes = new Set(Array.isArray(ruleset.rules) ? ruleset.rules.map((rule) => rule?.type) : []);
  for (const required of expected.requiredRules) {
    if (!ruleTypes.has(required)) throw new Error(`${expected.label} ruleset is missing ${required}`);
  }
  if (!Array.isArray(ruleset.bypass_actors)) {
    throw new Error(`${expected.label} ruleset response does not expose bypass actors`);
  }
  if (ruleset.bypass_actors.length > 0) {
    throw new Error(`${expected.label} ruleset must not define bypass actors`);
  }
}

verifyRuleset(readJson(mainPath), {
  label: 'default branch',
  target: 'branch',
  refPatterns: ['~DEFAULT_BRANCH', 'refs/heads/main'],
  requiredRules: ['deletion', 'non_fast_forward'],
});
verifyRuleset(readJson(tagPath), {
  label: 'stable release tag',
  target: 'tag',
  refPatterns: ['refs/tags/v*'],
  requiredRules: ['deletion', 'update'],
});

console.log('GitHub unsigned-updater rulesets OK: default branch blocks deletion/force-push and v* tags block update/deletion');
