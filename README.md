# Talos Linux Module for Pulumi

[![npm version](https://badge.fury.io/js/%40okassov%2Fpulumi-talos-linux.svg)](https://www.npmjs.com/package/@okassov/pulumi-talos-linux)
[![License: MPL-2.0](https://img.shields.io/badge/License-MPL%202.0-brightgreen.svg)](https://mozilla.org/MPL/2.0/)
[![Pulumi Registry](https://img.shields.io/badge/Pulumi-Registry-blueviolet.svg)](https://www.pulumi.com/registry/packages/talos/)

This project provides Pulumi components for provisioning Talos Linux using TypeScript. It offers higher-level constructs on top of the Pulumi Talos provider, enabling you to easily create and manage:
  - [Secrets](https://www.pulumi.com/registry/packages/talos/api-docs/machine/secrets/)
  - [ConfigurationApply](https://www.pulumi.com/registry/packages/talos/api-docs/machine/configurationapply/)
  - [Boostrap](https://www.pulumi.com/registry/packages/talos/api-docs/machine/bootstrap/)

A [CHANGELOG][changelog] is maintained for this project.

## Installation

### Node.js (NPM/Yarn)

Install the package via npm:

```sh
$ npm install --save '@okassov/pulumi-talos-linux'
```

Install the package via yarn:

```sh
yarn add @okassov/pulumi-talos-linux
```

## Requirements

- Node.js >= 14.x
- Pulumi >= 3.x

## Usage

How to use

```js
import * as pulumi from "@pulumi/pulumi";
import * as talos from "@okassov/pulumi-talos-linux";
```

Example that creates an Talos Linux:

```js
import * as pulumi from "@pulumi/pulumi";
import * as talos from "@okassov/pulumi-talos-linux";

const baseVars        = { env: "test", project: "example", app: "talos" }
const resourceName    = `${baseVars.env}-${baseVars.project}-${baseVars.app}`

const clusterName     = resourceName
const controlPlaneVip = "10.0.0.10"
const clusterEndpoint = `https://${controlPlaneVip}:6443`

const masterNodes = [
    { name: `${resourceName}-master-01`, ip: "10.0.0.11" },
    { name: `${resourceName}-master-02`, ip: "10.0.0.12" },
    { name: `${resourceName}-master-03`, ip: "10.0.0.13" },
];

const workerNodes = [
    { name: `${resourceName}-node-01`, ip: "10.0.0.14" },
    { name: `${resourceName}-node-02`, ip: "10.0.0.15" },
    { name: `${resourceName}-node-03`, ip: "10.0.0.16" },
];

const talosDefaultTemplate = `
machine:
  certSANs: []
  kubelet:
    defaultRuntimeSeccompProfileEnabled: true
    disableManifestsDirectory: true

  network:
    nameservers: ["1.1.1.1", "8.8.8.8"]
    disableSearchDomain: true

  install:
    disk: "/dev/vda"
    image: "ghcr.io/siderolabs/installer:v1.7.4"
    wipe: false

  time:
    disabled: false

  sysctls:
    fs.inotify.max_queued_events: "65536"
    fs.inotify.max_user_watches: "524288"
    net.core.rmem_max: "2500000"
    net.core.wmem_max: "2500000"

  features:
    rbac: true
    stableHostname: true
    apidCheckExtKeyUsage: true
    diskQuotaSupport: true
    kubePrism:
      enabled: true
      port: 7445

cluster:
  controlPlane:
    endpoint: ${clusterEndpoint}
  clusterName: ${clusterName}
  network:
    cni:
      name: none
    dnsDomain: cluster.local
  proxy:
    disabled: true
  discovery:
    enabled: true
    registries:
      kubernetes:
        disabled: false
      service:
        disabled: true
  extraManifests: []
  allowSchedulingOnControlPlanes: true
`

const talosMasterTemplate = `
machine:

  features:
    kubernetesTalosAPIAccess:
      enabled: true
      allowedRoles:
        - os:admin
      allowedKubernetesNamespaces:
        - system-upgrade

  network:
    interfaces:
    - deviceSelector:
        physical: true
      dhcp: true
      vip:
        ip: ${controlPlaneVip}

cluster:

  apiServer:
    certSANs:
      - ${clusterEndpoint}
    disablePodSecurityPolicy: true
    auditPolicy:
      apiVersion: audit.k8s.io/v1
      kind: Policy
      rules:
        - level: Metadata

  controllerManager:
    extraArgs:
      bind-address: 0.0.0.0
      terminated-pod-gc-threshold: 1000

  scheduler:
    extraArgs:
      bind-address: 0.0.0.0

  etcd:
    extraArgs:
      listen-metrics-urls: http://0.0.0.0:2381
`

const containerdPatch = `
machine:
  files:
    - op: create
      path: /etc/cri/conf.d/20-customization.part
      content: |-
        [plugins."io.containerd.grpc.v1.cri"]
          enable_unprivileged_ports = true
          enable_unprivileged_icmp = true
        [plugins."io.containerd.grpc.v1.cri".containerd]
          discard_unpacked_layers = false
        [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
          discard_unpacked_layers = false
`
const disableAdmissionControlPatch = `
- op: remove
  path: /cluster/apiServer/admissionControl
`

const talosCluster = new talos.Talos(`${resourceName}-talosCluster`, {
    sharedConfig: {
        clusterName: clusterName,
        clusterEndpoint: clusterEndpoint,
        boostrapTimeout: "300s"
    },
    master: {
        config: {
            talosVersion: "v1.7.4",
            kubernetesVersion: "1.30.1",
            baseTemplate: [talosDefaultTemplate],
            patches: [talosMasterTemplate, disableAdmissionControlPatch, containerdPatch]
        },
        nodes: masterNodes.map(node => node.ip)
    },
    worker: {
        config: {
            talosVersion: "v1.7.4",
            kubernetesVersion: "1.30.1",
            baseTemplate: [talosDefaultTemplate],
            patches: [containerdPatch]
        },
        nodes: workerNodes.map(node => node.ip)
    }
});

export const talosconfig = talosCluster.talosconfig()
export const kubeconfig = talosCluster.kubeconfig()
```

## License

This package is licensed under the [Mozilla Public License, v2.0][mpl2].

## Contributing

Please feel free to open issues or pull requests on GitHub!

[pulumi]: https://pulumi.io
[mpl2]: https://www.mozilla.org/en-US/MPL/2.0/
[changelog]: https://github.com/okassov/pulumi-openstack-network/blob/master/CHANGELOG.md

## Authors

Okassov Marat <okasov.marat@gmail.com>
