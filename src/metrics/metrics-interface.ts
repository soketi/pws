import * as prom from 'prom-client';
import { UserDataInterface } from '../adapters/user-data-interface';
import { WebSocket } from 'uWebSockets.js';

export interface MetricsInterface {
    /**
     * The Metrics driver.
     */
    driver?: MetricsInterface;

    /**
     * Handle a new connection.
     */
    markNewConnection(ws: WebSocket<UserDataInterface>): void;

    /**
     * Handle a disconnection.
     */
    markDisconnection(ws: WebSocket<UserDataInterface>): void;

    /**
     * Handle a new API message event being received and sent out.
     */
    markApiMessage(appId: string, incomingMessage: any, sentMessage: any): void;

    /**
     * Handle a new WS client message event being sent.
     */
    markWsMessageSent(appId: string, sentMessage: any): void;

    /**
     * Handle a new WS client message being received.
     */
    markWsMessageReceived(appId: string, message: any): void;

    /**
     * Track the time in which horizontal adapter resolves requests from other nodes.
     */
    trackHorizontalAdapterResolveTime(appId: string, time: number): void;

    /**
     * Track the fulfillings in which horizontal adapter resolves requests from other nodes.
     */
    trackHorizontalAdapterResolvedPromises(appId: string, resolved?: boolean): void;

    /**
     * Handle a new horizontal adapter request sent.
     */
    markHorizontalAdapterRequestSent(appId: string): void;

    /**
     * Handle a new horizontal adapter request that was marked as received.
     */
    markHorizontalAdapterRequestReceived(appId: string): void;

    /**
     * Handle a new horizontal adapter response from other node.
     */
    markHorizontalAdapterResponseReceived(appId: string): void;

    /**
     * Get the stored metrics as plain text, if possible.
     */
    getMetricsAsPlaintext(): Promise<string>;

    /**
     * Get the stored metrics as JSON.
     */
    getMetricsAsJson(): Promise<prom.metric[]|void>;

    /**
     * Reset the metrics at the server level.
     */
    clear(): Promise<void>;
}
