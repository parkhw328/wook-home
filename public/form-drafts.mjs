export function formValues(form) {
  return Object.fromEntries([...form.elements].filter((field) => field.name).map((field) => [field.name, field.value]));
}

export function sameDraft(left, right) {
  return Boolean(left && right) && Object.keys(left).length === Object.keys(right).length
    && Object.keys(left).every((name) => Object.hasOwn(right, name) && left[name] === right[name]);
}

// A response acknowledges the submitted values, not a newer draft for the
// same employee. Advance only that request's revision; later external changes
// will still be rejected by the server's optimistic concurrency check.
export function settleDraft(drafts, key, submitted, savedRevision) {
  const current = drafts.get(key);
  if (sameDraft(current, submitted)) { drafts.delete(key); return; }
  if (current && Object.hasOwn(submitted, 'settingsRevision') && Number.isSafeInteger(savedRevision) && current.settingsRevision === submitted.settingsRevision) {
    drafts.set(key, { ...current, settingsRevision: String(savedRevision) });
  }
}
