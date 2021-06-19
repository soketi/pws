import async from 'async';
import { HttpResponse } from 'uWebSockets.js';
import { Server } from './server';
import { Utils } from './utils';
import { Log } from './log';

const v8 = require('v8');

export interface ChannelResponse {
    subscription_count: number;
    user_count?: number;
    occupied: boolean;
}

// TODO: Mark API message in Prometheus
// TODO: Create middleware for the rate limiting.

export class HttpHandler {
    /**
     * Initialize the HTTP handler.
     */
     constructor(protected server: Server) {
        //
    }

    healthCheck(res: HttpResponse) {
        this.attachMiddleware(res, [
            this.corsMiddleware,
        ]).then(res => {
            res.writeStatus('200 OK').end('OK');
        });
    }

    usage(res: HttpResponse) {
        this.attachMiddleware(res, [
            this.corsMiddleware,
        ]).then(res => {
            let { rss, heapTotal, external, arrayBuffers } = process.memoryUsage();

            let totalSize = v8.getHeapStatistics().total_available_size;
            let usedSize = rss + heapTotal + external + arrayBuffers;
            let freeSize = totalSize - usedSize;
            let percentUsage = (usedSize / totalSize) * 100;

            return res.writeStatus('200 OK').end(JSON.stringify({
                memory: {
                    free: freeSize,
                    used: usedSize,
                    total: totalSize,
                    percent: percentUsage,
                },
            }));
        });
    }

    metrics(res: HttpResponse) {
        this.attachMiddleware(res, [
            this.corsMiddleware,
        ]).then(res => {
            let metricsResponse = metrics => {
                res.writeStatus('200 OK').end(res.query.json ? JSON.stringify(metrics) : metrics);
            };

            if (res.query.json) {
                this.server.metricsManager.getMetricsAsJson().then(metricsResponse);
            } else {
                this.server.metricsManager.getMetricsAsPlaintext().then(metricsResponse);
            }
        });
    }

    channels(res: HttpResponse) {
        this.attachMiddleware(res, [
            this.corsMiddleware,
            this.appMiddleware,
            this.authMiddleware,
        ]).then(res => {
            this.server.adapter.getChannels(res.params.appId).then(channels => {
                let response: { [channel: string]: ChannelResponse } = [...channels].reduce((channels, [channel, connections]) => {
                    if (connections.size === 0) {
                        return channels;
                    }

                    channels[channel] = {
                        subscription_count: connections.size,
                        occupied: true,
                    };

                    return channels;
                }, {});

                return response;
            }).catch(err => {
                Log.error(err);
                return this.serverErrorResponse(res, 'A server error has occured.');
            }).then(channels => {
                let message = { channels };

                this.server.metricsManager.markApiMessage(res.params.appId, {}, message);

                res.writeStatus('200 OK').end(JSON.stringify(message));
            });
        });
    }

    channel(res: HttpResponse) {
        this.attachMiddleware(res, [
            this.corsMiddleware,
            this.appMiddleware,
            this.authMiddleware,
        ]).then(res => {
            let response: ChannelResponse;

            this.server.adapter.getChannelSocketsCount(res.params.appId, res.params.channel).then(socketsCount => {
                response = {
                    subscription_count: socketsCount,
                    occupied: socketsCount > 0,
                };

                // For presence channels, attach an user_count.
                // Avoid extra call to get channel members if there are no sockets.
                if (res.params.channel.startsWith('presence-')) {
                    response.user_count = 0;

                    if (response.subscription_count > 0) {
                        this.server.adapter.getChannelMembersCount(res.params.appId, res.params.channel).then(membersCount => {
                            let message = {
                                ...response,
                                ... {
                                    user_count: membersCount,
                                },
                            };

                            this.server.metricsManager.markApiMessage(res.params.appId, {}, message);

                            res.writeStatus('200 OK').end(JSON.stringify(message));
                        }).catch(err => {
                            Log.error(err);
                            return this.serverErrorResponse(res, 'A server error has occured.');
                        });

                        return;
                    } else {
                        this.server.metricsManager.markApiMessage(res.params.appId, {}, response);

                        return res.writeStatus('200 OK').end(JSON.stringify(response));
                    }
                } else {
                    this.server.metricsManager.markApiMessage(res.params.appId, {}, response);

                    return res.writeStatus('200 OK').end(JSON.stringify(response));
                }
            }).catch(err => {
                Log.error(err);
                return this.serverErrorResponse(res, 'A server error has occured.');
            });
        });
    }

    channelUsers(res: HttpResponse) {
        this.attachMiddleware(res, [
            this.corsMiddleware,
            this.appMiddleware,
            this.authMiddleware,
        ]).then(res => {
            if (! res.params.channel.startsWith('presence-')) {
                return this.badResponse(res, 'The channel must be a presence channel.');
            }

            this.server.adapter.getChannelMembers(res.params.appId, res.params.channel).then(members => {
                let message = {
                    users: [...members].map(([user_id, user_info]) => ({ id: user_id })),
                };

                this.server.metricsManager.markApiMessage(res.params.appId, {}, message);

                res.writeStatus('200 OK').end(JSON.stringify(message));
            });
        });
    }

