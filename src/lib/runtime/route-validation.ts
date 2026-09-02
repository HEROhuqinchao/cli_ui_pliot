import { getModelsForProvider, getProvider } from '@/lib/db';
import { ENV_CLAUDE_CODE_MODELS } from '@/lib/provider-catalog';
import { resolveProviderForSession } from '@/lib/provider-resolver';
import { getModelCompat, getProviderCompat } from '@/lib/runtime-compat';
import {
  listManagedVirtualProviderModelGroups,
} from '@/lib/managed-virtual-provider-models';
import { buildCodexProviderModelGroup } from '@/lib/codex/models';
import type { RuntimeRouteIdentity } from './continuation-policy';

export type RouteValidationErrorCode =
  | 'INVALID_ROUTE_PROVIDER'
  | 'INVALID_ROUTE_MODEL'
  | 'RUNTIME_ROUTE_INCOMPATIBLE'
  | 'ROUTE_CREDENTIALS_UNAVAILABLE';

export type RouteValidationResult =
  | { ok: true; route: RuntimeRouteIdentity }
  | { ok: false; code: RouteValidationErrorCode };

function modelCapabilities(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** Validate the exact Runtime+Provider+Model identity against live local facts. */
export async function validateRuntimeRoute(
  route: RuntimeRouteIdentity,
): Promise<RouteValidationResult> {
  if (!route.providerId || !route.modelId) return { ok: false, code: 'INVALID_ROUTE_MODEL' };

  if (route.providerId === 'codex_account') {
    if (route.runtimeId !== 'codex_runtime') {
      return { ok: false, code: 'RUNTIME_ROUTE_INCOMPATIBLE' };
    }
    const group = await buildCodexProviderModelGroup({ cacheOnly: true });
    return group?.models.some(model => model.value === route.modelId)
      ? { ok: true, route }
      : { ok: false, code: 'INVALID_ROUTE_MODEL' };
  }

  if (route.providerId === 'env') {
    if (route.runtimeId === 'codex_runtime') {
      return { ok: false, code: 'RUNTIME_ROUTE_INCOMPATIBLE' };
    }
    const exists = ENV_CLAUDE_CODE_MODELS.some(model =>
      model.modelId === route.modelId || model.upstreamModelId === route.modelId);
    if (!exists) return { ok: false, code: 'INVALID_ROUTE_MODEL' };
  } else {
    const virtual = listManagedVirtualProviderModelGroups()
      .find(group => group.providerId === route.providerId);
    if (virtual) {
      const model = virtual.models.find(candidate => candidate.modelId === route.modelId);
      if (!model) return { ok: false, code: 'INVALID_ROUTE_MODEL' };
      const compat = getModelCompat({
        modelId: model.modelId,
        upstreamModelId: model.upstreamModelId,
        providerCompat: virtual.compat,
        capabilities: model.capabilities,
      });
      if (!compat.supportedRuntimes?.includes(route.runtimeId)) {
        return { ok: false, code: 'RUNTIME_ROUTE_INCOMPATIBLE' };
      }
    } else {
      const provider = getProvider(route.providerId);
      if (!provider) return { ok: false, code: 'INVALID_ROUTE_PROVIDER' };
      const model = getModelsForProvider(route.providerId)
        .find(candidate => candidate.model_id === route.modelId);
      if (!model) return { ok: false, code: 'INVALID_ROUTE_MODEL' };
      const providerCompat = getProviderCompat(provider);
      const capabilities = modelCapabilities(model.capabilities_json);
      const compat = getModelCompat({
        modelId: model.model_id,
        upstreamModelId: model.upstream_model_id || undefined,
        providerCompat,
        capabilities: capabilities as Parameters<typeof getModelCompat>[0]['capabilities'],
      });
      if (!compat.supportedRuntimes?.includes(route.runtimeId)) {
        return { ok: false, code: 'RUNTIME_ROUTE_INCOMPATIBLE' };
      }
    }
  }

  const resolved = resolveProviderForSession({
    provider_id: route.providerId,
    model: route.modelId,
    requestProviderId: route.providerId,
    requestModel: route.modelId,
  }, { runtime: route.runtimeId, callScene: 'interactive_chat' });
  if (resolved.invalidReason === 'credentials-missing'
    || resolved.invalidReason === 'credentials-unreadable'
    || !resolved.hasCredentials) {
    return { ok: false, code: 'ROUTE_CREDENTIALS_UNAVAILABLE' };
  }
  if (resolved.invalidReason) return { ok: false, code: 'INVALID_ROUTE_PROVIDER' };
  return { ok: true, route };
}
