import { HttpResponse } from 'uWebSockets.js';
import { LambdaClientConfig } from '@aws-sdk/client-lambda';
import { Server } from './server';

const Pusher = require('pusher');
const pusherUtil = require('pusher/lib/util');

export interface AppInterface {
    id: string;
    key: string;
    secret: string;
    maxConnections: string|number;
    enableClientMessages: boolean;
    enabled: boolean;
    maxBackendEventsPerSecond?: string|number;
    maxClientEventsPerSecond: string|number;
    maxReadRequestsPerSecond?: string|number;
    webhooks?: WebhookInterface[];
    maxPresenceMembersPerChannel?: string|number;
    maxPresenceMemberSizeInKb?: string|number;
    maxChannelNameLength?: number;
    maxEventChannelsAtOnce?: string|number;
    maxEventNameLength?: string|number;
    maxEventPayloadInKb?: string|number;
    maxEventBatchSize?: string|number;
    enableUserAuthentication?: boolean;
    hasClientEventWebhooks?: boolean;
    hasChannelOccupiedWebhooks?: boolean;
    hasChannelVacatedWebhooks?: boolean;
    hasMemberAddedWebhooks?: boolean;
    hasMemberRemovedWebhooks?: boolean;
}

export interface WebhookInterface {
    url?: string;
    headers?: {
        [key: string]: string;
    };
    lambda_function?: string;
    event_types: string[];
    filter?: {
        channel_name_starts_with?: string;
        channel_name_ends_with?: string;
    };
    lambda: {
        async?: boolean;
        region?: string;
        client_options?: LambdaClientConfig,
    };
}

export class App implements AppInterface {
    /**
     * @type {string|number}
     */
    public id: string;

    /**
     * @type {string|number}
     */
    public key: string;

    /**
     * @type {string}
     */
    public secret: string;

    /**
     * @type {number}
     */
    public maxConnections: string|number;

    /**
     * @type {boolean}
     */
    public enableClientMessages: boolean;

    /**
     * @type {boolean}
     */
    public enabled: boolean;

    /**
     * @type {number}
     */
    public maxBackendEventsPerSecond: string|number;

    /**
     * @type {number}
     */
    public maxClientEventsPerSecond: string|number;

    /**
     * @type {number}
     */
    public maxReadRequestsPerSecond: string|number;

    /**
     * @type {WebhookInterface[]}
     */
    public webhooks: WebhookInterface[];

    /**
     * @type {string|number}
     */
    public maxPresenceMembersPerChannel: string|number;

    /**
     * @type {string|number}
     */
    public maxPresenceMemberSizeInKb: string|number;

    /**
     * @type {number}
     */
    public maxChannelNameLength: number;

    /**
     * @type {string|number}
     */
    public maxEventChannelsAtOnce: string|number;

    /**
     * @type {string|number}
     */
    public maxEventNameLength: string|number;

    /**
     * @type {string|number}
     */
    public maxEventPayloadInKb: string|number;

    /**
     * @type {string|number}
     */
    public maxEventBatchSize: string|number;

    /**
     * @type {boolean}
     */
    public enableUserAuthentication = false;

    /**
     * @type {boolean}
     */
    public hasClientEventWebhooks = false;

    /**
     * @type {boolean}
     */
    public hasChannelOccupiedWebhooks = false;

    /**
     * @type {boolean}
     */
    public hasChannelVacatedWebhooks = false;

    /**
     * @type {boolean}
     */
    public hasMemberAddedWebhooks = false;

    /**
     * @type {boolean}
     */
    public hasMemberRemovedWebhooks = false;

    /**
     * @type {boolean}
     */
    public hasCacheMissedWebhooks = false;

    static readonly CLIENT_EVENT_WEBHOOK = 'client_event';
    static readonly CHANNEL_OCCUPIED_WEBHOOK = 'channel_occupied';
    static readonly CHANNEL_VACATED_WEBHOOK = 'channel_vacated';
    static readonly MEMBER_ADDED_WEBHOOK = 'member_added';
    static readonly MEMBER_REMOVED_WEBHOOK = 'member_removed';
    static readonly CACHE_MISSED_WEBHOOK = 'cache_miss';

