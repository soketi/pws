import { LocalAdapter } from './local-adapter';
import { Log } from '../log';
import { PresenceMemberInfo } from '../channels/presence-channel-manager';
import { v4 as uuidv4 } from 'uuid';
import { WebSocket } from 'uWebSockets.js';

/**
 *                                          |-----> NODE1 ----> SEEKS DATA (ONREQUEST) ----> SEND TO THE NODE0 ---> NODE0 (ONRESPONSE) APPENDS DATA TO REQUEST OBJECT
 *                                          |
 * NODE0 ---> PUBLISH TO PUBLISHER  ------> |-----> NODE2 ----> SEEKS DATA (ONREQUEST) ----> SEND TO THE NODE0 ---> NODE0 (ONRESPONSE) APPENDS DATA TO REQUEST OBJECT
 *            (IN ADAPTER METHOD)           |
 *                                          |-----> NODE3 ----> SEEKS DATA (ONREQUEST) ----> SEND TO THE NODE0 ---> NODE0 (ONRESPONSE) APPENDS DATA TO REQUEST OBJECT
 */

export enum RequestType {
    SOCKETS = 0,
    CHANNELS = 1,
    CHANNEL_SOCKETS = 2,
    CHANNEL_MEMBERS = 3,
    SOCKETS_COUNT = 4,
    CHANNEL_MEMBERS_COUNT = 5,
    CHANNEL_SOCKETS_COUNT = 6,
    SOCKET_EXISTS_IN_CHANNEL = 7,
    CHANNELS_WITH_SOCKETS_COUNT = 8,
    TERMINATE_USER_CONNECTIONS = 9,
}

export interface RequestExtra {
    numSub?: number;
    msgCount?: number;
    sockets?: Map<string, any>;
    members?: Map<string, PresenceMemberInfo>;
    channels?: Map<string, Set<string>>;
    channelsWithSocketsCount?: Map<string, number>;
    totalCount?: number;
}

export interface Request extends RequestExtra {
    appId: string;
    type: RequestType;
    time: number;
    resolve: Function;
    reject: Function;
    timeout: any;
    [other: string]: any;
}

export interface RequestOptions {
    opts?: { [key: string]: any };
}

export interface RequestBody extends RequestOptions {
    type: RequestType;
    requestId: string;
    appId: string;
}

export interface Response {
    requestId: string;
    sockets?: Map<string, WebSocket>;
    members?: [string, PresenceMemberInfo][];
    channels?: [string, string[]][];
    channelsWithSocketsCount?: [string, number][];
    totalCount?: number;
    exists?: boolean;
}

export interface PubsubBroadcastedMessage {
    uuid: string;
    appId: string;
    channel: string;
    data: any;
    exceptingId?: string|null;
}

export abstract class HorizontalAdapter extends LocalAdapter {
    /**
     * The time (in ms) for the request to be fulfilled.
     */
    public requestsTimeout = 5_000;

    /**
     * The channel to listen for new requests.
     */
    protected requestChannel;

    /**
     * The channel to emit back based on the requests.
     */
    protected responseChannel;

    /**
     * The list of current request made by this instance.
     */
    protected requests: Map<string, Request> = new Map();

    /**
     * The channel to broadcast the information.
     */
    protected channel = 'horizontal-adapter';

    /**
     * The UUID assigned for the current instance.
     */
    protected uuid: string = uuidv4();

