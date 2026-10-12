import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
export {
  createApiMetrics,
  createWorkerMetrics,
  startMetricsServer,
  stopMetricsServer,
  type ApiDependencyState,
  type ApiMetrics,
  type DocumentGenerationSource,
  type WorkerMetrics,
  type WorkerSchedulerState,
} from './metrics';

export async function startTelemetry(
  serviceName: string,
  endpoint?: string,
): Promise<() => Promise<void>> {
  if (!endpoint) return async () => {};

  const exporter = new OTLPTraceExporter({ url: new URL('/v1/traces', endpoint).toString() });
  const sdk = new NodeSDK({
    serviceName,
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });
  await sdk.start();
  return () => sdk.shutdown();
}