    /**
     * Create a new app from object.
     */
    constructor(public initialApp: { [key: string]: any; }, protected server: Server) {
        this.id = this.extractFromPassedKeys(initialApp, ['id', 'AppId'], 'app-id');
        this.key = this.extractFromPassedKeys(initialApp, ['key', 'AppKey'], 'app-key');
        this.secret = this.extractFromPassedKeys(initialApp, ['secret', 'AppSecret'], 'app-secret');
        this.maxConnections = this.extractFromPassedKeys(initialApp, ['maxConnections', 'MaxConnections', 'max_connections'], -1);
        this.enableClientMessages = this.extractFromPassedKeys(initialApp, ['enableClientMessages', 'EnableClientMessages', 'enable_client_messages'], false);
        this.enabled = this.extractFromPassedKeys(initialApp, ['enabled', 'Enabled'], true);
        this.maxBackendEventsPerSecond = parseInt(this.extractFromPassedKeys(initialApp, ['maxBackendEventsPerSecond', 'MaxBackendEventsPerSecond', 'max_backend_events_per_sec'], -1));
        this.maxClientEventsPerSecond = parseInt(this.extractFromPassedKeys(initialApp, ['maxClientEventsPerSecond', 'MaxClientEventsPerSecond', 'max_client_events_per_sec'], -1));
        this.maxReadRequestsPerSecond = parseInt(this.extractFromPassedKeys(initialApp, ['maxReadRequestsPerSecond', 'MaxReadRequestsPerSecond', 'max_read_req_per_sec'], -1));
        this.webhooks = this.transformPotentialJsonToArray(this.extractFromPassedKeys(initialApp, ['webhooks', 'Webhooks'], '[]'));
        this.maxPresenceMembersPerChannel = parseInt(this.extractFromPassedKeys(initialApp, ['maxPresenceMembersPerChannel', 'MaxPresenceMembersPerChannel', 'max_presence_members_per_channel'], server.options.presence.maxMembersPerChannel));
        this.maxPresenceMemberSizeInKb = parseFloat(this.extractFromPassedKeys(initialApp, ['maxPresenceMemberSizeInKb', 'MaxPresenceMemberSizeInKb', 'max_presence_member_size_in_kb'], server.options.presence.maxMemberSizeInKb));
        this.maxChannelNameLength = parseInt(this.extractFromPassedKeys(initialApp, ['maxChannelNameLength', 'MaxChannelNameLength', 'max_channel_name_length'], server.options.channelLimits.maxNameLength));
        this.maxEventChannelsAtOnce = parseInt(this.extractFromPassedKeys(initialApp, ['maxEventChannelsAtOnce', 'MaxEventChannelsAtOnce', 'max_event_channels_at_once'], server.options.eventLimits.maxChannelsAtOnce));
        this.maxEventNameLength = parseInt(this.extractFromPassedKeys(initialApp, ['maxEventNameLength', 'MaxEventNameLength', 'max_event_name_length'], server.options.eventLimits.maxNameLength));
        this.maxEventPayloadInKb = parseFloat(this.extractFromPassedKeys(initialApp, ['maxEventPayloadInKb', 'MaxEventPayloadInKb', 'max_event_payload_in_kb'], server.options.eventLimits.maxPayloadInKb));
        this.maxEventBatchSize = parseInt(this.extractFromPassedKeys(initialApp, ['maxEventBatchSize', 'MaxEventBatchSize', 'max_event_batch_size'], server.options.eventLimits.maxBatchSize));
        this.enableUserAuthentication = this.extractFromPassedKeys(initialApp, ['enableUserAuthentication', 'EnableUserAuthentication', 'enable_user_authentication'], false);

        this.hasClientEventWebhooks = this.webhooks.filter(webhook => webhook.event_types.includes(App.CLIENT_EVENT_WEBHOOK)).length > 0;
        this.hasChannelOccupiedWebhooks = this.webhooks.filter(webhook => webhook.event_types.includes(App.CHANNEL_OCCUPIED_WEBHOOK)).length > 0;
        this.hasChannelVacatedWebhooks = this.webhooks.filter(webhook => webhook.event_types.includes(App.CHANNEL_VACATED_WEBHOOK)).length > 0;
        this.hasMemberAddedWebhooks = this.webhooks.filter(webhook => webhook.event_types.includes(App.MEMBER_ADDED_WEBHOOK)).length > 0;
        this.hasMemberRemovedWebhooks = this.webhooks.filter(webhook => webhook.event_types.includes(App.MEMBER_REMOVED_WEBHOOK)).length > 0;
        this.hasCacheMissedWebhooks = this.webhooks.filter(webhook => webhook.event_types.includes(App.CACHE_MISSED_WEBHOOK)).length > 0;
    }

