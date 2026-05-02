import type { DeployConfig, DeployResult } from './types.js';
export interface CloudflareManifest {
    name: string;
    main: string;
    compatibility_date: string;
    vars: Record<string, string>;
}
export declare function generateManifest(config: DeployConfig): CloudflareManifest;
export declare function generateWorkerShim(config: DeployConfig): string;
export declare function manifestToToml(manifest: CloudflareManifest): string;
export declare function deploy(config: DeployConfig): Promise<DeployResult>;
