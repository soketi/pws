import { AppInterface } from './app';
import { ClusterOptions, RedisOptions } from 'ioredis';
import { ConsumerOptions } from 'sqs-consumer';
import { SQSClientConfig } from '@aws-sdk/client-sqs';

interface Redis {
    host: string;
    port: number;
    db: number;
    username: string|null;
    password: string|null;
    keyPrefix: string;
    sentinels: RedisSentinel[];
    sentinelPassword: string|null;
    name: string;
    clusterNodes: ClusterNode[];
}

interface RedisSentinel {
    host: string;
    port: number;
}

interface ClusterNode {
    host: string;
    port: number;
}

interface KnexConnection {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
}

export interface Options {
    adapter: {
        driver: string;
        redis: {
            requestsTimeout: number;
            prefix: string;
            redisPubOptions: any;
            redisSubOptions: any;
            clusterMode: boolean;
        };
        cluster: {
            requestsTimeout: 5_000,
        },
        nats: {
            requestsTimeout: number;
            prefix: string;
            servers: string[];
            user?: string;
            pass?: string|null;
            token: string|null;
            timeout: number;
            nodesNumber: number|null;
        };
    };
    appManager: {
        driver: string;
        array: {
            apps: AppInterface[];
        };
        cache: {
            enabled: boolean;
            ttl: number;
        };
        dynamodb: {
            table: string;
            region: string;
            endpoint?: string;
        };
        mysql: {
            table: string;
            version: string|number;
            useMysql2: boolean;
        };
        postgres: {
            table: string;
            version: string|number;
        };
    };
    cache: {
        driver: string;
        redis: {
            redisOptions: RedisOptions|ClusterOptions;
            clusterMode: boolean;
        };
    };
    channelLimits: {
        maxNameLength: number;
        cacheTtl: number;
    };
    cluster: {
        hostname: string;
        helloInterval: number;
        checkInterval: number;
        nodeTimeout: number,
        masterTimeout: number;
        port: number;
        prefix: string;
        ignoreProcess: boolean;
        broadcast: string;
        unicast: string|null;
        multicast: string|null;
    };
    cors: {
        credentials: boolean;
        origin: string[];
        methods: string[];
        allowedHeaders: string[];
    };
    database: {
        mysql: KnexConnection;
        postgres: KnexConnection;
        redis: Redis;
    };
    databasePooling: {
        enabled: boolean;
        min: number;
        max: number;
    };
    debug: boolean;
    eventLimits: {
        maxChannelsAtOnce: string|number;
        maxNameLength: string|number;
        maxPayloadInKb: string|number;
        maxBatchSize: string|number;
    };
    host: string;
    httpApi: {
        requestLimitInMb: string|number;
        acceptTraffic: {
            memoryThreshold: number;
        };
    };
    instance: {
        process_id: string|number;
    };
    metrics: {
        enabled: boolean;
        driver: string;
        host: string;
        prometheus: {
            prefix: string;
        };
        port: number;
    };
    mode: string;
    port: number;
    pathPrefix: string;
    presence: {
        maxMembersPerChannel: string|number;
        maxMemberSizeInKb: string|number;
    };
    queue: {
        driver: string;
        redis: {
            concurrency: number;
            redisOptions: RedisOptions|ClusterOptions;
            clusterMode: boolean;
        };
        sqs: {
            region?: string;
            endpoint?: string;
            clientOptions?: SQSClientConfig;
            consumerOptions?: ConsumerOptions;
            queueUrl: string;
            processBatch: boolean;
            batchSize: number;
            pollingWaitTimeMs: number;
        };
    };
    rateLimiter: {
        driver: string;
        redis: {
            redisOptions: RedisOptions|ClusterOptions;
            clusterMode: boolean;
        };
    };
    shutdownGracePeriod: number;
    ssl: {
        certPath: string;
        keyPath: string;
        passphrase: string;
        caPath: string;
    };
    userAuthenticationTimeout: number;
    webhooks: {
        batching: {
            enabled: boolean;
            duration: number;
        };
    };
}
