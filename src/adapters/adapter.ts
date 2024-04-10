import { AdapterInterface } from './adapter-interface';
import { ClusterAdapter } from './cluster-adapter';
import { LocalAdapter } from './local-adapter';
import { Log } from '../log';
import { Namespace } from '../namespace';
import { NatsAdapter } from './nats-adapter';
import { PresenceMemberInfo } from '../channels/presence-channel-manager';
import { RedisAdapter } from './redis-adapter';
import { Server } from '../server';
import { WebSocket } from 'uWebSockets.js';

export class Adapter implements AdapterInterface {
    /**
     * The adapter driver.
     */
    public driver: AdapterInterface;

    /**
     * Initialize adapter scaling.
     */
    constructor(server: Server) {
        if (server.options.adapter.driver === 'local') {
            this.driver = new LocalAdapter(server);
        } else if (server.options.adapter.driver === 'redis') {
            this.driver = new RedisAdapter(server);
        } else if (server.options.adapter.driver === 'nats') {
            this.driver = new NatsAdapter(server);
        } else if (server.options.adapter.driver === 'cluster') {
            this.driver = new ClusterAdapter(server);
        } else {
            Log.error('Adapter driver not set.');
        }
    }

    /**
     * Initialize the adapter.
     */
    async init(): Promise<AdapterInterface> {
        return await this.driver.init();
    }

    /**
     * Get the app namespace.
     */
    getNamespace(appId: string): Namespace {
        return this.driver.getNamespace(appId);
    }

    /**
     * Get all namespaces.
     */
    getNamespaces(): Map<string, Namespace> {
        return this.driver.getNamespaces();
    }

    /**
     * Add a new socket to the namespace.
     */
    async addSocket(appId: string, ws: WebSocket): Promise<boolean> {
        return this.driver.addSocket(appId, ws);
    }

    /**
     * Update a socket in the namespace.
     */
    async updateSocket(appId: string, ws: WebSocket): Promise<boolean> {
        return this.driver.updateSocket(appId, ws);
    }

    /**
     * Remove a socket from the namespace.
     */
    async removeSocket(appId: string, wsId: string): Promise<boolean> {
        return this.driver.removeSocket(appId, wsId);
    }

    /**
     * Add a socket ID to the channel identifier.
     * Return the total number of connections after the connection.
     */
    async addToChannel(appId: string, channel: string, ws: WebSocket): Promise<number> {
        return this.driver.addToChannel(appId, channel, ws);
    }

    /**
     * Remove a socket ID from the channel identifier.
     * Return the total number of connections remaining to the channel.
     */
    async removeFromChannel(appId: string, channel: string|string[], wsId: string): Promise<number|void> {
        return this.driver.removeFromChannel(appId, channel, wsId);
    }

    /**
     * Get all sockets from the namespace.
     */
    async getSockets(appId: string, onlyLocal = false): Promise<Map<string, WebSocket>> {
        return this.driver.getSockets(appId, onlyLocal);
    }

    /**
     * Get total sockets count.
     */
    async getSocketsCount(appId: string, onlyLocal?: boolean): Promise<number> {
        return this.driver.getSocketsCount(appId, onlyLocal);
    }

    /**
     * Get the list of channels with the websocket IDs.
     */
    async getChannels(appId: string, onlyLocal = false): Promise<Map<string, Set<string>>> {
        return this.driver.getChannels(appId, onlyLocal);
    }

    /**
     * Get the list of channels with the websockets count.
     */
    async getChannelsWithSocketsCount(appId: string, onlyLocal = false): Promise<Map<string, number>> {
        return this.driver.getChannelsWithSocketsCount(appId, onlyLocal);
    }

    /**
     * Get all the channel sockets associated with a namespace.
     */
    async getChannelSockets(appId: string, channel: string, onlyLocal = false): Promise<Map<string, WebSocket>> {
        return this.driver.getChannelSockets(appId, channel, onlyLocal);
    }

    /**
     * Get a given channel's total sockets count.
     */
    async getChannelSocketsCount(appId: string, channel: string, onlyLocal?: boolean): Promise<number> {
        return this.driver.getChannelSocketsCount(appId, channel, onlyLocal);
    }

    /**
     * Get a given presence channel's members.
     */
    async getChannelMembers(appId: string, channel: string, onlyLocal = false): Promise<Map<string, PresenceMemberInfo>> {
        return this.driver.getChannelMembers(appId, channel, onlyLocal);
    }

    /**
     * Get a given presence channel's members count
     */
    async getChannelMembersCount(appId: string, channel: string, onlyLocal?: boolean): Promise<number> {
        return this.driver.getChannelMembersCount(appId, channel, onlyLocal);
    }

    /**
     * Check if a given connection ID exists in a channel.
     */
    async isInChannel(appId: string, channel: string, wsId: string, onlyLocal?: boolean): Promise<boolean> {
        return this.driver.isInChannel(appId, channel, wsId, onlyLocal);
    }

    /**
     * Send a message to a namespace and channel.
     */
    send(appId: string, channel: string, data: string, exceptingId: string|null = null): void {
        return this.driver.send(appId, channel, data, exceptingId);
    }

    /**
     * Terminate an User ID's connections.
     */
    terminateUserConnections(appId: string, userId: number|string): void {
        return this.driver.terminateUserConnections(appId, userId);
    }

    /**
     * Add to the users list the associated socket connection ID.
     */
    addUser(ws: WebSocket): Promise<void> {
        return this.driver.addUser(ws);
    }

    /**
     * Remove the user associated with the connection ID.
     */
    removeUser(ws: WebSocket): Promise<void> {
        return this.driver.removeUser(ws);
    }

    /**
     * Get the sockets associated with an user.
     */
    getUserSockets(appId: string, userId: string|number): Promise<Set<WebSocket>> {
        return this.driver.getUserSockets(appId, userId);
    }

    /**
     * Clear the namespace from the local adapter.
     */
    clearNamespace(namespaceId: string): Promise<void> {
        return this.driver.clearNamespace(namespaceId);
    }

    /**
     * Clear all namespaces from the local adapter.
     */
    clearNamespaces(): Promise<void> {
        return this.driver.clearNamespaces();
    }

    /**
     * Clear the connections.
     */
    disconnect(): Promise<void> {
        return this.driver.disconnect();
    }
}
