import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findExistingComment } from '../run-quality-gates.mjs';

test('findExistingComment: paginates until it finds the commitperclip comment', async () => {
  const seenPaths = [];
  const comment = await findExistingComment(async (path) => {
    seenPaths.push(path);
    if (path.endsWith('page=1')) {
      return Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        user: { login: 'someone-else' },
        body: 'unrelated',
      }));
    }
    if (path.endsWith('page=2')) {
      return [{
        id: 200,
        user: { login: 'commitperclip[bot]' },
        body: 'Looks good.\n\n— commitperclip',
      }];
    }
    return [];
  }, 'token', 'paperclipai/paperclip', 6469);

  assert.equal(comment.id, 200);
  assert.deepEqual(seenPaths, [
    '/repos/paperclipai/paperclip/issues/6469/comments?per_page=100&page=1',
    '/repos/paperclipai/paperclip/issues/6469/comments?per_page=100&page=2',
  ]);
});

test('findExistingComment: finds the fallback comment posted via GITHUB_TOKEN', async () => {
  // Forks without COMMITPERCLIP_KEY post as github-actions[bot]. If the upsert
  // cannot recognise that author it appends a new comment on every push.
  const comment = await findExistingComment(async () => ([
    {
      id: 42,
      user: { login: 'github-actions[bot]' },
      body: 'Hey @someone! Before this PR can be reviewed...\n\n— commitperclip',
    },
  ]), 'token', 'dosthcpp/paperclip', 13);

  assert.equal(comment.id, 42);
});

test('findExistingComment: ignores unsigned github-actions[bot] comments', async () => {
  // Widening the author set must not let the gate overwrite comments left by
  // unrelated workflows running under the same bot identity.
  const comment = await findExistingComment(async () => ([
    {
      id: 7,
      user: { login: 'github-actions[bot]' },
      body: 'Deploy preview ready: https://example.invalid/preview',
    },
  ]), 'token', 'dosthcpp/paperclip', 13);

  assert.equal(comment, null);
});

test('findExistingComment: returns null when no signed comment exists', async () => {
  const comment = await findExistingComment(async () => ([
    {
      id: 1,
      user: { login: 'commitperclip[bot]' },
      body: 'Unsigned status update',
    },
  ]), 'token', 'paperclipai/paperclip', 6469);

  assert.equal(comment, null);
});
