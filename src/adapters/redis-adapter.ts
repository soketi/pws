import { AdapterInterface } from './adapter-interface';
import { HorizontalAdapter, PubsubBroadcastedMessage } from './horizontal-adapter';
import { Log } from '../log';
import Redis, { Cluster, ClusterOptions, RedisOptions } from 'ioredis';
import { Server } from '../server';
import { WebSocket } from 'uWebSockets.js';

export class RedisAdapter extends HorizontalAdapter {
    /**
     * The channel to broadcast the information.
     */
    protected channel = 'redis-adapter';

    /**
     * The subscription client.
     */
    protected subClient: Redis|Cluster;

    /**
     * The publishing client.
     */
    protected pubClient: Redis|Cluster;

    protected syncIntervals: {
        [appId: string]: NodeJS.Timeout;
    } = {};

    /**
     * Initialize the adapter.
     */
    constructor(server: Server) {
        super(server);

        if (server.options.adapter.redis.prefix) {
            this.channel = server.options.adapter.redis.prefix + '#' + this.channel;
        }

        this.requestChannel = `${this.channel}#comms#req`;
        this.responseChannel = `${this.channel}#comms#res`;

        this.requestsTimeout = server.options.adapter.redis.requestsTimeout;
    }

    /**
     * Initialize the adapter.
     */
    async init(): Promise<AdapterInterface> {
        let redisOptions: RedisOptions|ClusterOptions = {
            maxRetriesPerRequest: 2,
            retryStrategy: times => times * 2,
            ...this.server.options.database.redis,
        };

        this.subClient = this.server.options.adapter.redis.clusterMode
            ? new Cluster(this.server.options.database.redis.clusterNodes, { ...redisOptions, ...this.server.options.adapter.redis.redisSubOptions })
            : new Redis({ ...redisOptions, ...this.server.options.adapter.redis.redisSubOptions });

        this.pubClient = this.server.options.adapter.redis.clusterMode
            ? new Cluster(this.server.options.database.redis.clusterNodes, { ...redisOptions, ...this.server.options.adapter.redis.redisPubOptions })
            : new Redis({ ...redisOptions, ...this.server.options.adapter.redis.redisPubOptions });

        const onError = err => {
            if (err) {
                Log.warning(err);
            }
        };

        this.subClient.psubscribe(`${this.channel}*`, onError);

        this.subClient.on('pmessageBuffer', this.onMessage.bind(this));
        this.subClient.on('messageBuffer', this.processMessage.bind(this));

        this.subClient.subscribe(this.requestChannel, this.responseChannel, onError);

        this.pubClient.on('error', onError);
        this.subClient.on('error', onError);

        return this;
    }

    /**
     * Broadcast data to a given channel.
     */
    protected broadcastToChannel(channel: string, data: string): void {
        this.pubClient.publish(channel, data);
    }

    /**
     * Process the incoming message and redirect it to the right processor.
     */
    protected processMessage(redisChannel: string, msg: Buffer|string): void {
        redisChannel = redisChannel.toString();
        msg = msg.toString();

        if (redisChannel.startsWith(this.responseChannel)) {
            this.onResponse(redisChannel, msg);
        } else if (redisChannel.startsWith(this.requestChannel)) {
            this.onRequest(redisChannel, msg);
        }
    }

    /**
     * Listen for message coming from other nodes to broadcast
     * a specific message to the local sockets.
     */
    protected onMessage(pattern: string, redisChannel: string, msg: Buffer|string): void {
        redisChannel = redisChannel.toString();
        msg = msg.toString();

        // This channel is just for the en-masse broadcasting, not for processing
        // the request-response cycle to gather info across multiple nodes.
        if (!redisChannel.startsWith(this.channel)) {
            return;
        }

        let decodedMessage: PubsubBroadcastedMessage = JSON.parse(msg);

        if (typeof decodedMessage !== 'object') {
            return;
        }

        const { uuid, appId, channel, data, exceptingId } = decodedMessage;

        if (uuid === this.uuid || !appId || !channel || !data) {
            return;
        }

        // Experimental: We have a continuous sync of the number of connections
        // for a specific App ID. This allows us to get in sync the total number of
        // connections without screwing up in case the increment/decrement operations
        // decide to flop and not be in sync.
        // The value is randomly selected at runtime, between 10s and 60s, permanent.
        // We can write this check in here as it seems like we received a message from other node,
        // so the number of subscribers to PubSub is not 0.
        if (
            this.server.options.adapter.redis.useIncrementingKeys
            && !this.syncIntervals[appId]
        ) {
            this.syncIntervals[appId] = setInterval(() => {
                super.getSocketsCount(appId).then((socketsCount) => {
                    this.pubClient.set(`app:${appId}:connections_count`, socketsCount);
                });
            }, Math.floor(Math.random() * (60 - 10 + 1) + 10) * 1e3);
        }

        super.sendLocally(appId, channel, data, exceptingId);
    }

