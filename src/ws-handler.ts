import { App } from './app';
import async from 'async';
import { EncryptedPrivateChannelManager } from './channels';
import { HttpRequest, HttpResponse } from 'uWebSockets.js';
import { Log } from './log';
import { Namespace } from './namespace';
import { PresenceChannelManager } from './channels';
import { PresenceMemberInfo } from './channels/presence-channel-manager';
import { PrivateChannelManager } from './channels';
import { PublicChannelManager } from './channels';
import { PusherMessage, uWebSocketMessage } from './message';
import { Server } from './server';
import { UserDataInterface } from './adapters/user-data-interface';
import { Utils } from './utils';
import { WebSocket } from 'uWebSockets.js';

const ab2str = require('arraybuffer-to-string');
const Pusher = require('pusher');

export class WsHandler {
    /**
     * The manager for the public channels.
     */
    protected publicChannelManager: PublicChannelManager;

    /**
     * The manager for the private channels.
     */
    protected privateChannelManager: PrivateChannelManager;

    /**
     * The manager for the encrypted private channels.
     */
    protected encryptedPrivateChannelManager: EncryptedPrivateChannelManager;

    /**
     * The manager for the presence channels.
     */
    protected presenceChannelManager: PresenceChannelManager;

    /**
     * Initialize the Websocket connections handler.
     */
    constructor(protected server: Server) {
        this.publicChannelManager = new PublicChannelManager(server);
        this.privateChannelManager = new PrivateChannelManager(server);
        this.encryptedPrivateChannelManager = new EncryptedPrivateChannelManager(server);
        this.presenceChannelManager = new PresenceChannelManager(server);
    }

    /**
     * Handle a new open connection.
     */
    onOpen(ws: WebSocket<UserDataInterface>): any {
        if (this.server.options.debug) {
            Log.websocketTitle('👨‍🔬 New connection:');
            Log.websocket({ ws });
        }

        ws.getUserData().sendJson = (data) => {
            try {
                ws.send(JSON.stringify(data));

                this.updateTimeout(ws);

                if (ws.getUserData().app) {
                    this.server.metricsManager.markWsMessageSent(ws.getUserData().app.id, data);
                }

                if (this.server.options.debug) {
                    Log.websocketTitle('✈ Sent message to client:');
                    Log.websocket({ ws, data });
                }
            } catch (e) {
                //
            }
        }

        ws.getUserData().id = this.generateSocketId();
        ws.getUserData().subscribedChannels = new Set();
        ws.getUserData().presence = new Map<string, PresenceMemberInfo>();

        if (this.server.closing) {
            ws.getUserData().sendJson({
                event: 'pusher:error',
                data: {
                    code: 4200,
                    message: 'Server is closing. Please reconnect shortly.',
                },
            });

            return ws.end(4200);
        }

        this.checkForValidApp(ws).then(validApp => {
            if (!validApp) {
                ws.getUserData().sendJson({
                    event: 'pusher:error',
                    data: {
                        code: 4001,
                        message: `App key ${ws.getUserData().appKey} does not exist.`,
                    },
                });

                return ws.end(4001);
            }

            ws.getUserData().app = validApp.forWebSocket();

            this.checkIfAppIsEnabled(ws).then(enabled => {
                if (!enabled) {
                    ws.getUserData().sendJson({
                        event: 'pusher:error',
                        data: {
                            code: 4003,
                            message: 'The app is not enabled.',
                        },
                    });

                    return ws.end(4003);
                }

                this.checkAppConnectionLimit(ws).then(canConnect => {
                    if (!canConnect) {
                        ws.getUserData().sendJson({
                            event: 'pusher:error',
                            data: {
                                code: 4100,
                                message: 'The current concurrent connections quota has been reached.',
                            },
                        });

                        ws.end(4100);
                    } else {
                        // Make sure to update the socket after new data was pushed in.
                        this.server.adapter.addSocket(ws.getUserData().app.id, ws);

                        let broadcastMessage = {
                            event: 'pusher:connection_established',
                            data: JSON.stringify({
                                socket_id: ws.getUserData().id,
                                activity_timeout: 30,
                            }),
                        };

                        ws.getUserData().sendJson(broadcastMessage);

                        if (ws.getUserData().app.enableUserAuthentication) {
                            this.setUserAuthenticationTimeout(ws);
                        }

                        this.server.metricsManager.markNewConnection(ws);
                    }
                });
            });
        });
    }