    /**
     * The list of resolvers for each response type.
     */
    protected resolvers = {
        [RequestType.SOCKETS]: {
            computeResponse: (request: Request, response: Response) => {
                if (response.sockets) {
                    response.sockets.forEach(ws => request.sockets.set(ws.id, ws));
                }
            },
            resolveValue: (request: Request, response: Response) => {
                return request.sockets;
            },
        },
        [RequestType.CHANNEL_SOCKETS]: {
            computeResponse: (request: Request, response: Response) => {
                if (response.sockets) {
                    response.sockets.forEach(ws => request.sockets.set(ws.id, ws));
                }
            },
            resolveValue: (request: Request, response: Response) => {
                return request.sockets;
            },
        },
        [RequestType.CHANNELS]: {
            computeResponse: (request: Request, response: Response) => {
                if (response.channels) {
                    response.channels.forEach(([channel, connections]) => {
                        if (request.channels.has(channel)) {
                            connections.forEach(connection => {
                                request.channels.set(channel, request.channels.get(channel).add(connection));
                            });
                        } else {
                            request.channels.set(channel, new Set(connections));
                        }
                    });
                }
            },
            resolveValue: (request: Request, response: Response) => {
                return request.channels;
            },
        },
        [RequestType.CHANNELS_WITH_SOCKETS_COUNT]: {
            computeResponse: (request: Request, response: Response) => {
                if (response.channelsWithSocketsCount) {
                    response.channelsWithSocketsCount.forEach(([channel, connectionsCount]) => {
                        if (request.channelsWithSocketsCount.has(channel)) {
                            request.channelsWithSocketsCount.set(
                                channel,
                                request.channelsWithSocketsCount.get(channel) + connectionsCount,
                            );
                        } else {
                            request.channelsWithSocketsCount.set(channel, connectionsCount);
                        }
                    });
                }
            },
            resolveValue: (request: Request, response: Response) => {
                return request.channelsWithSocketsCount;
            },
        },
        [RequestType.CHANNEL_MEMBERS]: {
            computeResponse: (request: Request, response: Response) => {
                if (response.members) {
                    response.members.forEach(([id, member]) => request.members.set(id, member));
                }
            },
            resolveValue: (request: Request, response: Response) => {
                return request.members;
            },
        },
        [RequestType.SOCKETS_COUNT]: {
            computeResponse: (request: Request, response: Response) => {
                if (typeof response.totalCount !== 'undefined') {
                    request.totalCount += response.totalCount;
                }
            },
            resolveValue: (request: Request, response: Response) => {
                return request.totalCount;
            },
        },
        [RequestType.CHANNEL_MEMBERS_COUNT]: {
            computeResponse: (request: Request, response: Response) => {
                if (typeof response.totalCount !== 'undefined') {
                    request.totalCount += response.totalCount;
                }
            },
            resolveValue: (request: Request, response: Response) => {
                return request.totalCount;
            },
        },
        [RequestType.CHANNEL_SOCKETS_COUNT]: {
            computeResponse: (request: Request, response: Response) => {
                if (typeof response.totalCount !== 'undefined') {
                    request.totalCount += response.totalCount;
                }
            },
            resolveValue: (request: Request, response: Response) => {
                return request.totalCount;
            },
        },
        [RequestType.SOCKET_EXISTS_IN_CHANNEL]: {
            computeResponse: (request: Request, response: Response) => {
                if (typeof response.exists !== 'undefined' && response.exists === true) {
                    request.exists = true;
                }
            },
            resolveValue: (request: Request, response: Response) => {
                return request.exists || false;
            },
        },
        [RequestType.TERMINATE_USER_CONNECTIONS]: {
            computeResponse: (request: Request, response: Response) => {
                // Don't need to compute any response as we won't be sending one.
            },
            resolveValue: (request: Request, response: Response) => {
                return true;
            },
        },
    };

    /**
     * Broadcast data to a given channel.
     */
    protected abstract broadcastToChannel(channel: string, data: string): void;

    /**
     * Get the number of total subscribers subscribers.
     */
    protected abstract getNumSub(): Promise<number>;

    /**
     * Send a response through the response channel.
     */
    protected sendToResponseChannel(data: string): void {
        this.broadcastToChannel(this.responseChannel, data);
    }

    /**
     * Send a request through the request channel.
     */
    protected sendToRequestChannel(data: string): void {
        this.broadcastToChannel(this.requestChannel, data);
    }

    /**
     * Send a message to a namespace and channel.
     */
    send(appId: string, channel: string, data: string, exceptingId: string|null = null): any {
        this.broadcastToChannel(this.channel, JSON.stringify({
            uuid: this.uuid,
            appId,
            channel,
            data,
            exceptingId,
        }));

        this.sendLocally(appId, channel, data, exceptingId);
    }

    /**
     * Force local sending only for the Horizontal adapter.
     */
    sendLocally(appId: string, channel: string, data: string, exceptingId: string|null = null): any {
        super.send(appId, channel, data, exceptingId);
    }

    /**
     * Terminate an User ID's connections.
     */
    terminateUserConnections(appId: string, userId: number|string): void {
        new Promise((resolve, reject) => {
            this.getNumSub().then(numSub => {
                if (numSub <= 1) {
                    this.terminateLocalUserConnections(appId, userId);

                    return;
                }

                this.sendRequest(
                    appId,
                    RequestType.TERMINATE_USER_CONNECTIONS,
                    resolve,
                    reject,
                    { numSub },
                    { opts: { userId } },
                );
            });
        });

        this.terminateLocalUserConnections(appId, userId);
    }