    /**
     * Get the number of Redis subscribers.
     */
    protected getNumSub(): Promise<number> {
        if (this.server.options.adapter.redis.clusterMode) {
            const nodes = (this.pubClient as Cluster).nodes();

            return Promise.all(
                nodes.map((node) =>
                    node.pubsub('NUMSUB', this.requestChannel)
                )
            ).then((values: any[]) => {
                let number = values.reduce((numSub, value) => {
                    return numSub += parseInt(value[1], 10);
                }, 0);

                if (this.server.options.debug) {
                    Log.info(`Found ${number} subscribers in the Redis cluster.`);
                }

                return number;
            });
        } else {
            // RedisClient or Redis
            return new Promise((resolve, reject) => {
                this.pubClient.pubsub(
                    'NUMSUB',
                    this.requestChannel,
                    (err, numSub: [any, string]) => {
                        if (err) {
                            return reject(err);
                        }

                        let number = parseInt(numSub[1], 10);

                        if (this.server.options.debug) {
                            Log.info(`Found ${number} subscribers in the Redis cluster.`);
                        }

                        resolve(number);
                    }
                );
            });
        }
    }

    /**
     * Clear the connections.
     */
    disconnect(): Promise<void> {
        return Promise.allSettled([
            this.subClient.quit(),
            this.pubClient.quit(),
            ...(Object.keys(this.syncIntervals).map(key => new Promise<void>(resolve => {
                clearInterval(this.syncIntervals[key]);
                delete this.syncIntervals[key];
                resolve();
            })) || []),
        ]).then(() => {
            //
        });
    }

    /**
     * Get total sockets count.
     */
    async getSocketsCount(appId: string, onlyLocal?: boolean): Promise<number> {
        if (onlyLocal) {
            return super.getSocketsCount(appId, onlyLocal);
        }

        // Experimental: this will take a value of an incremented field
        // from Redis, whose increment/decrement values (or get) are all O(1)
        // This will perform better than O(N+M) that would require to iterate over
        // the list of all sockets and count them from each node.
        if (this.server.options.adapter.redis.useIncrementingKeys) {
            return new Promise((resolve, reject) => {
                this.pubClient.get(`app:${appId}:connections_count`).then((socketsCount) => {
                    return resolve(parseInt(socketsCount, 10) || 0);
                });
            });
        }

        return super.getSocketsCount(appId, onlyLocal);
    }

    /**
     * Get a given channel's total sockets count.
     */
    async getChannelSocketsCount(appId: string, channel: string, onlyLocal?: boolean): Promise<number> {
        if (onlyLocal) {
            return super.getChannelSocketsCount(appId, channel, onlyLocal);
        }

        // Experimental: this will take a value of an incremented field
        // from Redis, whose increment/decrement values (or get) are all O(1)
        // This will perform better than O(N+M) that would require to iterate over
        // the list of all sockets and count them from each node.
        if (this.server.options.adapter.redis.useIncrementingKeys) {
            return new Promise((resolve, reject) => {
                this.pubClient.get(`app:${appId}:channel:${channel}:subscriptions_count`).then(count => {
                    return resolve(parseInt(count, 10) || 0);
                });
            });
        }

        return super.getChannelSocketsCount(appId, channel, onlyLocal);
    }

    /**
     * Add a new socket to the namespace.
     */
    async addSocket(appId: string, ws: WebSocket): Promise<boolean> {
        return super.addSocket(appId, ws).then((added) => {
            if (this.server.options.adapter.redis.useIncrementingKeys) {
                this.pubClient.incr(`app:${appId}:connections_count`);
            }

            return added;
        });
    }

    /**
     * Remove a socket from the namespace.
     */
    async removeSocket(appId: string, wsId: string): Promise<boolean> {
        return super.removeSocket(appId, wsId).then((removed) => {
            if (this.server.options.adapter.redis.useIncrementingKeys) {
                this.pubClient.decr(`app:${appId}:connections_count`);
            }

            return removed;
        });
    }

    /**
     * Add a socket ID to the channel identifier.
     * Return the total number of connections after the connection.
     */
    async addToChannel(appId: string, channel: string, ws: WebSocket): Promise<number> {
        return super.addToChannel(appId, channel, ws).then((count) => {
            if (this.server.options.adapter.redis.useIncrementingKeys) {
                return this.pubClient.incr(`app:${appId}:channel:${channel}:subscriptions_count`);
            }

            return count;
        });
    }

    /**
     * Remove a socket ID from the channel identifier.
     * Return the total number of connections remaining to the channel.
     */
    async removeFromChannel(appId: string, channel: string|string[], wsId: string): Promise<number|void> {
        return super.removeFromChannel(appId, channel, wsId).then(() => {
            if (this.server.options.adapter.redis.useIncrementingKeys) {
                this.pubClient.decr(`app:${appId}:channel:${channel}:subscriptions_count`);
            }
        });
    }
}