    /**
     * Handle a received message from the client.
     */
    onMessage(ws: WebSocket<UserDataInterface>, message: uWebSocketMessage, isBinary: boolean): any {
        if (message instanceof ArrayBuffer) {
            try {
                message = JSON.parse(ab2str(message)) as PusherMessage;
            } catch (err) {
                return;
            }
        }

        if (this.server.options.debug) {
            Log.websocketTitle('⚡ New message received:');
            Log.websocket({ message, isBinary });
        }

        if (message) {
            if (message.event === 'pusher:ping') {
                this.handlePong(ws);
            } else if (message.event === 'pusher:subscribe') {
                this.subscribeToChannel(ws, message);
            } else if (message.event === 'pusher:unsubscribe') {
                this.unsubscribeFromChannel(ws, message.data.channel);
            } else if (Utils.isClientEvent(message.event)) {
                this.handleClientEvent(ws, message);
            } else if (message.event === 'pusher:signin') {
                this.handleSignin(ws, message);
            } else {
                Log.warning({
                    info: 'Message event handler not implemented.',
                    message,
                });
            }
        }

        if (ws.getUserData().app) {
            this.server.metricsManager.markWsMessageReceived(ws.getUserData().app.id, message);
        }
    }

    /**
     * Handle the event of the client closing the connection.
     */
    onClose(ws: WebSocket<UserDataInterface>, code: number, message: uWebSocketMessage): any {
        if (this.server.options.debug) {
            Log.websocketTitle('❌ Connection closed:');
            Log.websocket({ ws, code, message });
        }

        // If code 4200 (reconnect immediately) is called, it means the `closeAllLocalSockets()` was called.
        if (code !== 4200) {
            this.evictSocketFromMemory(ws);
        }
    }

    /**
     * Evict the local socket.
     */
    evictSocketFromMemory(ws: WebSocket<UserDataInterface>): Promise<void> {
        return this.unsubscribeFromAllChannels(ws, true).then(() => {
            if (ws.getUserData().app) {
                this.server.adapter.removeSocket(ws.getUserData().app.id, ws.getUserData().id);
                this.server.metricsManager.markDisconnection(ws);
            }

            this.clearTimeout(ws);
        });
    }

    /**
     * Handle the event to close all existing sockets.
     */
    async closeAllLocalSockets(): Promise<void> {
        let namespaces = this.server.adapter.getNamespaces();

        if (namespaces.size === 0) {
            return Promise.resolve();
        }

        return async.each([...namespaces], ([namespaceId, namespace]: [string, Namespace], nsCallback) => {
            namespace.getSockets().then(sockets => {
                async.each([...sockets], ([wsId, ws]: [string, WebSocket<UserDataInterface>], wsCallback) => {
                    try {
                        ws.getUserData().sendJson({
                            event: 'pusher:error',
                            data: {
                                code: 4200,
                                message: 'Server closed. Please reconnect shortly.',
                            },
                        });

                        ws.end(4200);
                    } catch (e) {
                        //
                    }

                    this.evictSocketFromMemory(ws).then(() => {
                        wsCallback();
                    });
                }).then(() => {
                    this.server.adapter.clearNamespace(namespaceId).then(() => {
                        nsCallback();
                    });
                });
            });
        }).then(() => {
            // One last clear to make sure everything went away.
            return this.server.adapter.clearNamespaces();
        });
    }

    /**
     * Mutate the upgrade request.
     */
    handleUpgrade(res: HttpResponse, req: HttpRequest, context): any {
        res.upgrade(
            {
                ip: ab2str(res.getRemoteAddressAsText()),
                ip2: ab2str(res.getProxiedRemoteAddressAsText()),
                appKey: req.getParameter(0),
            },
            req.getHeader('sec-websocket-key'),
            req.getHeader('sec-websocket-protocol'),
            req.getHeader('sec-websocket-extensions'),
            context,
        );
    }

