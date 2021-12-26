import { AppInterface } from './app';

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
}

interface RedisSentinel {
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
            prefix: string;
        };
    };
    appManager: {
        driver: string;
        array: {
            apps: AppInterface[];
        };
        dynamodb: {
            table: string;
            region: string;
            endpoint: string;
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
    channelLimits: {
        maxNameLength: number;
    };
    cluster: {
        host: string;
        keepaliveInterval: number;
        checkInterval: number;
        nodeTimeout: number,
        masterTimeout: number;
        port: number;
        prefix: string;
        ignoreProcess: boolean;
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
    };
    httpApi: {
        requestLimitInMb: string|number;
    };
    instance: {
        process_id: string|number;
    };
    metrics: {
        enabled: boolean;
        driver: string;
        prometheus: {
            prefix: string;
        };
        port: number;
    },
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
        };
    };
    rateLimiter: {
        driver: string;
    };
    shutdownGracePeriod: number;
    ssl: {
        certPath: string;
        keyPath: string;
        passphrase: string;
    };
}
