import { OpenClawPluginApi } from 'openclaw/plugin-sdk';

type RoutingMode = 'project_agent_hybrid';
type HippocampusPluginConfig = {
    apiKey?: string;
    baseUrl: string;
    autoRecall: boolean;
    autoCapture: boolean;
    maxRecallResults: number;
    profileFrequency: number;
    routingMode: RoutingMode;
    sharedBankNameTemplate: string;
    agentBankNameTemplate: string;
    readjustEnabled: boolean;
    readjustConfidenceThreshold: number;
    debug: boolean;
    recallTimeoutMs: number;
    rememberTimeoutMs: number;
    requestRetryAttempts: number;
};

declare function parseConfig(raw: unknown): HippocampusPluginConfig;

declare const _default: {
    id: string;
    name: string;
    description: string;
    kind: "memory";
    configSchema: {
        jsonSchema: {
            type: string;
            additionalProperties: boolean;
            properties: {
                apiKey: {
                    type: string;
                };
                baseUrl: {
                    type: string;
                };
                autoRecall: {
                    type: string;
                };
                autoCapture: {
                    type: string;
                };
                maxRecallResults: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                profileFrequency: {
                    type: string;
                    minimum: number;
                };
                routingMode: {
                    type: string;
                    enum: string[];
                };
                sharedBankNameTemplate: {
                    type: string;
                };
                agentBankNameTemplate: {
                    type: string;
                };
                readjustEnabled: {
                    type: string;
                };
                readjustConfidenceThreshold: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                debug: {
                    type: string;
                };
                recallTimeoutMs: {
                    type: string;
                    minimum: number;
                };
                rememberTimeoutMs: {
                    type: string;
                    minimum: number;
                };
                requestRetryAttempts: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
            };
            required: never[];
        };
        parse: typeof parseConfig;
    };
    register(api: OpenClawPluginApi): void;
};

export { _default as default };
