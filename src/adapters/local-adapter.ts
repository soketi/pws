import { AdapterInterface } from './adapter-interface';
import { Namespace } from '../namespace';
import { PresenceMemberInfo } from '../channels/presence-channel-manager';
import { Server } from '../server';
import { WebSocket } from 'uWebSockets.js';

export class LocalAdapter implements AdapterInterface {
    // TODO: Force disconnect a specific socket
    // TODO: Force disconnect all sockets from an app.

    /**
     * The app connections storage class to manage connections.
     */
    public namespaces: Map<string, Namespace> = new Map<string, Namespace>();

    /**
     * Initialize the adapter.
     */
    constructor(protected server: Server) {
        //
    }

    /**
     * Initialize the adapter.
     */
    async init(): Promise<AdapterInterface> {
        return Promise.resolve(this);
    }

    /**
     * Get the app namespace.
     */
    getNamespace(appId: string): Namespace {
        if (!this.namespaces.has(appId)) {
            this.namespaces.set(appId, new Namespace(appId));
        }

        return this.namespaces.get(appId);
    }

    /**
     * Get all namespaces.
     */
    getNamespaces(): Map<string, Namespace> {
        return this.namespaces;
    }

    /**
     * Add a new socket to the namespace.
     */
    async addSocket(appId: string, ws: WebSocket): Promise<boolean> {
        return this.getNamespace(appId).addSocket(ws);
    }

    /**
     * Update a socket in the namespace.
     */
    async updateSocket(appId: string, ws: WebSocket): Promise<boolean> {
        return this.getNamespace(appId).addSocket(ws);
    }

    /**
     * Remove a socket from the namespace.
     */
    async removeSocket(appId: string, wsId: string): Promise<boolean> {
        return this.getNamespace(appId).removeSocket(wsId);
    }

    /**
     * Add a socket ID to the channel identifier.
     * Return the total number of connections after the connection.
     */
    async addToChannel(appId: string, channel: string, ws: WebSocket): Promise<number> {
        return this.getNamespace(appId).addToChannel(ws, channel).then(() => {
            return this.getChannelSocketsCount(appId, channel);
        });
    }

    /**
     * Remove a socket ID from the channel identifier.
     * Return the total number of connections remaining to the channel.
     */
    async removeFromChannel(appId: string, channel: string|string[], wsId: string): Promise<number|void> {
        return this.getNamespace(appId).removeFromChannel(wsId, channel).then((remainingConnections) => {
            if (!Array.isArray(channel)) {
                return this.getChannelSocketsCount(appId, channel);
            }

            return;
        });
    }

    /**
     * Get all sockets from the namespace.
     */
    async getSockets(appId: string, onlyLocal = false): Promise<Map<string, WebSocket>> {
        return this.getNamespace(appId).getSockets();
    }

    /**
     * Get total sockets count.
     */
    async getSocketsCount(appId: string, onlyLocal?: boolean): Promise<number> {
        return this.getNamespace(appId).getSockets().then(sockets => {
            return sockets.size;
        });
    }

    /**
     * Get all sockets from the namespace.
     */
    async getChannels(appId: string, onlyLocal = false): Promise<Map<string, Set<string>>> {
        return this.getNamespace(appId).getChannels();
    }

    /**
     * Get channels with total sockets count.
     */
    async getChannelsWithSocketsCount(appId: string, onlyLocal?: boolean): Promise<Map<string, number>> {
        return this.getNamespace(appId).getChannelsWithSocketsCount();
    }

    /**
     * Get all the channel sockets associated with a namespace.
     */
    async getChannelSockets(appId: string, channel: string, onlyLocal = false): Promise<Map<string, WebSocket>> {
        return this.getNamespace(appId).getChannelSockets(channel);
    }

    /**
     * Get a given channel's total sockets count.
     */
    async getChannelSocketsCount(appId: string, channel: string, onlyLocal?: boolean): Promise<number> {
        return this.getNamespace(appId).getChannelSockets(channel).then(sockets => {
            return sockets.size;
        });
    }

    /**
     * Get a given presence channel's members.
     */
    async getChannelMembers(appId: string, channel: string, onlyLocal = false): Promise<Map<string, PresenceMemberInfo>> {
        return this.getNamespace(appId).getChannelMembers(channel);
    }

    /**
     * Get a given presence channel's members count
     */
    async getChannelMembersCount(appId: string, channel: string, onlyLocal?: boolean): Promise<number> {
        return this.getNamespace(appId).getChannelMembers(channel).then(members => {
            return members.size;
        });
    }

    /**
     * Check if a given connection ID exists in a channel.
     */
    async isInChannel(appId: string, channel: string, wsId: string, onlyLocal?: boolean): Promise<boolean> {
        return this.getNamespace(appId).isInChannel(wsId, channel);
    }

    /**
     * Send a message to a namespace and channel.
     */
    send(appId: string, channel: string, data: string, exceptingId: string|null = null): any {
        // For user-dedicated channels, intercept the .send() call and use custom logic.
        if (channel.indexOf('#server-to-user-') === 0) {
            let userId = channel.split('#server-to-user-').pop();

            this.getUserSockets(appId, userId).then(sockets => {
                sockets.forEach(ws => {
                    if (ws.sendJson) {
                        ws.sendJson(JSON.parse(data));
                    }
                });
            });

            return;
        }

        this.getNamespace(appId).getChannelSockets(channel).then(sockets => {
            sockets.forEach((ws) => {
                if (exceptingId && exceptingId === ws.id) {
                    return;
                }

                // Fix race conditions.
                if (ws.sendJson) {
                    ws.sendJson(JSON.parse(data));
                }
            });
        });
    }

    /**
     * Terminate an User ID's connections.
     */
    terminateUserConnections(appId: string, userId: number|string): void {
        this.getNamespace(appId).terminateUserConnections(userId);
    }

    /**
     * Add to the users list the associated socket connection ID.
     */
    addUser(ws: WebSocket): Promise<void> {
        return this.getNamespace(ws.app.id).addUser(ws);
    }

    /**
     * Remove the user associated with the connection ID.
     */
    removeUser(ws: WebSocket): Promise<void> {
        return this.getNamespace(ws.app.id).removeUser(ws);
    }

    /**
     * Get the sockets associated with an user.
     */
    getUserSockets(appId: string, userId: number|string): Promise<Set<WebSocket>> {
        return this.getNamespace(appId).getUserSockets(userId);
    }

    /**
     * Clear the connections.
     */
    disconnect(): Promise<void> {
        return Promise.resolve();
    }

    /**
     * Clear the namespace from the local adapter.
     */
    clearNamespace(namespaceId: string): Promise<void> {
        this.namespaces.set(namespaceId, new Namespace(namespaceId));

        return Promise.resolve();
    }

     /**
      * Clear all namespaces from the local adapter.
      */
    clearNamespaces(): Promise<void> {
        this.namespaces = new Map<string, Namespace>();

        return Promise.resolve();
    }
}