    /**
     * Send back the pong response.
     */
    handlePong(ws: WebSocket<UserDataInterface>): any {
        ws.getUserData().sendJson({
            event: 'pusher:pong',
            data: {},
        });

        if (this.server.closing) {
            ws.getUserData().sendJson({
                event: 'pusher:error',
                data: {
                    code: 4200,
                    message: 'Server closed. Please reconnect shortly.',
                },
            });

            ws.end(4200);

            this.evictSocketFromMemory(ws);
        }
    }

    /**
     * Instruct the server to subscribe the connection to the channel.
     */
    subscribeToChannel(ws: WebSocket<UserDataInterface>, message: PusherMessage): any {
        if (this.server.closing) {
            ws.getUserData().sendJson({
                event: 'pusher:error',
                data: {
                    code: 4200,
                    message: 'Server closed. Please reconnect shortly.',
                },
            });

            ws.end(4200);

            this.evictSocketFromMemory(ws);

            return;
        }

        let channel = message.data.channel;
        let channelManager = this.getChannelManagerFor(channel);

        if (channel.length > ws.getUserData().app.maxChannelNameLength) {
            let broadcastMessage = {
                event: 'pusher:subscription_error',
                channel,
                data: {
                    type: 'LimitReached',
                    error: `The channel name is longer than the allowed ${ws.getUserData().app.maxChannelNameLength} characters.`,
                    status: 4009,
                },
            };

            ws.getUserData().sendJson(broadcastMessage);

            return;
        }

        channelManager.join(ws, channel, message).then((response) => {
            if (!response.success) {
                let { authError, type, errorMessage, errorCode } = response;

                // For auth errors, send pusher:subscription_error
                if (authError) {
                    return ws.getUserData().sendJson({
                        event: 'pusher:subscription_error',
                        channel,
                        data: {
                            type: 'AuthError',
                            error: errorMessage,
                            status: 401,
                        },
                    });
                }

                // Otherwise, catch any non-auth related errors.
                return ws.getUserData().sendJson({
                    event: 'pusher:subscription_error',
                    channel,
                    data: {
                        type: type,
                        error: errorMessage,
                        status: errorCode,
                    },
                });
            }

            if (!ws.getUserData().subscribedChannels.has(channel)) {
                ws.getUserData().subscribedChannels.add(channel);
            }

            // Make sure to update the socket after new data was pushed in.
            this.server.adapter.addSocket(ws.getUserData().app.id, ws);

            // If the connection freshly joined, send the webhook:
            if (response.channelConnections === 1) {
                this.server.webhookSender.sendChannelOccupied(ws.getUserData().app, channel);
            }

            // For non-presence channels, end with subscription succeeded.
            if (!(channelManager instanceof PresenceChannelManager)) {
                let broadcastMessage = {
                    event: 'pusher_internal:subscription_succeeded',
                    channel,
                };

                ws.getUserData().sendJson(broadcastMessage);

                if (Utils.isCachingChannel(channel)) {
                    this.sendMissedCacheIfExists(ws, channel);
                }

                return;
            }

            // Otherwise, prepare a response for the presence channel.
            this.server.adapter.getChannelMembers(ws.getUserData().app.id, channel, false).then(members => {
                let { user_id, user_info } = response.member;

                ws.getUserData().presence.set(channel, response.member);

                // Make sure to update the socket after new data was pushed in.
                this.server.adapter.addSocket(ws.getUserData().app.id, ws);

                // If the member already exists in the channel, don't resend the member_added event.
                if (!members.has(user_id as string)) {
                    this.server.webhookSender.sendMemberAdded(ws.getUserData().app, channel, user_id as string);

                    this.server.adapter.send(ws.getUserData().app.id, channel, JSON.stringify({
                        event: 'pusher_internal:member_added',
                        channel,
                        data: JSON.stringify({
                            user_id: user_id,
                            user_info: user_info,
                        }),
                    }), ws.getUserData().id);

                    members.set(user_id as string, user_info);
                }

                let broadcastMessage = {
                    event: 'pusher_internal:subscription_succeeded',
                    channel,
                    data: JSON.stringify({
                        presence: {
                            ids: Array.from(members.keys()),
                            hash: Object.fromEntries(members),
                            count: members.size,
                        },
                    }),
                };

                ws.getUserData().sendJson(broadcastMessage);

                if (Utils.isCachingChannel(channel)) {
                    this.sendMissedCacheIfExists(ws, channel);
                }
            }).catch(err => {
                Log.error(err);

                ws.getUserData().sendJson({
                    event: 'pusher:error',
                    channel,
                    data: {
                        type: 'ServerError',
                        error: 'A server error has occured.',
                        code: 4302,
                    },
                });
            });
        });
    }

