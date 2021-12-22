import { HorizontalAdapter, PubsubBroadcastedMessage } from './horizontal-adapter';
import { Log } from '../log';
import { Server } from '../server';

const Redis = require('ioredis');

export class RedisAdapter extends HorizontalAdapter {
    /**
     * The subscription client.
     */
    protected subClient: typeof Redis;

    /**
     * The publishing client.
     */
    protected pubClient: typeof Redis;

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

        let redisDefaultOptions = {
            maxRetriesPerRequest: 2,
            retryStrategy: times => times * 2,
        };

        this.subClient = new Redis({ ...redisDefaultOptions, ...server.options.database.redis });
        this.pubClient = new Redis({ ...redisDefaultOptions, ...server.options.database.redis });

        const onError = err => {
            if (err) {
                Log.warning(err);
            }
        };

        this.subClient.psubscribe(`${this.channel}*`, onError);

        this.subClient.on('pmessageBuffer', this.onMessage.bind(this));
        this.subClient.on('messageBuffer', this.onRequest.bind(this));

        this.subClient.subscribe([this.requestChannel, this.responseChannel], onError);

        this.pubClient.on('error', onError);
        this.subClient.on('error', onError);
    }

    /**
     * Broadcast data to a given channel.
     */
    protected broadcastToChannel(channel: string, data: any): void {
        this.pubClient.publish(channel, data);
    }

    /**
     * Listen for message coming from other nodes to broadcast
     * a specific message to the local sockets.
     */
    protected onMessage(pattern: string, redisChannel: string, msg: Buffer) {
        redisChannel = redisChannel.toString();

        if (!redisChannel.startsWith(this.channel)) {
            return;
        }

        let decodedMessage: PubsubBroadcastedMessage = JSON.parse(msg.toString());

        if (typeof decodedMessage !== 'object') {
            return;
        }

        const { uuid, appId, channel, data, exceptingId } = decodedMessage;

        if (uuid === this.uuid || !appId || !channel || !data) {
            return;
        }

        super.send(appId, channel, data, exceptingId);
    }

    /**
     * Get the number of Redis subscribers.
     */
    protected getNumSub(): Promise<number> {
        if (this.pubClient.constructor.name === 'Cluster') {
            // Cluster
            const nodes = this.pubClient.nodes();

            return Promise.all(
                nodes.map((node) =>
                    node.send_command('pubsub', ['numsub', this.requestChannel])
                )
            ).then((values: any[]) => {
                return values.reduce((numSub, value) => {
                    return numSub += parseInt(value[1], 10);
                }, 0);
            });
        } else {
            // RedisClient or Redis
            return new Promise((resolve, reject) => {
                this.pubClient.send_command(
                    'pubsub',
                    ['numsub', this.requestChannel],
                    (err, numSub) => {
                        if (err) {
                            return reject(err);
                        }

                        resolve(parseInt(numSub[1], 10));
                    }
                );
            });
        }
    }
}