    /**
     * Get the app represented as object.
     */
    toObject(): AppInterface {
        return {
            id: this.id,
            key: this.key,
            secret: this.secret,
            maxConnections: this.maxConnections,
            enableClientMessages: this.enableClientMessages,
            enabled: this.enabled,
            maxBackendEventsPerSecond: this.maxBackendEventsPerSecond,
            maxClientEventsPerSecond: this.maxClientEventsPerSecond,
            maxReadRequestsPerSecond: this.maxReadRequestsPerSecond,
            webhooks: this.webhooks,
            maxPresenceMembersPerChannel: this.maxPresenceMembersPerChannel,
            maxPresenceMemberSizeInKb: this.maxPresenceMemberSizeInKb,
            maxChannelNameLength: this.maxChannelNameLength,
            maxEventChannelsAtOnce: this.maxEventChannelsAtOnce,
            maxEventNameLength: this.maxEventNameLength,
            maxEventPayloadInKb: this.maxEventPayloadInKb,
            maxEventBatchSize: this.maxEventBatchSize,
            enableUserAuthentication: this.enableUserAuthentication,
        }
    }

    /**
     * Get the app represented as JSON.
     */
    toJson(): string {
        return JSON.stringify(this.toObject());
    }

    /**
     * Strip data off the app, usually the one that's not needed from the WS's perspective.
     * Usually used when attached to WS connections, as they don't need these details.
     */
    forWebSocket(): App {
        let app = new App(this.initialApp, this.server);

        // delete app.secret;
        delete app.maxBackendEventsPerSecond;
        delete app.maxReadRequestsPerSecond;
        delete app.webhooks;

        return app;
    }

    /**
     * Get the signing token from the request.
     */
    signingTokenFromRequest(res: HttpResponse): string {
        const params = {
            auth_key: this.key,
            auth_timestamp: res.query.auth_timestamp,
            auth_version: res.query.auth_version,
            ...res.query,
        };

        delete params['auth_signature'];
        delete params['body_md5']
        delete params['appId'];
        delete params['appKey'];
        delete params['channelName'];

        if (res.rawBody || res.query['body_md5']) {
            params['body_md5'] = pusherUtil.getMD5(res.rawBody || '');
        }

        return this.signingToken(
            res.method,
            res.url,
            pusherUtil.toOrderedArray(params).join('&'),
        );
    }

    /**
     * Get the signing token for the given parameters.
     */
    protected signingToken(method: string, path: string, params: string): string {
        let token = new Pusher.Token(this.key, this.secret);

        return token.sign([method, path, params].join("\n"));
    }

    /**
     * Due to cross-database schema, it's worth to search multiple fields in the app in order to assign it
     * to the local App object. For example, the local `enableClientMessages` attribute can exist as
     * enableClientMessages, enable_client_messages, or EnableClientMessages. With this function, we pass
     * the app, the list of all field posibilities, and a default value.
     * This check is done with a typeof check over undefined, to make sure that false booleans or 0 values
     * are being parsed properly and are not being ignored.
     */
    protected extractFromPassedKeys(app: { [key: string]: any; }, parameters: string[], defaultValue: any): any {
        let extractedValue = defaultValue;

        parameters.forEach(param => {
            if (typeof app[param] !== 'undefined' && !['', null].includes(app[param])) {
                extractedValue = app[param];
            }
        });

        return extractedValue;
    }

    /**
     * If it's already an array, it returns the array. For an invalid JSON, it returns an empty array.
     * If it's a JSON-formatted string, it parses it and returns the value.
     */
    protected transformPotentialJsonToArray(potentialJson: any): any {
        if (potentialJson instanceof Array) {
            return potentialJson;
        }

        try {
            let potentialArray = JSON.parse(potentialJson);

            if (potentialArray instanceof Array) {
                return potentialArray;
            }
        } catch (e) {
            //
        }

        return [];
    }
}