    /**
     * Instruct the server to unsubscribe the connection from the channel.
     */
    unsubscribeFromChannel(ws: WebSocket<UserDataInterface>, channel: string, closing = false): Promise<void> {
        let channelManager = this.getChannelManagerFor(channel);

        return channelManager.leave(ws, channel).then(response => {
            let member = ws.getUserData().presence.get(channel);

            if (response.left) {
                // Send presence channel-speific events and delete specific data.
                // This can happen only if the user is connected to the presence channel.
                if (channelManager instanceof PresenceChannelManager && ws.getUserData().presence.has(channel)) {
                    ws.getUserData().presence.delete(channel);

                    // Make sure to update the socket after new data was pushed in.
                    this.server.adapter.addSocket(ws.getUserData().app.id, ws);

                    this.server.adapter.getChannelMembers(ws.getUserData().app.id, channel, false).then(members => {
                        if (!members.has(member.user_id as string)) {
                            this.server.webhookSender.sendMemberRemoved(ws.getUserData().app, channel, member.user_id);

                            this.server.adapter.send(ws.getUserData().app.id, channel, JSON.stringify({
                                event: 'pusher_internal:member_removed',
                                channel,
                                data: JSON.stringify({
                                    user_id: member.user_id,
                                }),
                            }), ws.getUserData().id);
                        }
                    });
                }

                ws.getUserData().subscribedChannels.delete(channel);

                // Make sure to update the socket after new data was pushed in,
                // but only if the user is not closing the connection.
                if (!closing) {
                    this.server.adapter.addSocket(ws.getUserData().app.id, ws);
                }

                if (response.remainingConnections === 0) {
                    this.server.webhookSender.sendChannelVacated(ws.getUserData().app, channel);
                }
            }

            // ws.send(JSON.stringify({
            //     event: 'pusher_internal:unsubscribed',
            //     channel,
            // }));

            return;
        });
    }

    /**
     * Unsubscribe the connection from all channels.
     */
    unsubscribeFromAllChannels(ws: WebSocket<UserDataInterface>, closing = true): Promise<void> {
        if (!ws.getUserData().subscribedChannels) {
            return Promise.resolve();
        }

        return Promise.all([
            async.each(ws.getUserData().subscribedChannels, (channel, callback) => {
                this.unsubscribeFromChannel(ws, channel, closing).then(() => callback());
            }),
            ws.getUserData().app && ws.getUserData().user ? this.server.adapter.removeUser(ws) : new Promise<void>(resolve => resolve()),
        ]).then(() => {
            return;
        })
    }

