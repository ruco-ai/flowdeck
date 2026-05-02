import type { DeployConfig, DeployResult } from './types.js';
export interface FlyManifest {
    app: string;
    primary_region: string;
    [services: string]: unknown;
}
export interface FlyDockerfile {
    content: string;
}
export declare function generateManifest(config: DeployConfig): FlyManifest;
export declare function generateDockerfile(): string;
export declare function deploy(config: DeployConfig): Promise<DeployResult>;
