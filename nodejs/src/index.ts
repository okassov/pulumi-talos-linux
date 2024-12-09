import * as pulumi from "@pulumi/pulumi";
import * as talos from "@pulumiverse/talos";


export interface ConfigTalosArgs {}

export interface SharedTalosArgs {
    clusterName: string;
    clusterEndpoint: string;
};

export interface CustomGetConfigurationOutputArgs extends Omit<talos.machine.GetConfigurationOutputArgs, 'clusterName' | 'clusterEndpoint' | 'machineSecrets' | 'machineType'> {
    baseTemplate: string[];
    patches: string[];
}

export interface MasterTalosArgs {
    config: CustomGetConfigurationOutputArgs;
    nodes: pulumi.Input<string>[];
};

export interface WorkerTalosArgs {
    config: CustomGetConfigurationOutputArgs;
    nodes: pulumi.Input<string>[];
};

export interface BaseTalosArgs {
    sharedConfig: SharedTalosArgs;
    master: MasterTalosArgs;
    worker?: WorkerTalosArgs;
};

export class Talos extends pulumi.ComponentResource {

    secrets: talos.machine.Secrets;
    clientConfiguration: pulumi.Output<talos.client.GetConfigurationResult>;

    masterNodes: pulumi.Input<string>[];

    masterConfigurationApplyResources: talos.machine.ConfigurationApply[] = [];
    workerConfigurationApplyResources: talos.machine.ConfigurationApply[] = [];

    constructor(name: string, args: BaseTalosArgs, opts?: pulumi.ComponentResourceOptions) {
        super("okassov:talos", name, {}, opts);

        this.secrets = new talos.machine.Secrets(`secrets`, {}, { parent: this });

        // this.clientConfiguration = this.secrets.clientConfiguration.caCertificate.apply(caCert => {
        //     return this.secrets.clientConfiguration.clientCertificate.apply(clientCert => {
        //         return this.secrets.clientConfiguration.clientKey.apply(clientKey => {
        //             return talos.client.getConfiguration({
        //                 clusterName: args.sharedConfig.clusterName,
        //                 clientConfiguration: {
        //                     caCertificate: caCert,
        //                     clientCertificate: clientCert,
        //                     clientKey: clientKey,
        //                 },
        //                 endpoints: args.master.nodes,
        //             }, { parent: this });
        //         });
        //     });
        // });

        this.clientConfiguration = pulumi.all([
            this.secrets.clientConfiguration.caCertificate,
            this.secrets.clientConfiguration.clientCertificate,
            this.secrets.clientConfiguration.clientKey,
            args.master.nodes
        ]).apply(([caCert, clientCert, clientKey, nodes]) => {
            return talos.client.getConfiguration({
                clusterName: args.sharedConfig.clusterName,
                clientConfiguration: {
                    caCertificate: caCert,
                    clientCertificate: clientCert,
                    clientKey: clientKey,
                },
                endpoints: nodes,
            }, { parent: this });
        });

        this.masterNodes = args.master.nodes

        const masterConfig = this.getConfigOutput(
            {
                ...args.sharedConfig, 
                ...args.master.config, 
                machineSecrets: this.secrets.machineSecrets,
                machineType: "controlplane",
                docs: false,
                examples: false
            }, 
            opts?.provider
        );

        args.master.nodes.forEach((node, nodeCounter) => {

            const masterConfigApply = new talos.machine.ConfigurationApply(`configApplyMaster-${nodeCounter}`, {
                clientConfiguration: this.secrets.clientConfiguration,
                machineConfigurationInput: masterConfig.machineConfiguration,
                node: node,
                configPatches: args.master.config.configPatches
            }, { parent: this });
            this.masterConfigurationApplyResources.push(masterConfigApply);
        });

        if (args.worker) {
            const workerConfig = this.getConfigOutput(
                {
                    ...args.sharedConfig, 
                    ...args.master.config,
                    machineSecrets: this.secrets.machineSecrets,
                    machineType: "worker",
                    docs: false,
                    examples: false
                }, 
                opts?.provider
            );

            args.worker.nodes.forEach((node, nodeCounter) => {
                const workerConfigApply = new talos.machine.ConfigurationApply(`configApplyWorker-${nodeCounter}`, {
                    clientConfiguration: this.secrets.clientConfiguration,
                    machineConfigurationInput: workerConfig.machineConfiguration,
                    node: node,
                    configPatches: args.master.config.configPatches
                }, { parent: this })
                this.workerConfigurationApplyResources.push(workerConfigApply);
            });
        }

        new talos.machine.Bootstrap(`bootstrap`, {
            node: args.master.nodes[0],
            clientConfiguration: this.secrets.clientConfiguration,
        }, { dependsOn: this.masterConfigurationApplyResources , parent: this });

    }

    /**
     * 
     * @param args
     * @param provider 
     * @returns 
     */
    private getConfigOutput(args: talos.machine.GetConfigurationOutputArgs,
        provider: pulumi.ProviderResource | undefined): pulumi.Output<talos.machine.GetConfigurationResult> {
        
        return talos.machine.getConfigurationOutput(args, { parent: this });
    };


    /**
     * Outputs
     */
    public talosconfig(): pulumi.Output<string> {
        return this.clientConfiguration.talosConfig;
    };

    public kubeconfig(): pulumi.Output<talos.cluster.GetKubeconfigResult>{
        return talos.cluster.getKubeconfigOutput({
            clientConfiguration: this.secrets.clientConfiguration,
            node: this.masterNodes[0]}, { parent: this });
    };
}