import async from 'async';
import { Log } from '../src/log';
import { PusherApiMessage } from '../src/message';
import { Server } from './../src/server';
import { v4 as uuidv4 } from 'uuid';

const bodyParser = require('body-parser');
const express = require('express');
const Pusher = require('pusher');
const PusherJS = require('pusher-js');
const tcpPortUsed = require('tcp-port-used');

export class Utils {
    public static wsServers: Server[] = [];
    public static httpServers: any[] = [];

    static appManagerIs(manager: string): boolean {
        return (process.env.TEST_APP_MANAGER || 'array') === manager;
    }

    static adapterIs(adapter: string) {
        return (process.env.TEST_ADAPTER || 'local') === adapter;
    }

    static queueDriverIs(queueDriver: string) {
        return (process.env.TEST_QUEUE_DRIVER || 'sync') === queueDriver;
    }

    static waitForPortsToFreeUp(): Promise<any> {
        return Promise.all([
            tcpPortUsed.waitUntilFree(6001, 500, 5 * 1000),
            tcpPortUsed.waitUntilFree(6002, 500, 5 * 1000),
            tcpPortUsed.waitUntilFree(3001, 500, 5 * 1000),
            tcpPortUsed.waitUntilFree(9601, 500, 5 * 1000),
            tcpPortUsed.waitUntilFree(11002, 500, 5 * 1000),
        ]);
    }

    static newServer(options = {}, callback): any {
        options = {
            'cluster.prefix': uuidv4(),
            'adapter.redis.prefix': uuidv4(),
            'adapter.nats.prefix': uuidv4(),
            'appManager.array.apps.0.maxBackendEventsPerSecond': 200,
            'appManager.array.apps.0.maxClientEventsPerSecond': 200,
            'appManager.array.apps.0.maxReadRequestsPerSecond': 200,
            'metrics.enabled': true,
            'appManager.mysql.useMysql2': true,
            'cluster.port': parseInt((Math.random() * (20000 - 10000) + 10000).toString()), // random: 10000-20000
            'appManager.dynamodb.endpoint': 'http://127.0.0.1:8000',
            'cluster.ignoreProcess': false,
            'webhooks.batching.enabled': false, // TODO: Find out why batching works but fails tests
            'webhooks.batching.duration': 1,
            'appManager.cache.enabled': true,
            'appManager.cache.ttl': -1,
            ...options,
            'adapter.driver': process.env.TEST_ADAPTER || 'local',
            'cache.driver': process.env.TEST_CACHE_DRIVER || 'memory',
            'appManager.driver': process.env.TEST_APP_MANAGER || 'array',
            'queue.driver': process.env.TEST_QUEUE_DRIVER || 'sync',
            'rateLimiter.driver': process.env.TEST_RATE_LIMITER || 'local',
            'database.mysql.user': process.env.TEST_MYSQL_USER || 'testing',
            'database.mysql.password': process.env.TEST_MYSQL_PASSWORD || 'testing',
            'database.mysql.database': process.env.TEST_MYSQL_DATABASE || 'testing',
            'database.postgres.user': process.env.TEST_POSTGRES_USER || 'testing',
            'database.postgres.password': process.env.TEST_POSTGRES_PASSWORD || 'testing',
            'database.postgres.database': process.env.TEST_POSTGRES_DATABASE || 'testing',
            'queue.sqs.queueUrl': process.env.TEST_SQS_URL || 'http://localhost:4566/000000000000/test.fifo',
            'debug': process.env.TEST_DEBUG || false,
            'adapter.redis.useIncrementingKeys': process.env.TEST_ADAPTER_REDIS_USE_INCREMENTING_KEYS || false,
            'shutdownGracePeriod': 1_000,
        };

        return (new Server(options)).start((server: Server) => {
            this.wsServers.push(server);

            if (server.options.cache.driver === 'redis') {
                server.cacheManager.driver.redisConnection.flushdb().then(() => {
                    callback(server);
                });
            } else {
                callback(server);
            }
        });
    }

    static newClonedServer(server: Server, options = {}, callback): any {
        return this.newServer({
            // Make sure the same prefixes exists so that they can communicate
            'adapter.redis.prefix': server.options.adapter.redis.prefix,
            'adapter.nats.prefix': server.options.adapter.nats.prefix,
            'cluster.prefix': server.options.cluster.prefix,
            'cluster.port': server.options.cluster.port,
            ...options,
        }, callback);
    }

