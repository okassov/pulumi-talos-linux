import * as pulumi from "@pulumi/pulumi";
import * as talos from "@pulumiverse/talos";

/**
 * Version 0.2.0
 *  - New type `PerNodePatches`.
 *  - Added optional `perNodePatches` to Master/Worker args.
 *  - `ConfigurationApply` now merges common patches with node‑specific ones.
 */

export interface ConfigTalosArgs {}

/* ---------------------------------------------------------------- */
/* Shared structures                                                */
/* ---------------------------------------------------------------- */

export interface SharedTalosArgs {
    clusterName: string;
    clusterEndpoint: string;
    boostrapTimeout?: string;
};

export interface CustomGetConfigurationOutputArgs 
    extends Omit<
        talos.machine.GetConfigurationOutputArgs, 
        'clusterName' | 'clusterEndpoint' | 'machineSecrets' | 'machineType'
    > {
    baseTemplate: string[];
    patches: string[];
}

/* ---------------------------------------------------------------- */
/* map «node id → patches». Key is IP or hostname string.           */
/* ---------------------------------------------------------------- */

export type PerNodePatches = Record<string, string[]>;

/* ---------------------------------------------------------------- */
/* Master / Worker args                                             */
/* ---------------------------------------------------------------- */

export interface MasterTalosArgs {
    config: CustomGetConfigurationOutputArgs;
    nodes: pulumi.Input<string>[];
    perNodePatches?: PerNodePatches;
};

export interface WorkerTalosArgs {
    config: CustomGetConfigurationOutputArgs;
    nodes: pulumi.Input<string>[];
    perNodePatches?: PerNodePatches;
};

export interface BaseTalosArgs {
    sharedConfig: SharedTalosArgs;
    master: MasterTalosArgs;
    worker?: WorkerTalosArgs;
};

/* ---------------------------------------------------------------- */
/* Component                                                        */
/* ---------------------------------------------------------------- */

export class Talos extends pulumi.ComponentResource {
    /* outputs */
    secrets: talos.machine.Secrets;
    clientConfiguration: pulumi.Output<talos.client.GetConfigurationResult>;

    masterNodes: pulumi.Input<string>[];

    masterConfigurationApplyResources: talos.machine.ConfigurationApply[] = [];
    workerConfigurationApplyResources: talos.machine.ConfigurationApply[] = [];

    constructor(
        name: string, 
        args: BaseTalosArgs, 
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("okassov:talos", name, {}, opts);

        /* secrets + client cfg */
        this.secrets = new talos.machine.Secrets(`secrets`, {}, { parent: this });

        this.clientConfiguration = talos.client.getConfigurationOutput(
            {
                clusterName: args.sharedConfig.clusterName,
                clientConfiguration: this.secrets.clientConfiguration,
                endpoints: args.master.nodes
            },
            { parent: this }
        );

        this.masterNodes = args.master.nodes

        /* -------- common control‑plane configuration -------------- */
        const masterConfig = this.getConfigOutput(
            {
                ...args.sharedConfig, 
                ...args.master.config, 
                configPatches: args.master.config.baseTemplate,
                machineSecrets: this.secrets.machineSecrets,
                machineType: "controlplane",
                docs: false,
                examples: false
            }, 
            opts?.provider
        );

        /* -------- per‑master apply -------------------------------- */
        args.master.nodes.forEach((node) => {
            const nodeKey = node as unknown as string; // assume static string
            const nodeSpecific =
                args.master.perNodePatches?.[nodeKey] ?? [];

            const configPatches = [
                ...args.master.config.patches,
                ...nodeSpecific,
            ];

            const masterConfigApply = new talos.machine.ConfigurationApply(
                `configApplyMaster-${nodeKey}`,
                {
                    clientConfiguration: this.secrets.clientConfiguration,
                    machineConfigurationInput: masterConfig.machineConfiguration,
                    node: node,
                    configPatches: configPatches,
                },
                { parent: this }
            );
            this.masterConfigurationApplyResources.push(masterConfigApply);
        });

        /* -------- workers ---------------------------------------- */
        if (args.worker) {
            const workerConfig = this.getConfigOutput(
                {
                    ...args.sharedConfig, 
                    ...args.master.config,
                    configPatches: args.worker.config.baseTemplate,
                    machineSecrets: this.secrets.machineSecrets,
                    machineType: "worker",
                    docs: false,
                    examples: false
                }, 
                opts?.provider
            );

            args.worker.nodes.forEach((node) => {
                const nodeKey = node as unknown as string;
                const nodeSpecific =
                    args.worker?.perNodePatches?.[nodeKey] ?? [];

                const configPatches = [
                    ...args.worker!.config.patches,
                    ...nodeSpecific,
                ];

                const workerConfigApply = new talos.machine.ConfigurationApply(
                    `configApplyWorker-${nodeKey}`,
                    {
                        clientConfiguration: this.secrets.clientConfiguration,
                        machineConfigurationInput: workerConfig.machineConfiguration,
                        node: node,
                        configPatches: configPatches,
                    },
                    { parent: this }
                );
                this.workerConfigurationApplyResources.push(workerConfigApply);
            });
        }

        /* -------- bootstrap -------------------------------------- */
        new talos.machine.Bootstrap(
            `bootstrap`, 
            {
                node: args.master.nodes[0],
                endpoint: args.master.nodes[0],
                clientConfiguration: this.secrets.clientConfiguration,
                timeouts: {
                    create: args.sharedConfig.boostrapTimeout
                }
            }, 
            { dependsOn: this.masterConfigurationApplyResources , parent: this }
        );
    }

    /* helper: wrap getConfigurationOutput */
    private getConfigOutput(
        args: talos.machine.GetConfigurationOutputArgs,
        provider: pulumi.ProviderResource | undefined
    ): pulumi.Output<talos.machine.GetConfigurationResult> {
        return talos.machine.getConfigurationOutput(args, {
            parent: this,
            provider: provider,
        });
    }

    /* outputs */
    public talosconfig(): pulumi.Output<string> {
        return this.clientConfiguration.talosConfig;
    };

    public kubeconfig(): pulumi.Output<talos.cluster.GetKubeconfigResult>{
        return talos.cluster.getKubeconfigOutput(
            {
                clientConfiguration: this.secrets.clientConfiguration,
                node: this.masterNodes[0]
            }, 
            { parent: this }
        );
    };
}
