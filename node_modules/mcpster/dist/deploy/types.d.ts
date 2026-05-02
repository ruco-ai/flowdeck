export type DeployTarget = 'railway' | 'fly' | 'cloudflare';
export interface DeployConfig {
    name: string;
    version: string;
    port?: number;
    region?: string;
    memory?: string;
    cpu?: string;
}
export interface DeployResult {
    url: string;
    target: DeployTarget;
    manifest: unknown;
}
export interface DeployAdapter {
    generateManifest(config: DeployConfig): unknown;
    deploy(config: DeployConfig): Promise<DeployResult>;
}
