import { createSocket, type Socket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { OnvifError } from "../binding/errors.js";
import { sameIp } from "./policy.js";
import type { Datagram, DatagramAdapter, DatagramChannel, InterfaceRef, Segment } from "./types.js";

export interface Ipv6ConfinementAttestation {
    platform: NodeJS.Platform;
    nodeVersion: string;
    interfaceId: string;
    address: string;
    scopeId: number;
    evidence: string;
}

export interface NodeDatagramOptions {
    ipv6Attestations?: readonly Ipv6ConfinementAttestation[];
    interfaces?: typeof networkInterfaces;
    platform?: NodeJS.Platform;
    nodeVersion?: string;
    socketFactory?: (family: "udp4" | "udp6", multicast: boolean) => Socket;
}

export class NodeDatagramAdapter implements DatagramAdapter {
    constructor(private readonly options: NodeDatagramOptions = {}) {}

    private binding(local: InterfaceRef, segment: Segment): { address: string; multicastInterface: string; destination: string; nativeInterface: string } {
        const interfaces = (this.options.interfaces ?? networkInterfaces)();
        const matches = Object.entries(interfaces).flatMap(([name, entries]) =>
            (entries ?? []).filter((entry) => entry.family === local.family && sameIp(entry.address, local.address))
                .map((entry) => ({ name, entry })));
        if (matches.length !== 1) throw new OnvifError("UnsupportedCapability", "Configured discovery address is absent or ambiguous on this host");
        const match = matches[0];
        if (!match) throw new OnvifError("UnsupportedCapability", "No matching native interface");
        if (local.family === "IPv4") {
            return { address: local.address, multicastInterface: local.address, destination: segment.destination.address, nativeInterface: match.name };
        }
        const scoped = (interfaces[match.name] ?? []).filter((entry) => entry.family === "IPv6");
        const scopeIds = [...new Set(scoped.flatMap((entry) => entry.family === "IPv6" && entry.scopeid > 0 ? [entry.scopeid] : []))];
        const localLink = /^fe[89ab]/iu.test(local.address);
        const destinationLink = /^fe[89ab]/iu.test(segment.destination.address);
        const needsZone = segment.multicast || localLink || destinationLink;
        const scopeId = scopeIds.length === 1 ? scopeIds[0] : undefined;
        if (needsZone && scopeId === undefined) {
            throw new OnvifError("UnsupportedCapability", "IPv6 interface zone is unknown; default-interface fallback is prohibited");
        }
        if (local.zone !== undefined && local.zone !== match.name && local.zone !== String(scopeId)) {
            throw new OnvifError("UnsupportedCapability", "Configured IPv6 zone disagrees with the current native interface");
        }
        const platform = this.options.platform ?? process.platform;
        const nodeVersion = this.options.nodeVersion ?? process.versions.node;
        if (platform === "win32" && segment.multicast && !this.options.ipv6Attestations?.some((item) =>
            item.platform === platform && item.nodeVersion === nodeVersion && item.interfaceId === local.id
            && sameIp(item.address, local.address) && item.scopeId === scopeId && item.evidence.trim().length > 0)) {
            throw new OnvifError("UnsupportedCapability", "Windows IPv6 multicast confinement requires exact Node/NIC/zone deployment evidence");
        }
        const zone = needsZone ? `%${scopeId}` : "";
        return {
            address: `${local.address}${localLink ? zone : ""}`, multicastInterface: scopeId === undefined ? local.address : `::%${scopeId}`,
            destination: `${segment.destination.address}${segment.multicast || destinationLink ? zone : ""}`, nativeInterface: match.name
        };
    }

    async open(
        local: InterfaceRef,
        segment: Segment,
        receive: (datagram: Datagram) => void,
        failure: (error: Error) => void
    ): Promise<DatagramChannel> {
        const binding = this.binding(local, segment);
        const family = local.family === "IPv4" ? "udp4" : "udp6";
        const sockets: { socket: Socket; closing?: Promise<void> }[] = [];
        let closed = false;
        let closing: Promise<void> | undefined;
        const closeSocket = (owned: { socket: Socket; closing?: Promise<void> }): Promise<void> => {
            owned.closing ??= new Promise<void>((resolve, reject) => {
                try { owned.socket.close(() => resolve()); }
                catch (error) {
                    if (error instanceof Error && "code" in error && error.code === "ERR_SOCKET_DGRAM_NOT_RUNNING") resolve();
                    else reject(error);
                }
            });
            return owned.closing;
        };
        const close = (): Promise<void> => {
            if (!closing) {
                closed = true;
                closing = Promise.allSettled(sockets.map(closeSocket)).then((results) => {
                    const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
                    if (errors.length) throw new AggregateError(errors, "Native discovery socket cleanup failed");
                });
            }
            return closing;
        };
        const bind = async (address: string, port: number, receiveMulticast: boolean): Promise<Socket> => {
            const socket = this.options.socketFactory
                ? this.options.socketFactory(family, segment.multicast)
                : createSocket({ type: family, reuseAddr: segment.multicast, ipv6Only: family === "udp6" });
            sockets.push({ socket });
            let ready = false;
            socket.on("message", (data, remote) => {
                if (!closed && ready && (remote.family === "IPv4" || remote.family === "IPv6")) {
                    receive({ data, address: remote.address, family: remote.family, port: remote.port });
                }
            });
            await new Promise<void>((resolve, reject) => {
                socket.on("error", (error) => {
                    if (!ready) reject(error);
                    else if (!closed) failure(error);
                });
                socket.once("listening", () => {
                    try {
                        if (closed) throw new OnvifError("RuntimeClosed", "Discovery channel closed during socket startup");
                        if (segment.multicast && !receiveMulticast) {
                            socket.setMulticastInterface(binding.multicastInterface);
                            socket.setMulticastTTL(1);
                            socket.setMulticastLoopback(false);
                        }
                        if (receiveMulticast) {
                            socket.addMembership(segment.destination.address,
                                local.family === "IPv4" ? local.address : binding.multicastInterface);
                        }
                        ready = true;
                        resolve();
                    } catch (error) { reject(error); }
                });
                socket.bind({ address, port, exclusive: true });
            });
            return socket;
        };
        let sender: Socket;
        try {
            sender = await bind(binding.address, segment.multicast ? 0 : segment.listenPort, false);
            if (segment.multicast) await bind(binding.destination, segment.listenPort, true);
        } catch (error) {
            await close();
            if (segment.multicast && error instanceof Error && "code" in error
                && ["EADDRNOTAVAIL", "EINVAL", "ENODEV", "ENOPROTOOPT", "EOPNOTSUPP"].includes(String(error.code))) {
                throw new OnvifError("UnsupportedCapability", "Host cannot bind confined multicast sockets; wildcard fallback is prohibited");
            }
            throw error;
        }
        return {
            send: async (data, destination) => {
                if (closed) return Promise.reject(new OnvifError("RuntimeClosed", "Discovery datagram channel is closed"));
                if (!sameIp(destination.address, segment.destination.address) || destination.port !== segment.destination.port) {
                    return Promise.reject(new OnvifError("PolicyDenied", "Datagram destination differs from its configured native segment target"));
                }
                const current = this.binding(local, segment);
                if (JSON.stringify(current) !== JSON.stringify(binding)) {
                    return Promise.reject(new OnvifError("UnsupportedCapability", "Native interface or IPv6 zone changed; restart discovery with reviewed configuration"));
                }
                return new Promise<void>((resolve, reject) => sender.send(data, destination.port, binding.destination,
                    (error) => error ? reject(error) : resolve()));
            },
            close
        };
    }
}

interface FixtureChannel {
    segment: Segment;
    local: InterfaceRef;
    receive: (datagram: Datagram) => void;
    failure: (error: Error) => void;
    closed: boolean;
}

export class FixtureDatagramAdapter implements DatagramAdapter {
    readonly sent: { segmentId: string; data: Uint8Array; destination: { address: string; port: number } }[] = [];
    readonly opened: FixtureChannel[] = [];
    readonly openFailures = new Map<string, Error>();
    onSend?: (segmentId: string, data: Uint8Array) => void | Promise<void>;

    get openChannels(): number { return this.opened.filter((channel) => !channel.closed).length; }

    async open(local: InterfaceRef, segment: Segment, receive: (datagram: Datagram) => void, failure: (error: Error) => void): Promise<DatagramChannel> {
        const problem = this.openFailures.get(segment.id);
        if (problem) throw problem;
        const channel: FixtureChannel = { local, segment, receive, failure, closed: false };
        this.opened.push(channel);
        return {
            send: async (data, destination) => {
                if (channel.closed) throw new OnvifError("RuntimeClosed", "Fixture channel is closed");
                this.sent.push({ segmentId: segment.id, data: Uint8Array.from(data), destination: { ...destination } });
                await this.onSend?.(segment.id, data);
            },
            close: async () => { channel.closed = true; }
        };
    }

    deliver(segmentId: string, datagram: Datagram): void {
        const channels = this.opened.filter((channel) => !channel.closed && channel.segment.id === segmentId);
        if (!channels.length) throw new OnvifError("InvalidValue", "No open fixture channel for this segment");
        for (const channel of channels) channel.receive(datagram);
    }
    fail(segmentId: string, error: Error): void {
        const channel = this.opened.find((item) => !item.closed && item.segment.id === segmentId);
        if (!channel) throw new OnvifError("InvalidValue", "No open fixture channel for this failure");
        channel.failure(error);
    }
}
