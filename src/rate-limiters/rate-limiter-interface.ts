import { App } from './../app';
import { RateLimiterAbstract, RateLimiterRes } from 'rate-limiter-flexible';
import { UserDataInterface } from '../adapters/user-data-interface';
import { WebSocket } from 'uWebSockets.js';

export interface ConsumptionResponse {
    canContinue: boolean;
    rateLimiterRes: RateLimiterRes|null;
    headers: {
        'Retry-After'?: number;
        'X-RateLimit-Limit'?: number;
        'X-RateLimit-Remaining'?: number;
    };
}

export interface RateLimiterInterface {
    /**
     * Rate Limiter driver.
     */
    driver?: RateLimiterInterface;

    /**
     * Consume the points for backend-received events.
     */
    consumeBackendEventPoints(points: number, app?: App, ws?: WebSocket<UserDataInterface>): Promise<ConsumptionResponse>;

    /**
     * Consume the points for frontend-received events.
     */
    consumeFrontendEventPoints(points: number, app?: App, ws?: WebSocket<UserDataInterface>): Promise<ConsumptionResponse>;

    /**
     * Consume the points for HTTP read requests.
     */
    consumeReadRequestsPoints(points: number, app?: App, ws?: WebSocket<UserDataInterface>): Promise<ConsumptionResponse>;

    /**
     * Create a new rate limiter instance.
     */
    createNewRateLimiter(appId: string, maxPoints: number): RateLimiterAbstract;

    /**
     * Clear the rate limiter or active connections.
     */
    disconnect(): Promise<void>;
}
