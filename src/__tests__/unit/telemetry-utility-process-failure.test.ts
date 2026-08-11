import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeTelemetryEvent } from '../../lib/telemetry/sanitize';
import { buildUtilityProcessFailureEvent } from '../../lib/telemetry/utility-process-failure';

describe('utility process failure telemetry', () => {
  it('builds a stable fatal product-fault bucket with numeric observations only', () => {
    const event = buildUtilityProcessFailureEvent({
      reason: 'utility_fatal_error',
      exitCode: 5,
      utilityRssBytes: 170_000_000,
      utilityHeapUsedBytes: 9_000_000,
      hostAvailableKb: 1_000_000,
    });

    assert.equal(event.message, 'server.utility_process_failed');
    assert.equal(event.level, 'fatal');
    assert.deepEqual(event.tags, {
      'error.category': 'UTILITY_PROCESS_FATAL_ERROR',
      'error.outcome': 'product_fault',
      'grouping.strategy': 'normalized',
      'runtime.id': 'packaged_server',
    });
    assert.deepEqual(event.extra, {
      lifecycleReason: 'utility_fatal_error',
      exitCode: 5,
      utilityRssBytes: 170_000_000,
      utilityHeapUsedBytes: 9_000_000,
      hostAvailableKb: 1_000_000,
    });
    assert.deepEqual(event.fingerprint, [
      'normalized-v1',
      'utility_process_fatal_error',
      'electron_main',
      'packaged_server',
      'unknown',
      'unknown',
      'none',
    ]);
  });

  it('normalizes arbitrary exit reasons and drops invalid numeric values', () => {
    const event = buildUtilityProcessFailureEvent({
      reason: 'server_exit_-1 /Users/private --token=secret',
      exitCode: -1,
      utilityRssBytes: Number.NaN,
      utilityHeapUsedBytes: Number.POSITIVE_INFINITY,
      hostFreeKb: 0,
    });

    assert.equal(event.tags['error.category'], 'UTILITY_PROCESS_UNEXPECTED_EXIT');
    assert.deepEqual(event.extra, {
      lifecycleReason: 'unexpected_exit',
      hostFreeKb: 0,
    });
  });

  it('survives the default-deny sanitizer without admitting arbitrary extras', () => {
    const built = buildUtilityProcessFailureEvent({
      reason: 'utility_error',
      exitCode: 9,
      utilityHeapLimitBytes: 500_000_000,
      hostSwapFreeKb: 42,
    });
    const sanitized = sanitizeTelemetryEvent({
      ...built,
      extra: {
        ...built.extra,
        diagnosticReport: 'argv=/Users/private token=secret',
      },
    }, {
      layer: 'electron_main',
      channel: 'stable',
      platform: 'darwin',
      arch: 'arm64',
    });

    assert.deepEqual(sanitized.extra, {
      lifecycleReason: 'utility_error',
      exitCode: 9,
      utilityHeapLimitBytes: 500_000_000,
      hostSwapFreeKb: 42,
    });
    assert.deepEqual(sanitized.fingerprint, built.fingerprint);
    assert.equal(JSON.stringify(sanitized).includes('diagnosticReport'), false);
    assert.equal(JSON.stringify(sanitized).includes('/Users/private'), false);
  });
});