    /**
     * Terminate an User ID's local connections.
     */
    terminateLocalUserConnections(appId: string, userId: number|string): void {
        super.terminateUserConnections(appId, userId);
    }

    /**
     * Get all sockets from the namespace.
     */
    async getSockets(appId: string, onlyLocal = false): Promise<Map<string, WebSocket>> {
        return new Promise((resolve, reject) => {
            super.getSockets(appId, true).then(localSockets => {
                if (onlyLocal) {
                    return resolve(localSockets);
                }

                this.getNumSub().then(numSub => {
                    if (numSub <= 1) {
                        return resolve(localSockets);
                    }

                    this.sendRequest(
                        appId,
                        RequestType.SOCKETS,
                        resolve,
                        reject,
                        { numSub, sockets: localSockets },
                    );
                });
            });
        });
    }

    /**
     * Get total sockets count.
     */
    async getSocketsCount(appId: string, onlyLocal?: boolean): Promise<number> {
        return new Promise((resolve, reject) => {
            super.getSocketsCount(appId).then(wsCount => {
                if (onlyLocal) {
                    return resolve(wsCount);
                }

                this.getNumSub().then(numSub => {
                    if (numSub <= 1) {
                        return resolve(wsCount);
                    }

                    this.sendRequest(
                        appId,
                        RequestType.SOCKETS_COUNT,
                        resolve,
                        reject,
                        { numSub, totalCount: wsCount },
                    );
                });
            });
        });
    }

    /**
     * Get all sockets from the namespace.
     */
    async getChannels(appId: string, onlyLocal = false): Promise<Map<string, Set<string>>> {
        return new Promise((resolve, reject) => {
            super.getChannels(appId).then(localChannels => {
                if (onlyLocal) {
                    resolve(localChannels);
                }

                this.getNumSub().then(numSub => {
                    if (numSub <= 1) {
                        return resolve(localChannels);
                    }

                    this.sendRequest(
                        appId,
                        RequestType.CHANNELS,
                        resolve,
                        reject,
                        { numSub, channels: localChannels },
                    );
                });
            });
        });
    }

    /**
     * Get total sockets count.
     */
    async getChannelsWithSocketsCount(appId: string, onlyLocal?: boolean): Promise<Map<string, number>> {
        return new Promise((resolve, reject) => {
            super.getChannelsWithSocketsCount(appId).then(list => {
                if (onlyLocal) {
                    return resolve(list);
                }

                this.getNumSub().then(numSub => {
                    if (numSub <= 1) {
                        return resolve(list);
                    }

                    this.sendRequest(
                        appId,
                        RequestType.CHANNELS_WITH_SOCKETS_COUNT,
                        resolve,
                        reject,
                        { numSub, channelsWithSocketsCount: list },
                    );
                });
            });
        });
    }

    /**
     * Get all the channel sockets associated with a namespace.
     */
    async getChannelSockets(appId: string, channel: string, onlyLocal = false): Promise<Map<string, WebSocket>> {
        return new Promise((resolve, reject) => {
            super.getChannelSockets(appId, channel).then(localSockets => {
                if (onlyLocal) {
                    return resolve(localSockets);
                }

                this.getNumSub().then(numSub => {
                    if (numSub <= 1) {
                        return resolve(localSockets);
                    }

                    this.sendRequest(
                        appId,
                        RequestType.CHANNEL_SOCKETS,
                        resolve,
                        reject,
                        { numSub, sockets: localSockets },
                        { opts: { channel } },
                    );
                });
            });
        });
    }

    /**
     * Get a given channel's total sockets count.
     */
    async getChannelSocketsCount(appId: string, channel: string, onlyLocal?: boolean): Promise<number> {
        return new Promise((resolve, reject) => {
            super.getChannelSocketsCount(appId, channel).then(wsCount => {
                if (onlyLocal) {
                    return resolve(wsCount);
                }

                this.getNumSub().then(numSub => {
                    if (numSub <= 1) {
                        return resolve(wsCount);
                    }

                    this.sendRequest(
                        appId,
                        RequestType.CHANNEL_SOCKETS_COUNT,
                        resolve,
                        reject,
                        { numSub, totalCount: wsCount },
                        { opts: { channel } },
                    );
                });
            });
        });
    }