    /**
     * Handle the events coming from the client.
     */
    handleClientEvent(ws: WebSocket<UserDataInterface>, message: PusherMessage): any {
        let { event, data, channel } = message;

        if (!ws.getUserData().app.enableClientMessages) {
            return ws.getUserData().sendJson({
                event: 'pusher:error',
                channel,
                data: {
                    code: 4301,
                    message: `The app does not have client messaging enabled.`,
                },
            });
        }

        // Make sure the event name length is not too big.
        if (event.length > ws.getUserData().app.maxEventNameLength) {
            let broadcastMessage = {
                event: 'pusher:error',
                channel,
                data: {
                    code: 4301,
                    message: `Event name is too long. Maximum allowed size is ${ws.getUserData().app.maxEventNameLength}.`,
                },
            };

            ws.getUserData().sendJson(broadcastMessage);

            return;
        }

        let payloadSizeInKb = Utils.dataToKilobytes(message.data);

        // Make sure the total payload of the message body is not too big.
        if (payloadSizeInKb > parseFloat(ws.getUserData().app.maxEventPayloadInKb as string)) {
            let broadcastMessage = {
                event: 'pusher:error',
                channel,
                data: {
                    code: 4301,
                    message: `The event data should be less than ${ws.getUserData().app.maxEventPayloadInKb} KB.`,
                },
            };

            ws.getUserData().sendJson(broadcastMessage);

            return;
        }

        this.server.adapter.isInChannel(ws.getUserData().app.id, channel, ws.getUserData().id).then(canBroadcast => {
            if (!canBroadcast) {
                return;
            }

            this.server.rateLimiter.consumeFrontendEventPoints(1, ws.getUserData().app, ws).then(response => {
                if (response.canContinue) {
                    let userId = ws.getUserData().presence.has(channel) ? ws.getUserData().presence.get(channel).user_id : null;

                    let message = JSON.stringify({
                        event,
                        channel,
                        data,
                        ...userId ? { user_id: userId } : {},
                    });

                    this.server.adapter.send(ws.getUserData().app.id, channel, message, ws.getUserData().id);

                    this.server.webhookSender.sendClientEvent(
                        ws.getUserData().app, channel, event, data, ws.getUserData().id, userId,
                    );

                    return;
                }

                ws.getUserData().sendJson({
                    event: 'pusher:error',
                    channel,
                    data: {
                        code: 4301,
                        message: 'The rate limit for sending client events exceeded the quota.',
                    },
                });
            });
        });
    }

    /**
     * Handle the signin coming from the frontend.
     */
    handleSignin(ws: WebSocket<UserDataInterface>, message: PusherMessage): void {
        if (!ws.getUserData().userAuthenticationTimeout) {
            return;
        }

        this.signinTokenIsValid(ws, message.data.user_data, message.data.auth).then(isValid => {
            if (!isValid) {
                ws.getUserData().sendJson({
                    event: 'pusher:error',
                    data: {
                        code: 4009,
                        message: 'Connection not authorized.',
                    },
                });

                try {
                    ws.end(4009);
                } catch (e) {
                    //
                }

                return;
            }

            let decodedUser = JSON.parse(message.data.user_data);

            if (!decodedUser.id) {
                ws.getUserData().sendJson({
                    event: 'pusher:error',
                    data: {
                        code: 4009,
                        message: 'The returned user data must contain the "id" field.',
                    },
                });

                try {
                    ws.end(4009);
                } catch (e) {
                    //
                }

                return;
            }

            ws.getUserData().user = {
                ...decodedUser,
                ...{
                    id: decodedUser.id.toString(),
                },
            };

            if (ws.getUserData().userAuthenticationTimeout) {
                clearTimeout(ws.getUserData().userAuthenticationTimeout);
            }

            this.server.adapter.addSocket(ws.getUserData().app.id, ws);

            this.server.adapter.addUser(ws).then(() => {
                ws.getUserData().sendJson({
                    event: 'pusher:signin_success',
                    data: message.data,
                });
            });
        });
    }

    /**
     * Send the first event as cache_missed, if it exists, to catch up.
     */
    sendMissedCacheIfExists(ws: WebSocket<UserDataInterface>, channel: string) {
        this.server.cacheManager.get(`app:${ws.getUserData().app.id}:channel:${channel}:cache_miss`).then(cachedEvent => {
            if (cachedEvent) {
                let { event, data } = JSON.parse(cachedEvent);
                ws.getUserData().sendJson({ event: event, channel, data: data });
            } else {
                ws.getUserData().sendJson({ event: 'pusher:cache_miss', channel });
                this.server.webhookSender.sendCacheMissed(ws.getUserData().app, channel);
            }
        });
    }