    events(res: HttpResponse) {
        this.attachMiddleware(res, [
            this.corsMiddleware,
            this.appMiddleware,
            this.jsonBodyMiddleware,
            this.authMiddleware,
        ]).then(res => {
            let message = res.body;

            if (
                (! message.channels && ! message.channel) ||
                ! message.name ||
                ! message.data
            ) {
                return this.badResponse(res, 'The received data is incorrect');
            }

            let channels: string[] = message.channels || [message.channel];

            // Make sure the channels length is not too big.
            if (channels.length > this.server.options.eventLimits.maxChannelsAtOnce) {
                return this.badResponse(res, `Cannot broadcast to more than ${this.server.options.eventLimits.maxChannelsAtOnce} channels at once`);
            }

            // Make sure the event name length is not too big.
            if (message.name.length > this.server.options.eventLimits.maxNameLength) {
                return this.badResponse(res, `Event name is too long. Maximum allowed size is ${this.server.options.eventLimits.maxNameLength}.`);
            }

            let payloadSizeInKb = Utils.dataToKilobytes(message.data);

            // Make sure the total payload of the message body is not too big.
            if (payloadSizeInKb > parseFloat(this.server.options.eventLimits.maxPayloadInKb as string)) {
                return this.badResponse(res, `The event data should be less than ${this.server.options.eventLimits.maxPayloadInKb} KB.`);
            }

            async.each(channels, (channel, callback) => {
                this.server.adapter.send(res.params.appId, channel, JSON.stringify({
                    event: message.name,
                    channel,
                    data: message.data,
                }), message.socket_id);

                callback();
            }).then(() => {
                this.server.metricsManager.markApiMessage(res.params.appId, message, { ok: true });

                res.writeStatus('200 OK').end(JSON.stringify({
                    ok: true,
                }));
            });
        });
    }

    protected badResponse(res: HttpResponse, message: string) {
        return res.writeStatus('400 Bad Request').end(JSON.stringify({
            error: message,
            code: 400,
        }));
    }

    protected notFoundResponse(res: HttpResponse, message: string) {
        return res.writeStatus('404 Not Found').end(JSON.stringify({
            error: message,
            code: 404
        }));
    }

    protected unauthorizedResponse(res: HttpResponse, message: string) {
        return res.writeStatus('401 Unauthorized').end(JSON.stringify({
            error: message,
            code: 401,
        }));
    }

    protected entityTooLargeResponse(res: HttpResponse, message: string) {
        return res.writeStatus('413 Entity Too Large').end(JSON.stringify({
            error: message,
            code: 413,
        }));
    }

    protected serverErrorResponse(res: HttpResponse, message: string) {
        return res.writeStatus('500 Server Error').end(JSON.stringify({
            error: message,
            code: 500,
        }));
    }

    protected jsonBodyMiddleware(res: HttpResponse, next: CallableFunction): any {
        this.readJson(res, data => {
            res.body = data;

            let requestSizeInMb = Utils.dataToMegabytes(data);

            if (requestSizeInMb > this.server.options.httpApi.requestLimitInMb) {
                return this.entityTooLargeResponse(res, 'The payload size is too big.');
            }

            next(null, res);
        }, err => {
            return this.badResponse(res, 'The received data is incorrect.');
        });
    }

    protected corsMiddleware(res: HttpResponse, next: CallableFunction): any {
        res.writeHeader('Access-Control-Allow-Origin', this.server.options.cors.origin.join(', '));
        res.writeHeader('Access-Control-Allow-Methods', this.server.options.cors.methods.join(', '));
        res.writeHeader('Access-Control-Allow-Headers', this.server.options.cors.allowedHeaders.join(', '));

        next(null, res);
    }

    protected appMiddleware(res: HttpResponse, next: CallableFunction): any {
        return this.server.appManager.findById(res.params.appId).then(validApp => {
            if (! validApp) {
                return this.notFoundResponse(res, `The app ${res.params.appId} could not be found.`);
            }

            res.app = validApp;

            next(null, res);
        });
    }

    protected authMiddleware(res: HttpResponse, next: CallableFunction): any {
        this.signatureIsValid(res).then(valid => {
            if (valid) {
                return next(null, res);
            }

            return this.unauthorizedResponse(res, 'The secret authentication failed');
        });
    }

    protected attachMiddleware(res: HttpResponse, functions: any[]): Promise<HttpResponse> {
        return new Promise(resolve => {
            let abortHandlerMiddleware = callback => {
                res.onAborted(() => {
                    Log.warning(['Aborted request.', res]);
                });

                callback(null, res);
            };

            async.waterfall([
                abortHandlerMiddleware,
                ...functions.map(fn => fn.bind(this)),
            ], (err, res) => {
                resolve(res);
            });
        });
    }

    /**
     * Read the JSON content of a request.
     */
    protected readJson(res: HttpResponse, cb: CallableFunction, err: any) {
        let buffer;

        res.onData((ab, isLast) => {
            let chunk = Buffer.from(ab);

            if (isLast) {
                let json;

                if (buffer) {
                    try {
                        // @ts-ignore
                        json = JSON.parse(Buffer.concat([buffer, chunk]));
                    } catch (e) {
                        res.close();
                        return;
                    }

                    cb(json);
                } else {
                    try {
                        // @ts-ignore
                        json = JSON.parse(chunk);
                    } catch (e) {
                        res.close();
                        return;
                    }

                    cb(json);
                }
            } else {
                if (buffer) {
                    buffer = Buffer.concat([buffer, chunk]);
                } else {
                    buffer = Buffer.concat([chunk]);
                }
            }
        });

        res.onAborted(err);
    }

    /**
     * Check is an incoming request can access the api.
     */
     protected signatureIsValid(res: HttpResponse): Promise<boolean> {
        return this.getSignedToken(res).then(token => {
            return token === res.query.auth_signature;
        });
    }

    /**
     * Get the signed token from the given request.
     */
    protected getSignedToken(res: HttpResponse): Promise<string> {
        return Promise.resolve(res.app.signingTokenFromRequest(res));
    }
}