    /**
     * Get all the channel sockets associated with a namespace.
     */
    async getChannelMembers(appId: string, channel: string, onlyLocal = false): Promise<Map<string, PresenceMemberInfo>> {
        return new Promise((resolve, reject) => {
            super.getChannelMembers(appId, channel).then(localMembers => {
                if (onlyLocal) {
                    return resolve(localMembers);
                }

                this.getNumSub().then(numSub => {
                    if (numSub <= 1) {
                        return resolve(localMembers);
                    }

                    return this.sendRequest(
                        appId,
                        RequestType.CHANNEL_MEMBERS,
                        resolve,
                        reject,
                        { numSub, members: localMembers },
                        { opts: { channel } },
                    );
                });
            });
        });
    }

    /**
     * Get a given presence channel's members count
     */
    async getChannelMembersCount(appId: string, channel: string, onlyLocal?: boolean): Promise<number> {
        return new Promise((resolve, reject) => {
            super.getChannelMembersCount(appId, channel).then(localMembersCount => {
                if (onlyLocal) {
                    return resolve(localMembersCount);
                }

                this.getNumSub().then(numSub => {
                    if (numSub <= 1) {
                        return resolve(localMembersCount);
                    }

                    this.sendRequest(
                        appId,
                        RequestType.CHANNEL_MEMBERS_COUNT,
                        resolve,
                        reject,
                        { numSub, totalCount: localMembersCount },
                        { opts: { channel } },
                    );
                });
            });
        });
    }

    /**
     * Listen for requests coming from other nodes.
     */
    protected onRequest(channel: string, msg: string): void {
        let request: RequestBody;

        try {
            request = JSON.parse(msg);
        } catch (err) {
            //
        }

        let { appId } = request;

        if (this.server.options.debug) {
            Log.clusterTitle('🧠 Received request from another node');
            Log.cluster({ request, channel });
        }

        switch (request.type) {
            case RequestType.SOCKETS:
                this.processRequestFromAnotherInstance(request, () => super.getSockets(appId, true).then(sockets => {
                    let localSockets: WebSocket[] = Array.from(sockets.values());

                    return {
                        sockets: localSockets.map(ws => ({
                            id: ws.id,
                            subscribedChannels: ws.subscribedChannels,
                            presence: ws.presence,
                            ip: ws.ip,
                            ip2: ws.ip2,
                        })),
                    };
                }));
                break;

            case RequestType.CHANNEL_SOCKETS:
                this.processRequestFromAnotherInstance(request, () => super.getChannelSockets(appId, request.opts.channel).then(sockets => {
                    let localSockets: WebSocket[] = Array.from(sockets.values());

                    return {
                        sockets: localSockets.map(ws => ({
                            id: ws.id,
                            subscribedChannels: ws.subscribedChannels,
                            presence: ws.presence,
                        })),
                    };
                }));
                break;

            case RequestType.CHANNELS:
                this.processRequestFromAnotherInstance(request, () => {
                    return super.getChannels(appId).then(localChannels => {
                        return {
                            channels: [...localChannels].map(([channel, connections]) => [channel, [...connections]]),
                        };
                    });
                });
                break;

            case RequestType.CHANNELS_WITH_SOCKETS_COUNT:
                this.processRequestFromAnotherInstance(request, () => {
                    return super.getChannelsWithSocketsCount(appId).then(channelsWithSocketsCount => {
                        return { channelsWithSocketsCount: [...channelsWithSocketsCount] };
                    });
                });
                break;

            case RequestType.CHANNEL_MEMBERS:
                this.processRequestFromAnotherInstance(request, () => {
                    return super.getChannelMembers(appId, request.opts.channel).then(localMembers => {
                        return { members: [...localMembers] };
                    });
                });
                break;

            case RequestType.SOCKETS_COUNT:
                this.processRequestFromAnotherInstance(request, () => {
                    return super.getSocketsCount(appId).then(localCount => {
                        return { totalCount: localCount };
                    });
                });
                break;

            case RequestType.CHANNEL_MEMBERS_COUNT:
                this.processRequestFromAnotherInstance(request, () => {
                    return super.getChannelMembersCount(appId, request.opts.channel).then(localCount => {
                        return { totalCount: localCount };
                    });
                });
                break;

            case RequestType.CHANNEL_SOCKETS_COUNT:
                this.processRequestFromAnotherInstance(request, () => {
                    return super.getChannelSocketsCount(appId, request.opts.channel).then(localCount => {
                        return { totalCount: localCount };
                    });
                });
                break;

            case RequestType.TERMINATE_USER_CONNECTIONS:
                this.processRequestFromAnotherInstance(request, () => {
                    this.terminateLocalUserConnections(appId, request.opts.userId);

                    return Promise.resolve();
                });
                break;
        }
    }

