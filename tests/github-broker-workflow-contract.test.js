import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const brokerWorkflow = await readFile(".github/workflows/yardhub-github-broker.yml", "utf8");
const identityWorkflow = await readFile(".github/workflows/yardhub-github-identity-admin.yml", "utf8");
const inboxTemplate = await readFile("docs/templates/yardhub-private-broker.workflow.yml", "utf8");
const identityTemplate = await readFile("docs/GITHUB_NATIVE_IDENTITY_ADMIN_WORKFLOW_TEMPLATE.yml", "utf8");

test("broker reusable workflow is workflow_call-only and accepts only encrypted new issue comments", () => {
  assert.match(brokerWorkflow, /on:\s*\n\s+workflow_call:/);
  assert.doesNotMatch(brokerWorkflow, /\n\s+issue_comment:/);
  assert.match(brokerWorkflow, /github\.event_name == 'issue_comment'/);
  assert.match(brokerWorkflow, /github\.event\.action == 'created'/);
  assert.match(brokerWorkflow, /startsWith\(github\.event\.comment\.body, 'YARDHUB_REQUEST_V1:'\)/);
  assert.match(brokerWorkflow, /contents: read/);
  assert.match(brokerWorkflow, /issues: write/);
  assert.match(brokerWorkflow, /cancel-in-progress: false/);
  assert.match(brokerWorkflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(brokerWorkflow, /YARDHUB_BROKER_ECDH_PRIVATE_KEY:/);
  assert.match(brokerWorkflow, /YARDHUB_DATA_APP_PRIVATE_KEY:/);
  assert.match(brokerWorkflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(brokerWorkflow, /contents: write/);
});

test("identity administration reusable workflow is workflow_call-only and read-only on the broker repository", () => {
  assert.match(identityWorkflow, /on:\s*\n\s+workflow_call:/);
  assert.doesNotMatch(identityWorkflow, /\n\s+workflow_dispatch:/);
  assert.match(identityWorkflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(identityWorkflow, /contents: read/);
  assert.match(identityWorkflow, /issues: read/);
  assert.doesNotMatch(identityWorkflow, /issues: write/);
  assert.match(identityWorkflow, /node scripts\/manage-github-broker-identity\.mjs/);
  assert.match(identityWorkflow, /YARDHUB_DATA_APP_PRIVATE_KEY:/);
});

test("private broker caller templates keep event triggers and secret bindings outside the public source repository", () => {
  assert.match(inboxTemplate, /issue_comment:/);
  assert.match(inboxTemplate, /types: \[created\]/);
  assert.match(inboxTemplate, /YARDHUB_DATA_APP_PRIVATE_KEY/);
  assert.match(inboxTemplate, /YARDHUB_BROKER_ECDH_PRIVATE_KEY/);
  assert.match(inboxTemplate, /broker_repository_id: \$\{\{ github\.repository_id \}\}/);
  assert.match(identityTemplate, /workflow_dispatch:/);
  assert.match(identityTemplate, /options: \[link, revoke\]/);
  assert.match(identityTemplate, /YARDHUB_DATA_APP_PRIVATE_KEY/);
  assert.match(identityTemplate, /<PRIVATE_BROKER_REPOSITORY_NUMERIC_ID>/);
});