    /**
     * Get the channel manager for the given channel name,
     * respecting the Pusher protocol.
     */
    getChannelManagerFor(channel: string): PublicChannelManager|PrivateChannelManager|EncryptedPrivateChannelManager|PresenceChannelManager {
        if (Utils.isPresenceChannel(channel)) {
            return this.presenceChannelManager;
        } else if (Utils.isEncryptedPrivateChannel(channel)) {
            return this.encryptedPrivateChannelManager;
        } else if (Utils.isPrivateChannel(channel)) {
            return this.privateChannelManager;
        } else {
            return this.publicChannelManager;
        }
    }

    /**
     * Use the app manager to retrieve a valid app.
     */
    protected checkForValidApp(ws: WebSocket<UserDataInterface>): Promise<App|null> {
        return this.server.appManager.findByKey(ws.getUserData().appKey);
    }

    /**
     * Make sure that the app is enabled.
     */
    protected checkIfAppIsEnabled(ws: WebSocket<UserDataInterface>): Promise<boolean> {
        return Promise.resolve(ws.getUserData().app.enabled);
    }

    /**
     * Make sure the connection limit is not reached with this connection.
     * Return a boolean wether the user can connect or not.
     */
    protected checkAppConnectionLimit(ws: WebSocket<UserDataInterface>): Promise<boolean> {
        return this.server.adapter.getSocketsCount(ws.getUserData().app.id).then(wsCount => {
            let maxConnections = parseInt(ws.getUserData().app.maxConnections as string) || -1;

            if (maxConnections < 0) {
                return true;
            }

            return wsCount + 1 <= maxConnections;
        }).catch(err => {
            Log.error(err);
            return false;
        });
    }

    /**
     * Check is an incoming connection can subscribe.
     */
    signinTokenIsValid(ws: WebSocket<UserDataInterface>, userData: string, signatureToCheck: string): Promise<boolean> {
        return this.signinTokenForUserData(ws, userData).then(expectedSignature => {
            return signatureToCheck === expectedSignature;
        });
    }

    /**
     * Get the signin token from the given message, by the Socket.
     */
    protected signinTokenForUserData(ws: WebSocket<UserDataInterface>, userData: string): Promise<string> {
        return new Promise(resolve => {
            let decodedString = `${ws.getUserData().id}::user::${userData}`;
            let token = new Pusher.Token(ws.getUserData().app.key, ws.getUserData().app.secret);

            resolve(
                ws.getUserData().app.key + ':' + token.sign(decodedString)
            );
        });
    }

    /**
     * Generate a Pusher-like Socket ID.
     */
    protected generateSocketId(): string {
        let min = 0;
        let max = 10000000000;

        let randomNumber = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

        return randomNumber(min, max) + '.' + randomNumber(min, max);
    }

    /**
     * Clear WebSocket timeout.
     */
    protected clearTimeout(ws: WebSocket<UserDataInterface>): void {
        if (ws.getUserData().timeout) {
            clearTimeout(ws.getUserData().timeout);
        }
    }

    /**
     * Update WebSocket timeout.
     */
    protected updateTimeout(ws: WebSocket<UserDataInterface>): void {
        this.clearTimeout(ws);

        ws.getUserData().timeout = setTimeout(() => {
            try {
                ws.end(4201);
            } catch (e) {
                //
            }
        }, 120_000);
    }

    /**
     * Set the authentication timeout for the socket.
     */
    protected setUserAuthenticationTimeout(ws: WebSocket<UserDataInterface>): void {
        ws.getUserData().userAuthenticationTimeout = setTimeout(() => {
            ws.getUserData().sendJson({
                event: 'pusher:error',
                data: {
                    code: 4009,
                    message: 'Connection not authorized within timeout.',
                },
            });

            try {
                ws.end(4009);
            } catch (e) {
                //
            }
        }, this.server.options.userAuthenticationTimeout);
    }
}