    /**
     * Handle a response from another node.
     */
    protected onResponse(channel: string, msg: string): void {
        let response: Response;

        try {
            response = JSON.parse(msg);
        } catch (err) {
            //
        }

        const requestId = response.requestId;

        if (!requestId || !this.requests.has(requestId)) {
            return;
        }

        const request = this.requests.get(requestId);

        if (this.server.options.debug) {
            Log.clusterTitle('🧠 Received response from another node to our request');
            Log.cluster(msg);
        }

        this.processReceivedResponse(
            response,
            this.resolvers[request.type].computeResponse.bind(this),
            this.resolvers[request.type].resolveValue.bind(this),
        );
    }

    /**
     * Send a request to find more about what other subscribers
     * are storing in their memory.
     */
    protected sendRequest(
        appId: string,
        type: RequestType,
        resolve: CallableFunction,
        reject: CallableFunction,
        requestExtra: RequestExtra = {},
        requestOptions: RequestOptions = {},
    ) {
        const requestId = uuidv4();

        const timeout = setTimeout(() => {
            if (this.requests.has(requestId)) {
                if (this.server.options.debug) {
                    Log.error(`Timeout reached while waiting for response in type ${type}. Forcing resolve with the current values.`);
                }

                this.processReceivedResponse(
                    { requestId },
                    this.resolvers[type].computeResponse.bind(this),
                    this.resolvers[type].resolveValue.bind(this),
                    true
                );
            }
        }, this.requestsTimeout);

        // Add the request to the local memory.
        this.requests.set(requestId, {
            appId,
            type,
            time: Date.now(),
            timeout,
            msgCount: 1,
            resolve,
            reject,
            ...requestExtra,
        });

        // The message to send to other nodes.
        const requestToSend = JSON.stringify({
            requestId,
            appId,
            type,
            ...requestOptions,
        });

        this.sendToRequestChannel(requestToSend);

        if (this.server.options.debug) {
            Log.clusterTitle('✈ Sent message to other instances');
            Log.cluster({ request: this.requests.get(requestId) });
        }

        this.server.metricsManager.markHorizontalAdapterRequestSent(appId);
    }

    /**
     * Process the incoming request from other subscriber.
     */
    protected processRequestFromAnotherInstance(request: RequestBody, callbackResolver: Function): void {
        let { requestId, appId } = request;

        // Do not process requests for the same node that created the request.
        if (this.requests.has(requestId)) {
            return;
        }

        callbackResolver().then(extra => {
            let response = JSON.stringify({ requestId, ...extra });

            this.sendToResponseChannel(response);

            if (this.server.options.debug) {
                Log.clusterTitle('✈ Sent response to the instance');
                Log.cluster({ response });
            }

            this.server.metricsManager.markHorizontalAdapterRequestReceived(appId);
        });
    }

    /**
     * Process the incoming response to a request we made.
     */
    protected processReceivedResponse(
        response: Response,
        responseComputer: CallableFunction,
        promiseResolver: CallableFunction,
        forceResolve = false
    ) {
        const request = this.requests.get(response.requestId);

        request.msgCount++;

        responseComputer(request, response);

        this.server.metricsManager.markHorizontalAdapterResponseReceived(request.appId);

        if (forceResolve || request.msgCount === request.numSub) {
            clearTimeout(request.timeout);

            if (request.resolve) {
                request.resolve(promiseResolver(request, response));
                this.requests.delete(response.requestId);

                // If the resolve was forced, it means not all nodes fulfilled the request, thus leading to timeout.
                this.server.metricsManager.trackHorizontalAdapterResolvedPromises(request.appId, !forceResolve);
                this.server.metricsManager.trackHorizontalAdapterResolveTime(request.appId, Date.now() - request.time);
            }
        }
    }
}
