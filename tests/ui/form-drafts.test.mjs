import test from 'node:test';
import assert from 'node:assert/strict';
import { sameDraft, settleDraft } from '../../public/form-drafts.mjs';

test('late save only clears the submitted draft, preserving a newer draft and other employees', () => {
  const submitted = { name: '직원', projectName: 'C', settingsRevision: '0' };
  const newer = { ...submitted, projectName: 'D' };
  const drafts = new Map([['edit:one', newer], ['edit:two', { projectName: '다른 직원' }]]);
  settleDraft(drafts, 'edit:one', submitted, 1);
  assert.deepEqual(drafts.get('edit:one'), { ...newer, settingsRevision: '1' });
  assert.deepEqual(drafts.get('edit:two'), { projectName: '다른 직원' });
  settleDraft(drafts, 'edit:one', submitted, 1);
  assert.equal(drafts.get('edit:one').projectName, 'D');
});

test('an unchanged saved draft is removed, but an independently refreshed revision is never rolled back', () => {
  const submitted = { projectName: 'C', settingsRevision: '0' };
  const drafts = new Map([['edit', { ...submitted }]]);
  settleDraft(drafts, 'edit', submitted, 1);
  assert.equal(drafts.has('edit'), false);
  drafts.set('edit', { projectName: 'new', settingsRevision: '5' });
  settleDraft(drafts, 'edit', submitted, 1);
  assert.deepEqual(drafts.get('edit'), { projectName: 'new', settingsRevision: '5' });
  assert.equal(sameDraft(submitted, { settingsRevision: '0', projectName: 'C' }), true);
  assert.equal(sameDraft(submitted, { ...submitted, extra: 'new field' }), false);
  const hires = new Map([['hire', { name: '새 초안' }]]);
  settleDraft(hires, 'hire', { name: '접수된 이름' }, 0);
  assert.deepEqual(hires.get('hire'), { name: '새 초안' });
});