    static newWebhookServer(requestHandler: CallableFunction, onReadyCallback: CallableFunction): any {
        let webhooksApp = express();

        webhooksApp.use(bodyParser.json());

        webhooksApp.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', '*');
            res.header('Access-Control-Allow-Headers', '*');
            next();
        });

        webhooksApp.post('*', requestHandler);

        let server = webhooksApp.listen(3001, () => {
            Log.successTitle('🎉 Webhook Server is up and running!');

            server.on('error', err => {
                console.log('Websocket server error', err);
            });

            this.httpServers.push(server);

            onReadyCallback(server);
        });
    }

    static flushWsServers(): Promise<void> {
        if (this.wsServers.length === 0) {
            return Promise.resolve();
        }

        return async.each(this.wsServers, (server: Server, serverCallback) => {
            server.stop().then(() => {
                serverCallback();
            });
        }).then(() => {
            this.wsServers = [];
        });
    }

    static flushHttpServers(): Promise<void> {
        if (this.httpServers.length === 0) {
            return Promise.resolve();
        }

        return async.each(this.httpServers, (server: any, serverCallback) => {
            server.close(() => {
                serverCallback();
            });
        }).then(() => {
            this.httpServers = [];
        });
    }

    static flushServers(): Promise<any> {
        return Promise.all([
            this.flushWsServers(),
            this.flushHttpServers(),
        ]);
    }

    static newClient(options = {}, port = 6001, key = 'app-key', withStateChange = true): any {
        let client = new PusherJS(key, {
            wsHost: '127.0.0.1',
            httpHost: '127.0.0.1',
            wsPort: port,
            wssPort: port,
            httpPort: port,
            httpsPort: port,
            forceTLS: false,
            encrypted: true,
            disableStats: true,
            enabledTransports: ['ws'],
            ignoreNullOrigin: true,
            encryptionMasterKeyBase64: 'nxzvbGF+f8FGhk/jOaZvgMle1tqxzF/VfUZLBLhhaH0=',
            ...options,
        });

        if (withStateChange) {
            client.connection.bind('state_change', ({ current }) => {
                if (current === 'unavailable') {
                    console.log('The connection could not be made. Status: ' + current);
                }
            });
        }

        return client;
    }

    static newBackend(appId = 'app-id', key = 'app-key', secret = 'app-secret', port = 6001): any {
        return new Pusher({
            appId,
            key,
            secret,
            host: '127.0.0.1',
            port,
            encryptionMasterKeyBase64: 'nxzvbGF+f8FGhk/jOaZvgMle1tqxzF/VfUZLBLhhaH0=',
        });
    }

    static newClientForPrivateChannel(clientOptions = {}, port = 6001, key = 'app-key', userData = {}): any {
        return this.newClient({
            authorizer: (channel, options) => ({
                authorize: (socketId, callback) => {
                    callback(false, {
                        auth: this.signTokenForPrivateChannel(socketId, channel),
                        channel_data: null,
                    });
                },
            }),
            userAuthentication: {
                customHandler: ({ socketId }, callback) => {
                    callback(false, {
                        auth: this.signTokenForUserAuthentication(socketId, JSON.stringify(userData), key),
                        user_data: JSON.stringify(userData),
                    });
                },
            },
            ...clientOptions,
        }, port, key);
    }

    static newClientForEncryptedPrivateChannel(clientOptions = {}, port = 6001, key = 'app-key', userData = {}): any {
        return this.newClient({
            authorizer: (channel, options) => ({
                authorize: (socketId, callback) => {
                    callback(false, {
                        auth: this.signTokenForPrivateChannel(socketId, channel, key),
                        channel_data: null,
                        shared_secret: this.newBackend().channelSharedSecret(channel.name).toString('base64'),
                    });
                },
            }),
            userAuthentication: {
                customHandler: ({ socketId }, callback) => {
                    callback(false, {
                        auth: this.signTokenForUserAuthentication(socketId, JSON.stringify(userData), key),
                        user_data: JSON.stringify(userData),
                    });
                },
            },
            ...clientOptions,
        }, port, key);
    }

    static newClientForPresenceUser(user: any, clientOptions = {}, port = 6001, key = 'app-key', userData = {}): any {
        return this.newClient({
            authorizer: (channel, options) => ({
                authorize: (socketId, callback) => {
                    callback(false, {
                        auth: this.signTokenForPresenceChannel(socketId, channel, user, key),
                        channel_data: JSON.stringify(user),
                    });
                },
            }),
            userAuthentication: {
                customHandler: ({ socketId }, callback) => {
                    callback(false, {
                        auth: this.signTokenForUserAuthentication(socketId, JSON.stringify(userData), key),
                        user_data: JSON.stringify(userData),
                    });
                },
            },
            ...clientOptions,
        }, port, key);
    }

    static signTokenForPrivateChannel(
        socketId: string,
        channel: any,
        key = 'app-key',
        secret = 'app-secret'
    ): string {
        let token = new Pusher.Token(key, secret);

        return key + ':' + token.sign(`${socketId}:${channel.name}`);
    }

    static signTokenForPresenceChannel(
        socketId: string,
        channel: any,
        channelData: any,
        key = 'app-key',
        secret = 'app-secret'
    ): string {
        let token = new Pusher.Token(key, secret);

        return key + ':' + token.sign(`${socketId}:${channel.name}:${JSON.stringify(channelData)}`);
    }

    static signTokenForUserAuthentication(
        socketId: string,
        userData: string,
        key = 'app-key',
        secret = 'app-secret'
    ): string {
        let token = new Pusher.Token(key, secret);

        return key + ':' + token.sign(`${socketId}::user::${userData}`);
    }

    static wait(ms): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static randomChannelName(): string {
        return `channel-${Math.floor(Math.random() * 10000000)}`;
    }

    static shouldRun(condition): jest.It {
        return condition ? it : it.skip;
    }
}
