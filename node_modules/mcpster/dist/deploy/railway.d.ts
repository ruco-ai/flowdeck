import type { DeployConfig, DeployResult } from './types.js';
export interface RailwayManifest {
    '$schema': string;
    build: {
        builder: string;
    };
    deploy: {
        startCommand: string;
        healthcheckPath: string;
        restartPolicyType: string;
    };
    environments: {
        production: {
            variables: Record<string, string>;
        };
    };
}
export declare function generateManifest(config: DeployConfig): RailwayManifest;
export declare function deploy(config: DeployConfig): Promise<DeployResult>;
