import { App } from './../app';
import { ClusterRateLimiter } from './cluster-rate-limiter';
import { ConsumptionResponse, RateLimiterInterface } from './rate-limiter-interface';
import { LocalRateLimiter } from './local-rate-limiter';
import { Log } from './../log';
import { RateLimiterAbstract } from 'rate-limiter-flexible';
import { RedisRateLimiter } from './redis-rate-limiter';
import { Server } from '../server';
import { UserDataInterface } from '../adapters/user-data-interface';
import { WebSocket } from 'uWebSockets.js';

export class RateLimiter implements RateLimiterInterface {
    /**
     * Rate Limiter driver.
     */
    public driver: RateLimiterInterface;

    /**
     * Initialize the rate limiter driver.
     */
    constructor(server: Server) {
        if (server.options.rateLimiter.driver === 'local') {
            this.driver = new LocalRateLimiter(server);
        } else if (server.options.rateLimiter.driver === 'redis') {
            this.driver = new RedisRateLimiter(server);
        } else if (server.options.rateLimiter.driver === 'cluster') {
            this.driver = new ClusterRateLimiter(server);
        } else {
            Log.error('No stats driver specified.');
        }
    }

    /**
     * Consume the points for backend-received events.
     */
    consumeBackendEventPoints(points: number, app?: App, ws?: WebSocket<UserDataInterface>): Promise<ConsumptionResponse> {
        return this.driver.consumeBackendEventPoints(points, app, ws);
    }

    /**
     * Consume the points for frontend-received events.
     */
    consumeFrontendEventPoints(points: number, app?: App, ws?: WebSocket<UserDataInterface>): Promise<ConsumptionResponse> {
        return this.driver.consumeFrontendEventPoints(points, app, ws);
    }

    /**
     * Consume the points for HTTP read requests.
     */
    consumeReadRequestsPoints(points: number, app?: App, ws?: WebSocket<UserDataInterface>): Promise<ConsumptionResponse> {
        return this.driver.consumeReadRequestsPoints(points, app, ws);
    }

    /**
     * Create a new rate limiter instance.
     */
    createNewRateLimiter(appId: string, maxPoints: number): RateLimiterAbstract {
        return this.driver.createNewRateLimiter(appId, maxPoints);
    }

    /**
     * Clear the rate limiter or active connections.
     */
     disconnect(): Promise<void> {
        return this.driver.disconnect();
    }
}
