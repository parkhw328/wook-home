// Only public model identifiers and advertised reasoning levels cross the bridge.
export const modelId = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value);
export const effortId = (value) => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,23}$/.test(value);

export function readExecutionOptions(value, connected, now = Date.now()) {
  const age = now - Date.parse(value?.updatedAt);
  const ready = connected && value?.status === 'ready' && age >= -5000 && age <= 90000;
  const models = [];
  if (ready && Array.isArray(value.models)) {
    for (const model of value.models.slice(0, 30)) {
      if (!modelId(model?.id) || models.some((item) => item.id === model.id)) continue;
      const reasoningEfforts = [...new Set((Array.isArray(model.reasoningEfforts) ? model.reasoningEfforts : []).filter(effortId))].slice(0, 12);
      if (!reasoningEfforts.length || !reasoningEfforts.includes(model.defaultReasoningEffort)) continue;
      models.push({ id: model.id, name: typeof model.name === 'string' && model.name.length <= 80 && !/[\x00-\x1f]/.test(model.name) ? model.name : model.id,
        reasoningEfforts, defaultReasoningEffort: model.defaultReasoningEffort, isDefault: model.isDefault === true });
    }
  }
  return { status: models.length ? 'ready' : value?.status === 'disabled' ? 'disabled' : 'unavailable',
    updatedAt: ready ? new Date(value.updatedAt).toISOString() : null, models };
}

export function supportsExecutionOptions(catalog, selection) {
  return catalog?.status === 'ready' && catalog.models.some((model) => model.id === selection.model && model.reasoningEfforts.includes(selection.reasoningEffort));
}
